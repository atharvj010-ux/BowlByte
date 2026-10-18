# P016 four-role acceptance

The four-role browser run in this phase used the disposable database `bowlbyte_e2e` on `127.0.0.1:55432` and Redis database 15. Supabase settings were cleared for that process, so sign-in used local passwords. It is not hosted Supabase Auth proof.

## Isolated stack

- API: `http://127.0.0.1:8011`
- Web: `http://127.0.0.1:3011` with `NEXT_DIST_DIR=.next-e2e`
- Mail capture: SMTP `127.0.0.1:1025` and a local mailbox on port 8025
- Celery worker: one solo worker on queue `bowlbyte`, Redis database 15, no Beat
- Redis database 15 was flushed before the run
- The live API on 8010, the live worker, and the live Beat were left running

Playwright on 18 October 2026: **57 passed, 1 skipped**, exit 0, about 6.6 minutes. The skip is `capture landing frames at five widths`, which runs only when `P009_SHOTS=1`.

The temporary database-15 worker was stopped after the run. The live scheduler was still the single Beat started with the native stack.

## Coverage in that passing run

Student: landing, menu publication, cart and order confirmation, privacy across refresh, a second tab, logout, and the back button, plus cross-student denial.

Kitchen: queue, acceptance, station slots, delay, disconnected-student recovery, and the cash boundary.

Cashier: QR and manual pickup, rejection of bad, expired, foreign, and replayed codes, and a paid ready order.

Manager: menu, stock, staff, cash, forecasting, production, and waste screens in the isolated specs. Forecast scenario 2 persisted an evaluation, which requires the isolated worker to consume the training task.

Order placement, stock conflict, cancellation, and idempotent server behavior are also covered by the backend integration suite in `docs/P016_FINAL_REGRESSION.md`.

## Not claimed from this run

Hosted Supabase passwords, Brevo inbox delivery, and a phone receiving a Web Push were not part of this suite.
