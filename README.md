# BowlByte

BowlByte is a college canteen system for counter pickup, kitchen queues, and cash payments. Phases P001–P003 cover the foundation, accounts, and cash-pending orders. Phase P004 adds kitchen acceptance, preparation tasks, station capacity, readiness estimates, and live status updates. Phase P005 adds cash recording by cashiers, one-time QR pickup credentials, a manager-only cash correction, in-app notifications, and Web Push through a database outbox. Phone delivery has **not** been tested on a real Android or iPhone device. Phase P006 adds production and waste records, demand history, a baseline forecast, a scikit-learn candidate, and preparation plans. Phase P007 adds a canteen pickup hold for food that is ready and not collected, trusted proxy client labels for login limits, and operator push metrics. Phase P008 prepares an isolated staging project and the academic handover. It does not add a public deployment. Forecasts do not change orders, payments, or stock. There is no online payment.

## Stack

- Next.js App Router, TypeScript, Tailwind CSS, shadcn/ui, TanStack Query, Zod
- FastAPI, SQLAlchemy 2, Alembic, Supabase PostgreSQL, Redis, Celery
- Vitest, Pytest, Playwright, GitHub Actions

Payments are cash only. There is no online payment integration.

## Run the stack

The live runtime is native Windows processes plus Supabase. Docker is not used.

```powershell
powershell -File .\scripts\start-dev.ps1
powershell -File .\scripts\check-dev.ps1
powershell -File .\scripts\stop-dev.ps1
```

`start-dev.ps1` refuses to launch unless `SUPABASE_DB_URL` is the session pooler on port 5432 with `sslmode=verify-full`, and unless `current_database()` is `postgres`. It listens on http://127.0.0.1:3010 and http://127.0.0.1:8010, starts one Celery worker and one Beat process, and uses Windows Redis on `127.0.0.1:6379`. Details are in `docs/P014_NATIVE_RUNTIME.md` and `docs/P014_REDIS_CELERY.md`.

New orders live in Supabase. Historical dumps under `%LOCALAPPDATA%\BowlByte\p011` stay in place. Do not delete those backups. Docker is retired; see `docs/P016_ZERO_DOCKER_AUDIT.md`.

| Service | Address | Purpose |
| --- | --- | --- |
| Web | http://127.0.0.1:3010 | Next.js plus the WebSocket proxy |
| API | http://127.0.0.1:8010 | FastAPI, including `/docs` in development |
| PostgreSQL | Supabase session pooler, port 5432 | System of record. TLS verified |
| Redis | `127.0.0.1:6379` | Celery broker. Loopback only |
| Worker | no host port | Celery worker, solo pool |
| Beat | no host port | One scheduler. Drains the notification outbox |
| Mail | Brevo SMTP in `.env` | Live mail. Inbox receipt is a separate check. |

Apply schema changes with `python -m alembic upgrade head` from `backend/` against the intended database. `0002_identity` creates the account tables. `0003_menu_ordering` creates the menu, stock, and order tables. `0004_kitchen_queue` adds preparation tasks and stored readiness estimates. `0005_cash_pickup_notifications` adds cash receipts and reversals, pickup credentials and events, push subscriptions, notifications, the outbox, and append-only protection for the ledgers. The Node proxy on port 3010 forwards `/api/v1/ws` to the API so the browser can use the same origin as its session cookie.

## Push keys

Web Push needs VAPID keys. Generate them once and put the output in `.env`, which is gitignored:

```powershell
backend\.venv\Scripts\python.exe -m app.cli.generate_vapid
```

The command prints the keys to the terminal only. Never commit them. The private key is read only by the Celery worker, which signs and sends the pushes. Without keys the app still works and the profile page says phone notifications are not set up. Phones need HTTPS, so see `docs/P005_PWA_SETUP.md` and `docs/P005_REAL_DEVICE_TESTING.md` before expecting delivery.

## Development menu sample

This does not create users or orders. Running it twice does not duplicate the sample items.

```powershell
backend\.venv\Scripts\python.exe -m app.cli.seed_menu
```

## First manager

There is no public manager registration page and no seeded password. From `backend/` with the API database reachable:

```powershell
$env:BOWLBYTE_BOOTSTRAP_EMAIL = "manager@college.edu"
$env:BOWLBYTE_BOOTSTRAP_NAME = "Pilot Manager"
python -m app.cli.bootstrap_manager
```

The command prompts for the password, or reads one line from stdin when it is not a terminal. It does not accept the password as an argument and it does not print it. A second run is refused after a manager exists.

The same command works from `backend/` with the virtualenv Python. It writes the manager into whichever database `DATABASE_URL` points at, so set that to Supabase before using it on the live system.

## Student eligibility

`COLLEGE_ELIGIBILITY_MODE` defaults to `disabled`, so public registration stays closed until the operator chooses one mode:

- `institutional_domain` requires the email domain in `COLLEGE_EMAIL_DOMAIN`. The verification message proves control of that mailbox.
- `roster` requires a preloaded roll number and a long enrollment code. The roll number alone is not enough. Import with `python -m app.cli.import_roster roster.csv` using columns `roll_number,enrollment_code`.

Do not open registration until that data is real. A personal email address is not evidence of enrollment.

The web app listens on `127.0.0.1:3010` and the API on `127.0.0.1:8010`.

Check the running API:

```powershell
curl http://127.0.0.1:8010/api/v1/health
curl http://127.0.0.1:8010/api/v1/ready
```

`/api/v1/ready` returns HTTP 200 only when PostgreSQL and Redis both answer. The web status page calls the same endpoints.

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

Integration tests refuse every database except the disposable server on `127.0.0.1:55432`, database `bowlbyte_e2e`, and they refuse Redis database 0. Point `DATABASE_URL` and `REDIS_URL` at those targets, then:

```powershell
alembic upgrade head
pytest -o addopts= -m integration
```

Do not point that command at Supabase. The integration test is supposed to fail when the disposable database is down. Do not treat a skip as a passed connectivity check.

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
| `docs/P006_FOOD_INTELLIGENCE.md` | Production, forecasts, and plans |
| `docs/P006_PRODUCTION_ACCOUNTING.md` | Batch equation and reconciliation |
| `docs/P006_FORECASTING_METHODOLOGY.md` | Target, features, and models |
| `docs/P006_MODEL_EVALUATION.md` | Time-ordered scores from the demo run |
| `docs/P006_PREPARATION_OPTIMIZATION.md` | Quantity rule and station minutes |
| `docs/P006_TEST_RESULTS.md` | Commands that were run for P006 |
| `docs/P006_KNOWN_LIMITATIONS.md` | What this phase does not do |
| `docs/P007_RELEASE_READINESS.md` | Pilot decision and remaining blockers |
| `docs/P016_RELEASE_READINESS.md` | Final local release decision and remaining limits |

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
