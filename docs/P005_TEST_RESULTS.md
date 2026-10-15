# P005 test results

Recorded after cash recording, pickup credentials, in-app notifications and Web Push were running on the local BowlByte ports. Only commands that completed are listed. Real-device push is **NOT TESTED**.

## Commands and results

| Check | Result |
| --- | --- |
| `docker compose build backend worker beat frontend`, then `docker compose up -d` | Exit 0. The frontend image build ran the Next.js production build |
| `alembic upgrade head` and `alembic current` in the backend container | `0005_cash_pickup_notifications (head)` |
| `GET http://127.0.0.1:8010/api/v1/health` | 200, `{"status":"ok","service":"bowlbyte-api","environment":"development"}` |
| `GET http://127.0.0.1:8010/api/v1/ready` | 200, postgres up, redis up |
| `GET http://127.0.0.1:3010/sw.js` | 200, `cache-control: no-cache, no-store, must-revalidate`, `service-worker-allowed: /` |
| Beat log | `drain-notification-outbox` sent every 15 seconds |
| Backend `ruff check .` and `ruff format --check .` | All checks passed. 77 files formatted |
| Backend `pytest -m "not integration"` | 48 passed |
| Backend `pytest -m integration` on `bowlbyte_test` (127.0.0.1:5433) and Redis | 81 passed, 2 skipped (the latency report, which needs `P005_PERF=1`) |
| `P005_PERF=1 pytest -m integration tests/test_p005_performance.py` | 2 passed. Figures below |
| Frontend `npm run lint` and `npm run typecheck` | Exit 0 |
| Frontend `npm test` (Vitest) | 9 files, 34 passed |
| Frontend `npm run build` | Succeeded. Routes include `/cashier`, `/cashier/history`, `/admin/cash`, `/student/notifications`, `/student/profile` |
| Frontend `npx playwright test` with `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3010` (1 worker) | 26 passed, 3.0m |
| Frontend `npm audit` | 5 high, 0 critical, 0 moderate, 0 low. Same chain as before (see below) |
| `alembic check` | Fails on six indexes that exist in the database and not in the models, all from P002. No P005 table is involved |
| `python -m app.cli.generate_vapid` in the backend container | Printed the four key names. Values were not recorded here |
| `VAPID_PRIVATE_KEY` in running containers | Present in `worker` only. Empty in `backend`, `beat` and `frontend` |

The Playwright suite uses one worker because the specs reset staff users and orders in the shared pilot database. The reset statements now `TRUNCATE` the append-only P005 tables first, because the ledger trigger refuses `DELETE`.

## Playwright scenarios (`e2e/cash-pickup.spec.ts`, 10 tests)

- **Scenario 1.** Student places an order, the kitchen marks it READY, the cashier sees the amount, confirms cash, the student sees `READY · CASH · PAID`.
- **Scenario 2.** Student shows a pickup code. Cashier checks it by ticket and manual code. Payment is still `PENDING` after the check. The cashier records cash, hands over, and the student sees `PICKED_UP · CASH · PAID`. The credential is redeemed once.
- **Scenario 3.** A handover with a valid credential is refused while payment is pending. The order stays READY and unredeemed.
- **Extra role test.** Cash is refused before READY, for a student, for kitchen staff, and for a wrong amount. A repeat of the same request returns the same result with one receipt.
- **Scenario 4.** A redeemed token and its manual code are refused a second time. Verify and re-issue are refused. A retry with the same key is answered, not repeated.
- **Scenario 5.** Another student gets 403 or 404 for status and issue on someone else's order. No credential row is created.
- **Scenario 6.** A student turns notifications on from the profile page. One subscription row exists and its endpoint is encrypted. READY creates exactly one notification and one outbox row. The worker records `ACCEPTED` with the simulator transport. The notification page shows "Order Ready".
- **Scenario 7.** With the simulator failing, the delivery stays `PENDING` with `http_503`, nothing is `ACCEPTED`, the order stays READY and the in-app record exists.
- **Scenario 8.** With the WebSocket closed, a reload shows READY and the notification history.
- **Scenario 9.** The manager reviews the receipt, a cashier is refused the reversal route, the manager reverses it with a reason, the payment returns to `PENDING`, the receipt and reversal are both kept, and the order can be paid again as receipt 2.
- **Scenario 10.** The existing `auth`, `ordering`, `kitchen` and `smoke` specs (16 tests) were rerun in the same 26-test run and passed.
What these do not prove: the push manager is a stand-in with real P-256 keys, notification permission is simulated, and the push service is the backend simulator. Nothing here touches a real push service or phone. The fake-camera QR scan was not run. The manual code path was.

## Latency (single process, development machine)

Against `bowlbyte_test`, 30 samples each, through the FastAPI test client (no browser, no network hop). These are not capacity claims.

| Operation | Mean | p50 | p95 | Max |
| --- | --- | --- | --- | --- |
| Cash confirmation | 134.1 ms | 111.8 ms | 257.1 ms | 435.6 ms |
| Pickup verify | 71.9 ms | 67.1 ms | 96.7 ms | 97.1 ms |
| Pickup redeem (complete) | 118.5 ms | 97.9 ms | 181.0 ms | 470.8 ms |
| Credential issue | 47.7 ms | 46.2 ms | 55.2 ms | 76.4 ms |
| READY request with the outbox insert | 122.9 ms | 114.3 ms | 185.3 ms | 196.5 ms |
| READY request with the outbox insert stubbed out | 108.7 ms | 104.3 ms | 148.5 ms | 189.9 ms |
| Outbox insert alone, inside READY | 6.7 ms | 6.2 ms | 10.8 ms | 11.1 ms |

The outbox adds about 7 ms of work to the READY transaction (the two READY runs differ by about 14 ms on a noisy machine, which is within run-to-run variation). The kitchen request does no network I/O for push.

Outbox drain with the simulator transport: 30 events, 30 `ACCEPTED`, 2.19 s in total, about 73 ms per event. That is BowlByte's database and encryption work. **Real push service acceptance latency was not measured** and no real service was contacted.

Retry behaviour is covered by the integration tests with a controlled clock: a 503 retries with backoff, a flaky service succeeds on the second attempt, a 429 honours `Retry-After`, a timeout retries, a 410 disables the subscription, and the order stays READY throughout.

Concurrency is covered on PostgreSQL by `test_concurrent_cash_confirmations_create_one_receipt` (one receipt, one conflict), `test_concurrent_redemptions_allow_exactly_one`, and `test_two_workers_do_not_double_deliver`.

## P004 baseline

P004 recorded cumulative place-and-accept time for 10, 50 and 100 orders as 2.22 s, 12.66 s and 25.08 s. The same measurement repeated after P005 (same machine, same single process) gave 2.40 s, 13.49 s and 26.36 s. P005 did not touch the kitchen queue lock and this is about 5 percent slower, which is inside the variation seen between runs. **P005 does not resolve the P004 queue scaling limit.** Each kitchen change still locks the canteen's active orders.

## Unresolved audit finding

`npm audit` reports 5 high findings, all through `eslint-config-next@16.4.0`, `@next/eslint-plugin-next`, `fast-glob`, `micromatch` and `braces` (`GHSA-vfj7-8cjw-p6xm`). The suggested fix installs `eslint-config-next@14.2.35` and breaks this Next.js version. It was not applied. `@zxing/browser`, `@zxing/library` and `qrcode.react` added no findings.
