# P012 student tests

Not a full student pass.

Verified this session:

- Backend unit tests: 77 passed, 90 integration tests deselected.
- Vitest: 14 files, 47 tests passed.
- Login form still validates an empty submit and reveals the password.
- Supabase and local counters for users, orders, items, payments, receipts, and menu items match the earlier snapshot. That does not prove a student can order on Supabase.

Not run:

- Browser login, registration, menu, cart flight, checkout, success animation, tracking, notifications, QR, logout, and the 360 / 390 / 768 / 1280 / 1440 layouts.
- Email verification and password-reset delivery.
- Playwright. Those specs delete orders and staff from the database named in the app URL. The host URL names the live `bowlbyte` database, so they were not started.

The running Docker site was left in place and was not rebuilt with these frontend changes.
