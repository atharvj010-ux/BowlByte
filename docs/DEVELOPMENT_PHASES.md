# Development phases

The pilot is built in phases so each phase can be demonstrated with real checks. A phase does not mark a later feature as working.

## P001 — Foundation and architecture

Status: this repository.

- Monorepo, Next.js shells, FastAPI, PostgreSQL, Redis, Celery, Alembic, Compose, CI, and these documents
- Health and readiness only
- No accounts, orders, cash recording, push, QR, or forecasts

## P002 — Identity and access

Implemented. See `docs/P002_AUTHENTICATION.md` and `docs/P002_TEST_RESULTS.md`.

- Student registration with a college eligibility rule, Argon2id, and Mailpit email verification
- Database sessions in HttpOnly cookies
- Bootstrap command for the first canteen manager
- Manager invitations for kitchen staff and cashiers
- Server-side protection for `/student`, `/staff`, `/cashier`, and `/admin`

Menu, cart, ordering, cash recording, QR pickup, forecasting, push, and WebSockets remain out of scope.

## P003 — Menu, stock, and cash-pending orders

Implemented. See `docs/P003_MENU_ORDERING.md`, `docs/P003_INVENTORY_CONCURRENCY.md`, and `docs/P003_ORDER_LIFECYCLE.md`.

- Manager menu, categories, stations, and daily portions
- Student cart and real `PLACED` orders with a `CASH` / `PENDING` payment
- Student cancellation of their own `PLACED` order, releasing reserved stock once
- Kitchen list of incoming `PLACED` tickets
- No preparation transitions, ETA, cash confirmation, or QR pickup

## P004 — Kitchen queue and preparation

Implemented. See `docs/P004_KITCHEN_ENGINE.md`, `docs/P004_ORDER_STATE_MACHINE.md`, `docs/P004_ETA_ALGORITHM.md`, `docs/P004_REALTIME_ARCHITECTURE.md`, `docs/P004_INVENTORY_CONSUMPTION.md`, `docs/P004_TEST_RESULTS.md`, and `docs/P004_KNOWN_LIMITATIONS.md`.

- Accept, reject, start, complete, delay, and packed-ready transitions
- One preparation task per ordered unit, station snapshot, and capacity locks
- Reserved stock becomes consumed when a task starts
- Station-aware ETA with an uncertainty range
- WebSocket hints plus polling, with PostgreSQL as the record
- No cash confirmation, QR pickup, or Web Push (these arrived in P005)

## P005 — Cash, QR pickup, and Web Push

Implemented, with one open item: real Android and iPhone delivery is NOT TESTED. See `docs/P005_CASH_PAYMENT.md`, `docs/P005_QR_SECURITY.md`, `docs/P005_PUSH_ARCHITECTURE.md`, `docs/P005_PWA_SETUP.md`, `docs/P005_NOTIFICATION_RELIABILITY.md`, `docs/P005_SECURITY_TESTS.md`, `docs/P005_REAL_DEVICE_TESTING.md`, `docs/P005_TEST_RESULTS.md`, and `docs/P005_KNOWN_LIMITATIONS.md`.

- Cashier receipt transaction with idempotency and numbered receipts
- Separate pickup transaction that needs READY and PAID and a one-time credential
- QR tokens and manual codes stored only as keyed hashes
- Manager reversal with a reason, before pickup only, by appending a row
- Cashier desk with camera scan and manual fallback, manager cash view
- In-app notifications, a PWA manifest and service worker, VAPID Web Push through a Postgres outbox, Celery worker and beat
- Tests that a student cannot change payment status and that READY plus PENDING cannot become PICKED_UP

## P006 — Food intelligence

Implemented. Production batches, recorded waste, demand history, a seasonal-naive baseline, a scikit-learn gradient-boosting candidate, and manager preparation plans. Forecasts and plans do not change orders, payments, or stock. See `docs/P006_FOOD_INTELLIGENCE.md`.

## P007 — Security and performance hardening

Not started. Carry forward the open P005 items and the P006 limits in `docs/P006_KNOWN_LIMITATIONS.md`.

- Real-device push validation on HTTPS staging
- Hold window and `UNCLAIMED` for READY orders nobody collects
- Cash shift close
- Dead-letter alerting for failed push deliveries
- The P004 canteen-wide queue lock
- The five high ESLint development findings, without `npm audit fix --force`

## P008

Not scheduled. Do not treat a later phase as a place to invent payment or forecast behaviour that P006 already defined.

## Test commands

Frontend, from `frontend/`:

```powershell
npm run lint
npm run typecheck
npm test
```

`npm run test:e2e` runs Playwright against a running site. It is not part of the default unit command. Set `PLAYWRIGHT_BASE_URL` if the site is not at `http://127.0.0.1:3000`.

Backend, from `backend/` with the virtualenv active:

```powershell
ruff check .
ruff format --check .
pytest
alembic upgrade head
pytest -m integration
```

Integration tests must point `DATABASE_URL` at the `bowlbyte_test` database. They truncate tables. The optional P005 latency report runs with `P005_PERF=1 pytest -o addopts="" -m integration -s tests/test_p005_performance.py`.

`pytest` excludes the integration marker. The integration test calls the live readiness endpoint and fails if PostgreSQL or Redis is down. Export `DATABASE_URL` and `REDIS_URL` first. The Docker Compose defaults are in `.env.example`.

GitHub Actions runs the frontend commands and, with PostgreSQL 16 and Redis service containers, the backend lint, migration, unit tests, and integration test.

## Runtime commands

Full stack:

```powershell
docker compose up --build
```

Or `scripts/compose-up.ps1`.

API only, after PostgreSQL and Redis are reachable:

```powershell
scripts/dev-api.ps1
```

Web only:

```powershell
scripts/dev-web.ps1
```

The API listens on `http://127.0.0.1:8000`. The web app listens on `http://127.0.0.1:3000`. Database and Redis host ports are loopback-only.
