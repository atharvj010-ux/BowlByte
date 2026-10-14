# BowlByte API

Phase P001 backend foundation. The API exposes liveness and readiness. It does not place orders, record cash, send notifications, or forecast demand.

## Local setup

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
```

Copy the repository `.env.example` values into the environment, or rely on the local defaults in `app/core/config.py`. Those defaults match the Docker Compose development database and are not production secrets.

## Run

```powershell
alembic upgrade head
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

The worker process is separate:

```powershell
celery -A app.worker.celery_app worker --loglevel=INFO
```

`bowlbyte.worker_ping` only proves that a worker can execute a task. It does not send notifications.

## Tests

Unit tests do not claim that PostgreSQL or Redis are reachable:

```powershell
pytest
ruff check .
ruff format --check .
```

The readiness integration test connects to the `DATABASE_URL` and `REDIS_URL` already exported in the shell. Run it only while those services are up. A failure means connectivity failed.

```powershell
pytest -m integration
```

## Migrations

```powershell
alembic upgrade head
```

`0001_baseline` establishes the migration chain and creates no domain tables.
