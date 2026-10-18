# P016 zero-Docker audit

Docker is retired. BowlByte starts, tests, and builds without calling it. Historical phase notes may still mention the old Compose stack. Those notes are not setup instructions.

## Classification

| Class | Meaning | What remains |
| --- | --- | --- |
| A. Active dependency | A command, workflow, or fixture that invokes Docker | None found after this phase |
| B. Obsolete implementation | Files that existed only to build or run containers | Removed from the working tree |
| C. Historical documentation | Older phase reports that describe the retired stack | Left in `docs/` so the history stays readable |
| D. Harmless wording | The word Docker used only to say it is not used | `README.md`, `scripts/start-dev.ps1` |

## Removed implementation

- `backend/Dockerfile`
- `frontend/Dockerfile`
- `docker-compose.yml`
- `docker-compose.staging.yml`
- `.dockerignore`
- `scripts/compose-up.ps1`
- `scripts/compose-up.sh`

Git history still contains those files. Backups under `%LOCALAPPDATA%\BowlByte\p011` were not deleted. Docker Desktop was not uninstalled. No container was started or removed.

## Active path after cleanup

- `scripts/start-dev.ps1` no longer runs `docker ps`. It starts Windows Redis, FastAPI on port 8010, one Celery worker, one Beat process, and the Next.js proxy on port 3010.
- `scripts/stop-dev.ps1` stops those recorded native processes only.
- `.github/workflows/ci.yml` has no service containers. It runs frontend lint, typecheck, and Vitest, plus backend Ruff and unit pytest. Integration tests stay on the local disposable database.
- Playwright uses `frontend/e2e/safe-db.ts` and the portable PostgreSQL binaries. It does not call Compose.
- Integration tests call `require_disposable_database()` and accept only `127.0.0.1:55432/bowlbyte_e2e`.
- `.env.example` no longer tells an operator to start Compose, Mailpit, or a local `bowlbyte` database.

## Disposable test database

Portable PostgreSQL 17.6 is already installed at `%LOCALAPPDATA%\BowlByte\pgsql17`. The cluster listens on `127.0.0.1:55432`. Database and user are `bowlbyte_e2e`. The password stays in `%LOCALAPPDATA%\BowlByte\e2e\db.env` and is not committed. This phase did not create another cluster.

## Proof

On 18 October 2026 the active scripts, workflow, example environment, and test helpers were searched for `docker`. The only remaining uses in those files are sentences that say Docker is not used. Native health checks against ports 3010 and 8010 succeeded without a Docker command.
