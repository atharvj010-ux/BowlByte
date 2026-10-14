$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..\backend")
if (-not (Test-Path ".venv\Scripts\python.exe")) {
  python -m venv .venv
}
& .\.venv\Scripts\python.exe -m pip install -e ".[dev]"
& .\.venv\Scripts\alembic.exe upgrade head
& .\.venv\Scripts\uvicorn.exe app.main:app --reload --host 127.0.0.1 --port 8000
