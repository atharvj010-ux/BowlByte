# P013 status

Status: P013.3 is PASS WITH ISSUES. Credential rotation is still blocked, inbox delivery is still unverified, and the browser suite ran only against a disposable database.

## P013.2

Public Supabase signup is now disabled (`disable_signup` true) and autoconfirm is off. `SUPABASE_CREDENTIALS_ROTATED` is still unset, so no users were imported and `DATABASE_URL` was not switched.

The host mailer sent one verification message and one password-reset message through Brevo to `SMTP_TEST_RECIPIENT`. Both used the app templates, HTML and plain text, and links on port 3010. The isolated test database accepted the verification token once, rejected reuse and expiry, accepted the recovery token once, rejected reuse, and deleted the old session. The disposable test user was removed. Inbox receipt was not observed.

SMTP SUBMISSION SUCCESSFUL — INBOX DELIVERY NOT YET VERIFIED.

The API container now takes SMTP settings from the private environment instead of a hardcoded Mailpit block. The secret is not in the Compose file or the image. A checked container reported the Brevo host, port 587, STARTTLS, and a non-local sender. Local Mailpit remains available. One Celery Beat process is still running.

Anonymous order and tracking requests return 401. A logged-out visit to an order URL redirects to sign-in. Login and logout clear cached orders, notifications, and the cart. The frontend and backend images were rebuilt without removing volumes. Local Postgres moved from `0009_menu_organization` to additive `0010_supabase_auth_link`. All 263 users remain. The worker image was left in place.

Isolated `bowlbyte_test` role tests: 86 passed. Unit pytest: 89 passed. Vitest: 48 passed. Ruff, TypeScript, and ESLint passed. The production frontend build passed. Playwright was not run because those specs truncate the live database.

## Credentials

The Supabase secret and database password in `.env` no longer match the previously disclosed prefixes. A read-only session-pooler connection with `sslmode=verify-full` and the Supabase Root 2021 CA succeeded (PostgreSQL 17.11). The admin API returned HTTP 200 and 0 Auth users. The previous full secret was not replayed, so `SUPABASE_CREDENTIALS_ROTATED` was left unset and no identities were imported. The CA path in `.env` had lost the final `t` on `prod-ca-2021.crt`; that filename was repaired. No password was changed.

## Brevo

`SMTP_HOST` is `smtp-relay.brevo.com`, port 587, STARTTLS. The password is a Brevo SMTP key, not a REST API key. The username is a Brevo SMTP login. P013.1 connected from this machine with certificate verification, authenticated, and Brevo accepted one message to `SMTP_TEST_RECIPIENT` with subject `BowlByte | SMTP Connection Test`.

SMTP SUBMISSION SUCCESSFUL — INBOX DELIVERY NOT YET VERIFIED.

No Brevo REST key is configured, so the delivery event is unknown. Check Transactional → Logs in the Brevo dashboard. The API container now uses the private SMTP environment. Supabase Auth SMTP is separate. Email OTP is not a BowlByte mailer path.

## Privacy and pickup

Logged-out and expired sessions no longer keep showing the last successful order payload. Logout and a new sign-in clear the query cache, the cart, and other tabs. Order and notification sockets connect only after a successful authorized fetch.

The tracking page requests the existing pickup credential when status is `READY` and shows the QR, manual code, ticket, cash status, and expiry. Codes stay in memory. Orders that are not ready explain that the pass appears at READY.

The frontend on port 3010 and the API on port 8010 are running these changes.

## P013.3

Credential rotation stays blocked. The replacement admin key returns HTTP 200, public signup is disabled, and the pooler URL uses port 5432 with `sslmode=verify-full`. The old secret was not replayed, so `SUPABASE_CREDENTIALS_ROTATED` was not set. No Auth users were imported.

No new email was sent. Prior Brevo SMTP submission for the connection test, one verification message, and one reset message remains the evidence. Inbox receipt is still unverified. Supabase Auth login and OTP are not claimed.

Playwright now refuses cleanup unless `E2E_DATABASE` names a disposable database and `current_database()` matches it. `bowlbyte` and `postgres` are rejected. The disposable database `bowlbyte_e2e` was created and migrated to `0010_supabase_auth_link`. The live database stayed at 263 users.

Logged-out registration and email confirmation are public routes again. A verification link is submitted once, so a remount cannot consume the single-use token. Anonymous order and tracking requests return 401. On the isolated app, student A’s order survived refresh and a second tab, disappeared after logout and Back, and was denied to student B. An expired session returned to sign-in. A not-ready order showed no QR. A ready order rendered the backend manual code and expiry, renewal replaced it, and the cashier rejected a wrong code, an expired code, a code from another canteen, and a replay. Cash stayed pending until confirmation, then READY and PAID completed as picked up. The backend WebSocket accepted the student session. The Next.js proxy does not upgrade that socket, so the page kept polling.

## Not run

Disposable Argon2id import, the 263-user import, OTP login, and Docker retirement. Inbox receipt is still unverified.
