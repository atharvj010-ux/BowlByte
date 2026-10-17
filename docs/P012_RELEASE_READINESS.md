# P012 release readiness

Status: blocked.

## What changed

- Password recovery endpoints and pages for the current cookie session, with Redis tokens and branded HTML plus text.
- `Retry-After` on rate limits, and new Redis limits for orders, cash confirmation, pickup completion, push tests, staff invitations, forecast training, and WebSocket connects.
- API and Next.js security headers. HSTS only on an HTTPS API request.
- Order success copy is `ORDER IN.` / `HAPPINESS LOADING.` Tracking uses `THE KITCHEN'S ON IT.` only for `ACCEPTED`.
- Cart flight arc is higher. Cart state is still written before the flight.
- Supabase preflight now stops when `SUPABASE_CREDENTIALS_ROTATED` is not `yes`.

## Evidence

- Backend unit tests: 77 passed. Integration tests were not run.
- Vitest: 47 passed.
- Ruff is clean on the application package. Two pre-existing long lines remain in integration tests.
- Live PostgreSQL and Supabase, rechecked read-only: 263 users, 286 menu items, 1 order, 2 order items, 1 payment, 0 receipts. Supabase is Alembic `0010_supabase_auth_link` with 0 auth links and 0 anon/authenticated grants. Local Docker is `0009_menu_organization`.
- Auth: signup disabled, autoconfirm off, 0 Auth users.

## Still blocked

1. Rotate the Supabase secret key. The value in `.env` is still the chat-pasted key.
2. Rotate the database password. A failed Alembic run printed the URI.
3. Set `SUPABASE_CREDENTIALS_ROTATED=yes` only after both replacements exist in `.env` and nowhere else.
4. Configure custom SMTP, then prove one verification message and one reset message.
5. Prove Argon2id import with one disposable Auth user before importing the 263 accounts.
6. Re-snapshot after writers are stopped. The matching counts above are a point-in-time read while Docker is still the writer.
7. Do not retire Docker, and do not delete `bowlbyte-p012.dump` or the Postgres volume.

Email delivery, phone push, a browser pass of the new animation, role end-to-end tests, and a Docker-free runtime were not verified.
