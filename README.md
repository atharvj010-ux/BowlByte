# BowlByte

BowlByte is a college canteen system for counter pickup, kitchen queues, and cash payments. Phase P001 is the foundation. Phase P002 adds database accounts, email verification, sessions, and role checks. Ordering, cash recording, QR pickup, notifications, and forecasting are not implemented.

## Stack

- Next.js App Router, TypeScript, Tailwind CSS, shadcn/ui, TanStack Query, Zod
- FastAPI, SQLAlchemy 2, Alembic, PostgreSQL 16, Redis, Celery
- Vitest, Pytest, Playwright, GitHub Actions, Docker Compose

Payments are cash only. There is no online payment integration.

## Run the stack

Docker Desktop is required.

```powershell
docker compose up --build
```

| Service | Address | Purpose |
| --- | --- | --- |
| Web | http://127.0.0.1:3000 | Next.js application |
| API | http://127.0.0.1:8000 | FastAPI, including `/docs` in development |
| PostgreSQL | `127.0.0.1:5432` | System of record. Loopback only |
| Redis | `127.0.0.1:6379` | Celery broker. Not bound to a public interface |
| Worker | no host port | Celery worker |
| Mailpit | http://127.0.0.1:8025 | Local mailbox UI. SMTP is on 127.0.0.1:1025 |

The API container runs `alembic upgrade head` before Uvicorn. `0002_identity` creates the account tables.

## First manager

There is no public manager registration page and no seeded password. From `backend/` with the API database reachable:

```powershell
$env:BOWLBYTE_BOOTSTRAP_EMAIL = "manager@college.edu"
$env:BOWLBYTE_BOOTSTRAP_NAME = "Pilot Manager"
python -m app.cli.bootstrap_manager
```

The command prompts for the password, or reads one line from stdin when it is not a terminal. It does not accept the password as an argument and it does not print it. A second run is refused after a manager exists.

Inside Compose:

```powershell
docker compose exec -e BOWLBYTE_BOOTSTRAP_EMAIL=manager@college.edu -e BOWLBYTE_BOOTSTRAP_NAME="Pilot Manager" backend python -m app.cli.bootstrap_manager
```

## Student eligibility

`COLLEGE_ELIGIBILITY_MODE` defaults to `disabled`, so public registration stays closed until the operator chooses one mode:

- `institutional_domain` requires the email domain in `COLLEGE_EMAIL_DOMAIN`. The verification message proves control of that mailbox.
- `roster` requires a preloaded roll number and a long enrollment code. The roll number alone is not enough. Import with `python -m app.cli.import_roster roster.csv` using columns `roll_number,enrollment_code`.

Do not open registration until that data is real. A personal email address is not evidence of enrollment.

Host ports stay on `127.0.0.1`. If a port is already taken, set `POSTGRES_PORT`, `REDIS_PORT`, `BACKEND_PORT`, or `FRONTEND_PORT` in `.env`. When `BACKEND_PORT` changes, set `NEXT_PUBLIC_API_URL` to that same host port and rebuild the web image, because the browser reads the API origin from the built page.

Check the running API:

```powershell
curl http://127.0.0.1:8000/api/v1/health
curl http://127.0.0.1:8000/api/v1/ready
```

`/api/v1/ready` returns HTTP 200 only when PostgreSQL and Redis both answer. The web status page calls the same endpoints.

## Local development without rebuilding images

Start PostgreSQL and Redis with Compose, then:

```powershell
scripts/dev-api.ps1
scripts/dev-web.ps1
```

Copy `.env.example` to `.env` only if you need overrides. The example values are development placeholders, not production secrets. `.env` is gitignored.

## Tests

Frontend:

```powershell
cd frontend
npm run lint
npm run typecheck
npm test
```

Backend:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
ruff check .
ruff format --check .
pytest
```

With Compose (or another PostgreSQL 16 and Redis) already listening on localhost:

```powershell
$env:DATABASE_URL = "postgresql+psycopg://bowlbyte:bowlbyte@localhost:5432/bowlbyte"
$env:REDIS_URL = "redis://localhost:6379/0"
alembic upgrade head
pytest -m integration
```

The integration test is supposed to fail when a dependency is down. Do not treat a skip as a passed connectivity check.

Playwright:

```powershell
cd frontend
npx playwright install chromium
npm run test:e2e
```

## Documentation

| Document | Contents |
| --- | --- |
| `docs/PROJECT_SPECIFICATION.md` | Product contract |
| `docs/ARCHITECTURE.md` | Modular monolith and runtime |
| `docs/ROLES_AND_PERMISSIONS.md` | Account and permission rules |
| `docs/ORDER_STATE_MACHINE.md` | Fulfillment transitions |
| `docs/CASH_PAYMENT_FLOW.md` | Cash, paise, receipt, pickup, void |
| `docs/DATABASE_DESIGN.md` | Target schema, transactions, QR rules |
| `docs/API_PLAN.md` | Implemented and planned HTTP routes |
| `docs/DEVELOPMENT_PHASES.md` | Phase order and test commands |
| `docs/P001_VERIFICATION.md` | P001 baseline, including the unresolved braces advisory |
| `docs/P002_AUTHENTICATION.md` | Sessions, eligibility, invitations, and email |
| `docs/P002_SECURITY_TESTS.md` | Security cases and how they are enforced |
| `docs/P002_TEST_RESULTS.md` | Commands that were run and their results |

## Pilot limits

- One canteen, with `canteen_id` reserved for a later second site
- Counter pickup only
- Cash only, in integer paise
- An order may be prepared while payment is pending
- An order cannot be marked picked up until payment is paid
- Students cannot change payment status
