# P014 native runtime

The live BowlByte processes are Windows processes supervised by `scripts/start-dev.ps1`. They are not children of a short-lived shell. Process IDs are recorded in `scripts/.bowlbyte-dev.pids`, and logs go to `scripts/.bowlbyte-dev-logs/`. Both paths are gitignored.

## Start

```powershell
powershell -File .\scripts\start-dev.ps1
```

The script loads `.env` without printing it, checks the Supabase preflight, and refuses to start when:

- port 3010 or 8010 is already open
- a BowlByte Docker backend, frontend, worker, beat, or Redis container is running
- `SUPABASE_DB_URL` is not the session pooler on port 5432 with `sslmode=verify-full`
- `current_database()` is anything other than `postgres`
- Windows Redis cannot be found

It then starts Redis, Uvicorn, one Celery worker (`--pool=solo -Q bowlbyte`), one Celery Beat, and `node ws-proxy.mjs --dev` with `PORT=3010`. Next.js listens on 3110. The proxy listens on 3010 and forwards `/api/v1/ws`.

`PYTHONUNBUFFERED=1` is set so API logs are written immediately.

## Check and stop

```powershell
powershell -File .\scripts\check-dev.ps1
powershell -File .\scripts\stop-dev.ps1
```

`stop-dev.ps1` stops only recorded Python, Node, Redis, and Celery processes. It does not stop Docker and it does not kill unrelated runtimes. Run it before starting again. A second start is refused while the pid file exists.

## Database guard

FastAPI, the worker, and Beat receive `DATABASE_URL` rewritten from `SUPABASE_DB_URL` to the `postgresql+psycopg` scheme. `E2E_DATABASE` is removed so the worker guard does not confuse the Supabase database name `postgres` with a disposable test database. There is no silent fallback to the Docker database.
