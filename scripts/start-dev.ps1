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

function Get-RedisPing {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $output = & wsl -d Ubuntu -u root redis-cli -h 127.0.0.1 ping 2>&1
        return @($output | ForEach-Object { "$_" } | Where-Object { $_ -eq "PONG" } | Select-Object -Last 1)
    } finally {
        $ErrorActionPreference = $previous
    }
}

$ping = Get-RedisPing
if ($ping -ne "PONG") {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    & wsl -d Ubuntu -u root redis-server --daemonize yes --bind 0.0.0.0 --port 6379 --protected-mode no 2>&1 | Out-Null
    $ErrorActionPreference = $previous
    Start-Sleep -Seconds 1
    $ping = Get-RedisPing
}
if ($ping -ne "PONG") {
    Write-Output "WSL Ubuntu Redis did not answer. Native start refused."
    exit 2
}
Remove-Item Env:E2E_DATABASE -ErrorAction SilentlyContinue
Remove-Item Env:SOURCE_DATABASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:TARGET_DATABASE_URL -ErrorAction SilentlyContinue
$redisHost = "127.0.0.1"
$candidate = ""
$previous = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$candidate = ((& wsl -d Ubuntu hostname -I) | Out-String).Trim().Split(" ", [System.StringSplitOptions]::RemoveEmptyEntries) | Select-Object -First 1
$ErrorActionPreference = $previous
if ($candidate) {
    & $python -c "import redis,sys; redis.Redis(host=sys.argv[1], port=6379, socket_connect_timeout=2, socket_timeout=2).ping()" $candidate
    if ($LASTEXITCODE -eq 0) {
        $redisHost = $candidate
    }
}
$env:REDIS_URL = "redis://${redisHost}:6379/0"
& $python -c "import os,redis; redis.Redis.from_url(os.environ['REDIS_URL'], socket_connect_timeout=2, socket_timeout=2).ping()"
if ($LASTEXITCODE -ne 0) {
    Write-Output "Windows cannot reach WSL Redis. Native start refused."
    exit 2
}

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

@($api.Id, $worker.Id, $beat.Id, $web.Id) | Set-Content -Path $pidFile
$ready = $false
foreach ($attempt in 1..20) {
    Start-Sleep -Seconds 2
    if ((Test-LocalPort 8010) -and (Test-LocalPort 3010)) {
        $ready = $true
        break
    }
}
if (-not $ready) {
    Write-Output "Native processes were launched but a port did not open. See scripts/.bowlbyte-dev-logs."
    exit 2
}
Write-Output "Native BowlByte is listening on 3010 and 8010."
