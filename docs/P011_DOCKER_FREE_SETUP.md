# P011 Docker-free setup

Status: not activated.

`scripts/start-dev.ps1` loads `.env` without printing values, then runs `python -m app.cli.supabase_preflight`. The check exits 2 when a required setting is missing or when `SUPABASE_CREDENTIALS_ROTATED` is not `yes`. It does not start FastAPI, Next.js, Redis, or Celery, and it does not stop Docker. That flag is unset.

`scripts/stop-dev.ps1` stops only process ids recorded in `scripts/.bowlbyte-dev.pids`, and only when the process name is `python`, `node`, `redis-server`, or `celery`. No pid file has been written.

## Host tools found

- Node.js and Python are installed.
- `psql`, `pg_dump`, and `redis-cli` are not on the Windows `PATH`.
- WSL has an Ubuntu distro. It is stopped. Docker Desktop's WSL distro is running because Compose is still the runtime.
- Redis remains the Compose service published on the loopback interface.

Do not point a native worker at Supabase while the Compose worker is still writing to local PostgreSQL. Only one Celery Beat may run, and that Beat is the Compose service today.

The intended native addresses, after a verified cutover, are `http://127.0.0.1:3010` for Next.js and `http://127.0.0.1:8010` for FastAPI. Those ports are still served by the Compose stack.
