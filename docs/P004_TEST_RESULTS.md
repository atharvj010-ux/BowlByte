# P004 test results

Recorded after kitchen acceptance, preparation tasks, station capacity, readiness estimates, and live updates were running on the local BowlByte ports. These are the commands that completed. The braces audit finding is still open. Institutional roll checks and the shared proxy rate-limit key from P002 are unchanged.

## Commands and results

| Check | Result |
| --- | --- |
| `docker compose up --build -d backend worker` after the queue-lock fix | Exit 0. Backend and worker images rebuilt. Postgres, Redis, Mailpit, and the frontend container left running |
| `docker ps` | `bowlbyte-backend-1` healthy on 127.0.0.1:8010, `bowlbyte-frontend-1` on 127.0.0.1:3010, `bowlbyte-mailpit-1` healthy on 127.0.0.1:8025 and 1025, `bowlbyte-postgres-1` healthy on 127.0.0.1:5433, `bowlbyte-redis-1` healthy on 127.0.0.1:6379, `bowlbyte-worker-1` healthy. `phishing-defense-frontend-1` stayed on 127.0.0.1:3000, `phishing-defense-backend-1` on 127.0.0.1:8000, and `phishing-defense-postgres-1` on 127.0.0.1:5432 |
| `alembic current` inside the backend container | `0004_kitchen_queue` (head) |
| `GET http://127.0.0.1:8010/api/v1/health` | 200, `{"status":"ok","service":"bowlbyte-api","environment":"development"}` |
| `GET http://127.0.0.1:8010/api/v1/ready` | 200, postgres up, redis up |
| `GET http://127.0.0.1:8010/api/v1/health` with `Origin: http://127.0.0.1:3010` | 200, `access-control-allow-origin: http://127.0.0.1:3010` |
| Backend `ruff check .` and `ruff format --check .` | All checks passed. 64 files already formatted |
| Backend `pytest` (integration marker excluded by addopts) | 16 passed |
| Backend `pytest -m integration` against `bowlbyte_test` on 127.0.0.1:5433 and Redis 127.0.0.1:6379 | 22 passed |
| Those two pytest commands, one after the other | Exit 0 in 103.0s |
| `pytest tests/test_kitchen_integration.py::test_queue_timing_for_small_batches -m integration -s` | 1 passed in 26.43s. Cumulative place-and-accept time: 10 orders 2.220486s, 50 orders 12.658546s, 100 orders 25.076005s. All 100 rows were `QUEUED` |
| Frontend `npm run lint` | Exit 0 |
| Frontend `npm run typecheck` | Exit 0 |
| Frontend `npx vitest run` | 6 files, 13 passed, 4.30s |
| Frontend production build | Succeeded inside the frontend image build earlier in this phase (Next.js 16.4). The only frontend edit after that image is `e2e/kitchen.spec.ts`, which is not part of the production bundle |
| Frontend `npx playwright test --workers=1` with `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3010` and `MAILPIT_URL=http://127.0.0.1:8025` | 16 passed, 1.5m |
| Frontend `npm audit` | 5 high-severity findings, 0 critical, 0 moderate, 0 low |

Playwright uses one worker because the specs reset staff users and orders in the shared pilot database.

An earlier full Playwright run, before the canteen-wide queue lock, passed 15 tests and failed scenario 7. The two competing starts returned HTTP 200 and HTTP 500. The 500 was a PostgreSQL deadlock: each start held a different order and then waited to update the other order's estimate. The kitchen service now locks every queued and preparing order in id order before it locks a station or a task. The 16-passed result above is the run after that fix and after the backend image was rebuilt.

## Playwright scenarios

`e2e/kitchen.spec.ts` ran against the live API and the frontend on port 3010:

1. A student ordered a sandwich. Kitchen staff accepted it. The student page showed `QUEUED` and "Live updates connected".
2. Sandwich and coffee were started on separate stations, completed, and packed. The student page showed `READY` and the cash-counter sentence. The viewport was 390px wide. No paid or picked-up control was present.
3. Two orders shared a station with capacity 1. The second order's `eta_ready_at` was later. The second start showed "That station is at capacity." After the first task was completed, the second task could start.
4. Staff recorded a 300 second delay. The student page showed the delay message, stayed `PREPARING`, and did not show a completed task.
5. The student socket was closed. The page showed it was checking for updates. After the kitchen accepted the order, polling showed `QUEUED`.
6. Cash stayed `PENDING`. The kitchen page has no payment confirmation control and no pickup action.
7. Two staff members posted a start for the last slot at the same time. The statuses were 200 and 409.

`e2e/ordering.spec.ts`, `e2e/auth.spec.ts`, and `e2e/smoke.spec.ts` also passed in that 16-test run: menu publish, place and cancel, the last-portion race, registration, invitation and deactivation, the cash-only landing statement, and the anonymous redirect from `/student`.

## Backend cases

`tests/test_eta_unit.py` uses a fixed clock. It covers the parallel-station example (the later station finish plus the packing buffer), capacity 2 running two tasks together, capacity 1 running them in order, an overdue running task that stays unfinished, and a recorded delay that moves the finish later.

`tests/test_kitchen_integration.py` uses real PostgreSQL transactions. It covers kitchen-only acceptance, student and cashier denial, cross-canteen denial, one task per portion, duplicate accept not duplicating tasks, reserved stock moving to consumed once, duplicate start and duplicate complete, ready only after every task is done with `CASH` / `PENDING` still valid, rejection releasing reservations once, rejection blocked after a task has started, a capacity-1 race that allows one start, station and duration snapshots that survive a later menu edit, WebSocket origin and session checks, a foreign order subscription being closed, and the database staying consistent when event publish fails.

The existing auth and ordering integration modules still pass, including student cancellation of a `PLACED` order.

## Unresolved audit finding

`npm audit` reports 5 high findings, all from `eslint-config-next@16.4.0` through `@next/eslint-plugin-next`, `fast-glob`, `micromatch`, and `braces` (`GHSA-vfj7-8cjw-p6xm`). The suggested fix would install `eslint-config-next@14.2.35` and break this Next.js version. It was not applied.
