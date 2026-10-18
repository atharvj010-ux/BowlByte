# Start BowlByte only after the Supabase cutover settings are usable.
# This script does not print secret values and does not stop Docker.
# While the check fails, the Docker Compose stack remains the runtime.

$ErrorActionPreference = "Stop"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$envFile = Join-Path $Root ".env"
if (Test-Path $envFile) {
    foreach ($line in Get-Content $envFile) {
        if ($line -match '^\s*#' -or $line -notmatch '=') {
            continue
        }
        $name, $value = $line.Split("=", 2)
        $name = $name.Trim()
        if (-not $name) {
            continue
        }
        Set-Item -Path "Env:$name" -Value $value.Trim().Trim('"')
    }
}

$python = Join-Path $Root "backend\.venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    $python = "python"
}

Push-Location (Join-Path $Root "backend")
try {
    & $python -m app.cli.supabase_preflight
    $code = $LASTEXITCODE
} finally {
    Pop-Location
}
if ($code -ne 0) {
    exit $code
}

function Test-LocalPort([int]$Port) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $wait = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
        if (-not $wait.AsyncWaitHandle.WaitOne(400, $false)) {
            return $false
        }
        $client.EndConnect($wait)
        return $true
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

foreach ($port in 3010, 8010) {
    if (Test-LocalPort $port) {
        Write-Output "Port $port is already in use. Native start refused."
        exit 2
    }
}

$dockerNames = @()
try {
    $dockerNames = @(docker ps --filter "name=bowlbyte" --format "{{.Names}}" 2>$null)
} catch {
    $dockerNames = @()
}
$blocking = @($dockerNames | Where-Object { $_ -match "backend|frontend|worker|beat|redis" })
if ($blocking.Count -gt 0) {
    Write-Output "BowlByte Docker app or Redis is still running. Native start refused."
    exit 2
}

$database = $env:SUPABASE_DB_URL
if (-not $database -or $database -notmatch "pooler\.supabase\.com:5432" -or $database -notmatch "sslmode=verify-full") {
    Write-Output "Supabase session pooler is not configured. Native start refused."
    exit 2
}
if ($database -match "^postgres(ql)?://") {
    $env:DATABASE_URL = $database -replace "^postgres(ql)?://", "postgresql+psycopg://"
}
Remove-Item Env:E2E_DATABASE -ErrorAction SilentlyContinue
Remove-Item Env:SOURCE_DATABASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:TARGET_DATABASE_URL -ErrorAction SilentlyContinue
$env:REDIS_URL = "redis://127.0.0.1:6379/0"

& $python -c "import os,psycopg; url=os.environ['DATABASE_URL'].replace('postgresql+psycopg','postgresql',1); conn=psycopg.connect(url, connect_timeout=20); name=conn.execute('select current_database()').fetchone()[0]; conn.close(); raise SystemExit(0 if name=='postgres' else 2)"
if ($LASTEXITCODE -ne 0) {
    Write-Output "Refusing to start. The application database is not the Supabase database."
    exit 2
}

$redisHome = Join-Path $env:LOCALAPPDATA "BowlByte\redis"
New-Item -ItemType Directory -Force -Path $redisHome | Out-Null
$redisExe = Get-ChildItem -Path "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Filter redis-server.exe -Recurse -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
if (-not $redisExe) {
    $redisExe = (Get-Command redis-server -ErrorAction SilentlyContinue).Source
}
if (-not $redisExe) {
    Write-Output "Windows Redis was not found. Native start refused."
    exit 2
}
Copy-Item (Join-Path $PSScriptRoot "redis\bowlbyte.conf") (Join-Path $redisHome "bowlbyte.conf") -Force

$pidFile = Join-Path $PSScriptRoot ".bowlbyte-dev.pids"
if (Test-Path $pidFile) {
    Write-Output "Native processes are already recorded. Run scripts/stop-dev.ps1 first."
    exit 2
}
$logDir = Join-Path $PSScriptRoot ".bowlbyte-dev-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$backend = Join-Path $Root "backend"
$frontend = Join-Path $Root "frontend"
$env:PORT = "3010"
$env:HOSTNAME = "127.0.0.1"
$env:PYTHONUNBUFFERED = "1"

$redis = Start-Process -FilePath $redisExe -WorkingDirectory $redisHome -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $logDir "redis.log") `
    -RedirectStandardError (Join-Path $logDir "redis.err") `
    -ArgumentList @("bowlbyte.conf")
$api = Start-Process -FilePath $python -WorkingDirectory $backend -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $logDir "api.log") `
    -RedirectStandardError (Join-Path $logDir "api.err") `
    -ArgumentList @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8010")
$worker = Start-Process -FilePath $python -WorkingDirectory $backend -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $logDir "worker.log") `
    -RedirectStandardError (Join-Path $logDir "worker.err") `
    -ArgumentList @("-m", "celery", "-A", "app.worker.celery_app", "worker", "--pool=solo", "-Q", "bowlbyte", "--loglevel=INFO")
$beat = Start-Process -FilePath $python -WorkingDirectory $backend -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $logDir "beat.log") `
    -RedirectStandardError (Join-Path $logDir "beat.err") `
    -ArgumentList @("-m", "celery", "-A", "app.worker.celery_app", "beat", "--loglevel=INFO")
$web = Start-Process -FilePath "node" -WorkingDirectory $frontend -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $logDir "web.log") `
    -RedirectStandardError (Join-Path $logDir "web.err") `
    -ArgumentList @("ws-proxy.mjs", "--dev")

$started = @($redis, $api, $worker, $beat, $web)
$started.Id | Set-Content -Path $pidFile
$ready = $false
foreach ($attempt in 1..20) {
    Start-Sleep -Seconds 2
    if ((Test-LocalPort 6379) -and (Test-LocalPort 8010) -and (Test-LocalPort 3010)) {
        $ready = $true
        break
    }
}
if (-not $ready) {
    foreach ($process in $started) {
        if ($process -and -not $process.HasExited) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
    }
    Remove-Item $pidFile -ErrorAction SilentlyContinue
    Write-Output "Native processes were launched but a port did not open. See scripts/.bowlbyte-dev-logs."
    exit 2
}
Write-Output "Native BowlByte is listening on 3010 and 8010."
Write-Output "database postgres"
Write-Output "redis 127.0.0.1:6379"
foreach ($process in $started) {
    Write-Output "pid $($process.Id) $($process.ProcessName)"
}
