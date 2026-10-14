# Development phases

The pilot is built in phases so each phase can be demonstrated with real checks. A phase does not mark a later feature as working.

## P001 — Foundation and architecture

Status: this repository.

- Monorepo, Next.js shells, FastAPI, PostgreSQL, Redis, Celery, Alembic, Compose, CI, and these documents
- Health and readiness only
- No accounts, orders, cash recording, push, QR, or forecasts

## P002 — Identity and access

Start here after P001.

- Student self-registration and a real email verification step
- Server sessions
- Bootstrap command for the first canteen manager
- Manager provisioning of kitchen staff and cashiers
- Protect `/student`, `/staff`, `/cashier`, and `/admin` with those sessions
- Tests that prove a student cannot call a staff route and an unverified student cannot gain a staff role

Do not start P002 by building the menu or the payment routes. The shells are already in place, and they are unsafe to fill with operational data before authorization exists.

## P003 — Menu, stations, and stock

- Manager-managed menu items with `price_paise`
- Stations and capacity
- Stock movements
- Students can read the published menu and see an honest empty state when nothing is published

## P004 — Orders and the kitchen queue

- Place order in one transaction, with a PENDING cash payment row and no payment provider
- Implement the fulfillment transitions except pickup
- Kitchen screen updates through the API, then WebSockets when the polling version is correct
- ETA from workload, station capacity, and item preparation minutes
- Concurrency tests for conflicting transitions

## P005 — Cash receipt and pickup

- Cashier receipt transaction
- Separate pickup transaction that refuses PENDING and VOIDED payments
- QR tokens stored as hashes
- Manager void with a reason
- Tests that a student cannot change payment status and that READY plus PENDING cannot become PICKED_UP

## P006 — Notifications

- In-app notification rows
- VAPID Web Push with subscriptions created by the browser
- Attempt status `PENDING`, `SENT`, and `FAILED` based on the real send result
- No UI copy that says a push was delivered unless the attempt is `SENT`

## P007 — Waste, unclaimed orders, and manager analytics

- Hold window and UNCLAIMED transition
- Waste recorded from cancellation during preparation and from unclaimed food
- Manager summaries computed from stored orders and payments

## P008 — Demand forecasting

- Only after P004 has produced real order history
- scikit-learn model, training script, and an evaluation against held-out days
- The UI shows a forecast only from that output, with the model version and the evaluation window

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
