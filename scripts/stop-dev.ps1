# Stop only processes this repository's start script recorded.
# It does not stop Docker, and it does not kill unrelated Node or Python processes.

$ErrorActionPreference = "Stop"
$pidFile = Join-Path $PSScriptRoot ".bowlbyte-dev.pids"
if (-not (Test-Path $pidFile)) {
    Write-Output "No BowlByte native processes were recorded."
    exit 0
}

$ids = Get-Content $pidFile | Where-Object { $_ -match '^\d+$' }
foreach ($processId in $ids) {
    $process = Get-Process -Id ([int]$processId) -ErrorAction SilentlyContinue
    if ($null -eq $process) {
        continue
    }
    if ($process.ProcessName -notin @("python", "node", "redis-server", "celery")) {
        Write-Output "Skipped pid $processId ($($process.ProcessName)); it is not a BowlByte runtime process."
        continue
    }
    Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
    Write-Output "Stopped pid $($process.Id)."
}
Remove-Item $pidFile -ErrorAction SilentlyContinue
