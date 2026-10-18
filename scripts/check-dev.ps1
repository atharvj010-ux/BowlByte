# Read-only health check for the native BowlByte processes.
# It prints status words and HTTP codes, never secrets or connection strings.

$ErrorActionPreference = "Stop"
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}
$Root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $Root "backend\.venv\Scripts\python.exe"
$pidFile = Join-Path $PSScriptRoot ".bowlbyte-dev.pids"

function Test-LocalPort([int]$Port) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $wait = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
        if (-not $wait.AsyncWaitHandle.WaitOne(400, $false)) { return $false }
        $client.EndConnect($wait)
        return $true
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

if (Test-Path $pidFile) {
    $ids = @(Get-Content $pidFile | Where-Object { $_ -match '^\d+$' })
    Write-Output "recorded_pids $($ids.Count)"
} else {
    Write-Output "recorded_pids 0"
}
Write-Output ("port_3010 " + $(if (Test-LocalPort 3010) { "open" } else { "closed" }))
Write-Output ("port_8010 " + $(if (Test-LocalPort 8010) { "open" } else { "closed" }))
foreach ($url in @("http://127.0.0.1:3010/", "http://127.0.0.1:8010/api/v1/health", "http://127.0.0.1:8010/api/v1/ready")) {
    $code = & curl.exe -s -o NUL -w "%{http_code}" --max-time 8 $url
    if (-not $code) { $code = "down" }
    Write-Output "$url $code"
}
if (Test-Path $python) {
    & $python -c "import os,redis; url=os.environ.get('REDIS_URL','redis://127.0.0.1:6379/0'); redis.Redis.from_url(url, socket_connect_timeout=2, socket_timeout=2).ping(); print('redis_ping ok')"
}
