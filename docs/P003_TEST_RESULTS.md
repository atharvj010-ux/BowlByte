# P003 test results

Recorded after menu, stock, and cash-pending ordering were running on the local BowlByte ports. These are the commands that completed. The braces audit finding is still open. Institutional roll checks and the shared proxy rate-limit key from P002 are unchanged.

## Commands and results

| Check | Result |
| --- | --- |
| `docker compose up -d --build` | Exit 0. Backend, worker, and frontend images rebuilt. Postgres, Redis, and Mailpit left running |
| `docker compose ps` | `bowlbyte-backend-1` healthy on 127.0.0.1:8010, `bowlbyte-frontend-1` on 127.0.0.1:3010, `bowlbyte-mailpit-1` healthy on 127.0.0.1:8025 and 1025, `bowlbyte-postgres-1` healthy on 127.0.0.1:5433, `bowlbyte-redis-1` healthy on 127.0.0.1:6379, `bowlbyte-worker-1` healthy |
| `alembic current` inside the backend container | `0003_menu_ordering` (head) |
| `GET http://127.0.0.1:8010/api/v1/health` | 200, `environment` `development` |
| `GET http://127.0.0.1:8010/api/v1/ready` | 200, postgres up, redis up |
| `GET http://127.0.0.1:3010/api/v1/health` | 200 |
| Backend `ruff check .` and `ruff format --check .` | All checks passed. 55 files already formatted |
| Backend `pytest` (integration marker excluded by addopts) | 11 passed, 17 deselected, 0.46s |
| Backend `pytest -m integration` against `bowlbyte_test` on 127.0.0.1:5433, Redis 127.0.0.1:6379, SMTP 127.0.0.1:1025, Mailpit `http://127.0.0.1:8025` | 17 passed, 11 deselected, 39.25s |
| Frontend `npm run lint` | Exit 0 |
| Frontend `npm run typecheck` | Exit 0 |
| Frontend `npm test` (Vitest) | 6 files, 13 passed |
| Frontend production build inside `docker compose build` | Exit 0. Next.js compiled 29 routes. Protected account routes are partial prerender. `/api/v1/[...path]` is dynamic |
| Frontend `npx playwright test --workers=1` with `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3010` and `MAILPIT_URL=http://127.0.0.1:8025` | 9 passed, 38.7s |
| Frontend `npm audit` | Exit 1. 5 high-severity findings, no critical, moderate, or low findings |
| `python -m app.cli.seed_menu` inside the backend container, run twice | First run `created=8 skipped=0`. Second run `created=0 skipped=8` |

Playwright uses one worker because `e2e/auth.spec.ts` and `e2e/ordering.spec.ts` both reset staff users and orders in the shared pilot database. Parallel workers raced and were not treated as a pass.

## Playwright scenarios

`e2e/ordering.spec.ts` ran against the rebuilt frontend and the live API:

1. A bootstrapped manager created a station, a category, and a menu item. A verified student saw that item on `/student/menu`.
2. The student added two items, placed an order, and the ticket row in PostgreSQL was `PLACED` with payment method `CASH`. Kitchen staff then saw that ticket on `/staff`.
3. The student cancelled the order. The status line showed `CANCELLED · CASH · PENDING`. A stock query found no negative available or reserved quantities. A second student opening the same order URL saw the denial state.
4. Two signed-in students posted orders for the last available portion at the same time. Exactly one response was HTTP 201. A count of negative stock rows was 0.

`e2e/auth.spec.ts` and `e2e/smoke.spec.ts` also passed in the same 9-test run: phone registration layout, student verify/login/logout, manager invitation with kitchen login and deactivation, the cash-only landing statement, and the anonymous redirect from `/student`.

## Backend cases

`tests/test_ordering_integration.py` uses real PostgreSQL transactions, including two independent sessions for the last-portion race and the repeated idempotency key. Together with the existing auth integration module it covers menu reads, manager edits, kitchen and student denial of price changes, invalid quantities and item ids, cross-canteen denial, unavailable and oversold stock, server-side price recalculation, integer paise totals, snapshot stability after a price change, `PLACED` plus `CASH` / `PENDING`, rejection of paid/ready/picked-up fields, object-level order privacy, canteen scoping, idempotency conflicts, single stock release on cancel, and CSRF on an unsafe order request. Health and readiness stay in the integration suite.

`tests/test_ordering_unit.py` checks canonical idempotency hashing and image magic-byte rejection.

## Unresolved audit finding

`npm audit` still reports the same five high-severity findings recorded in `docs/P001_VERIFICATION.md` and `docs/P002_TEST_RESULTS.md`. They are one development-toolchain chain:

`eslint-config-next@16.4.0` → `@next/eslint-plugin-next@16.4.0` → `fast-glob@3.3.1` → `micromatch@4.0.8` → `braces@3.0.3`

Advisory: [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). `braces@3.0.3` is the newest published release. `npm audit fix --force` would install `eslint-config-next@14.2.35`, which is incompatible with Next.js 16.4. That downgrade was not applied.

## Limitations that remain

- Institutional email mode checks the domain only. It does not prove that a roll number belongs to that student.
- Login rate limiting behind the Next.js proxy shares one client key. The per-email limit is still separate.
- Menu photos are validated JPEG, PNG, or WebP bytes stored in PostgreSQL. There is no object-storage volume.
- Cash collected stays unavailable. P003 does not confirm payment, mark an order ready, or mark it picked up.
- Station capacity and preparation seconds are stored for P004. P003 does not schedule the kitchen.
