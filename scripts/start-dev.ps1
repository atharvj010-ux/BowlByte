# Start BowlByte only after the Supabase cutover settings are usable.
# This script does not print secret values and does not stop Docker.
# While the check fails, the Docker Compose stack remains the runtime.

$ErrorActionPreference = "Stop"
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

Write-Output "Refusing to start a second runtime. Finish the verified Supabase restore before leaving Docker."
exit 2
