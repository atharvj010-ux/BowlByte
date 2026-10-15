# BowlByte

BowlByte is a college canteen system for counter pickup, kitchen queues, and cash payments. Phases P001–P003 cover the foundation, accounts, and cash-pending orders. Phase P004 adds kitchen acceptance, preparation tasks, station capacity, readiness estimates, and live status updates. Phase P005 adds cash recording by cashiers, one-time QR pickup credentials, a manager-only cash correction, in-app notifications, and Web Push through a database outbox. Phone delivery has **not** been tested on a real Android or iPhone device. Online payments and forecasting are not implemented.

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
| Worker | no host port | Celery worker. Sends Web Push |
| Beat | no host port | Celery beat. Drains the notification outbox every 15 seconds |
| Mailpit | http://127.0.0.1:8025 | Local mailbox UI. SMTP is on 127.0.0.1:1025 |

The API container runs `alembic upgrade head` before Uvicorn. `0002_identity` creates the account tables. `0003_menu_ordering` creates the menu, stock, and order tables. `0004_kitchen_queue` adds preparation tasks and stored readiness estimates. `0005_cash_pickup_notifications` adds cash receipts and reversals, pickup credentials and events, push subscriptions, notifications, the outbox, and append-only protection for the ledgers. The web container proxies `/api/v1/ws` to the API so the browser can use the same origin as its session cookie.

## Push keys

Web Push needs VAPID keys. Generate them once and put the output in `.env`, which is gitignored:

```powershell
docker compose exec backend python -m app.cli.generate_vapid
```

The command prints the keys to the terminal only. Never commit them. The private key is passed only to the worker container, which signs and sends the pushes. Without keys the app still works and the profile page says phone notifications are not set up. Phones need HTTPS, so see `docs/P005_PWA_SETUP.md` and `docs/P005_REAL_DEVICE_TESTING.md` before expecting delivery.

## Development menu sample

This does not create users or orders. Running it twice does not duplicate the sample items.

```powershell
docker compose exec backend python -m app.cli.seed_menu
```

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
| `docs/P003_MENU_ORDERING.md` | Menu, cart, placement, and seed |
| `docs/P003_INVENTORY_CONCURRENCY.md` | Stock locks and idempotency |
| `docs/P003_ORDER_LIFECYCLE.md` | P003 states and the P004 handoff |
| `docs/P003_TEST_RESULTS.md` | Commands that were run for P003 |
| `docs/P004_KITCHEN_ENGINE.md` | Kitchen desk, capacity, and recovery |
| `docs/P004_ORDER_STATE_MACHINE.md` | Order and task transitions |
| `docs/P004_ETA_ALGORITHM.md` | Station-aware readiness estimates |
| `docs/P004_REALTIME_ARCHITECTURE.md` | WebSockets, Redis, and polling |
| `docs/P004_INVENTORY_CONSUMPTION.md` | Reserved stock becomes consumed |
| `docs/P004_TEST_RESULTS.md` | Commands that were run for P004 |
| `docs/P004_KNOWN_LIMITATIONS.md` | What this phase does not do |
| `docs/P005_CASH_PAYMENT.md` | Cash recording, audit, and manager correction |
| `docs/P005_QR_SECURITY.md` | One-time pickup credentials |
| `docs/P005_PUSH_ARCHITECTURE.md` | Outbox, worker, VAPID, SSRF controls |
| `docs/P005_PWA_SETUP.md` | Manifest, service worker, install, permissions |
| `docs/P005_NOTIFICATION_RELIABILITY.md` | Failure handling and what is guaranteed |
| `docs/P005_SECURITY_TESTS.md` | Security and concurrency cases |
| `docs/P005_REAL_DEVICE_TESTING.md` | Phone checklist. Status: NOT TESTED |
| `docs/P005_TEST_RESULTS.md` | Commands that were run for P005 |
| `docs/P005_KNOWN_LIMITATIONS.md` | What this phase does not do |

## Pilot limits

- One canteen, with `canteen_id` reserved for a later second site
- Counter pickup only
- Cash only, in integer paise
- An order may be prepared while payment is pending
- An order cannot be marked picked up until payment is paid
- Students cannot change payment status
- Only cashiers record cash, and only for READY orders
- A pickup code works once, expires after 10 minutes, and scanning it never marks an order paid
- A push notification is a reminder. The order page is the truth
