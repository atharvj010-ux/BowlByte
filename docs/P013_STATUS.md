# P013 status

Status: Brevo SMTP submission succeeded. Inbox delivery, Supabase Auth import, and cutover remain unverified.

## Credentials

The Supabase secret and database password in `.env` no longer match the previously disclosed prefixes. A read-only session-pooler connection with `sslmode=verify-full` and the Supabase Root 2021 CA succeeded (PostgreSQL 17.11). The admin API returned HTTP 200 and 0 Auth users. The previous full secret was not replayed, so `SUPABASE_CREDENTIALS_ROTATED` was left unset and no identities were imported. The CA path in `.env` had lost the final `t` on `prod-ca-2021.crt`; that filename was repaired. No password was changed.

## Brevo

`SMTP_HOST` is `smtp-relay.brevo.com`, port 587, STARTTLS. The password is a Brevo SMTP key, not a REST API key. The username is a Brevo SMTP login. P013.1 connected from this machine with certificate verification, authenticated, and Brevo accepted one message to `SMTP_TEST_RECIPIENT` with subject `BowlByte | SMTP Connection Test`.

SMTP SUBMISSION SUCCESSFUL — INBOX DELIVERY NOT YET VERIFIED.

No Brevo REST key is configured, so the delivery event (delivered, deferred, bounced, or blocked) is unknown. Check Transactional → Logs in the Brevo dashboard for that subject. Compose still points the API container at Mailpit and does not pass the Brevo password into the container. The host mailer now verifies TLS certificates and uses `SMTP_FROM_EMAIL` when `SMTP_FROM` is still the local placeholder.

Supabase Auth SMTP is separate. A prior invite through the dashboard settings returned HTTP 200; this run did not send a second Auth email. Public Auth settings currently report email enabled, autoconfirm off, and `disable_signup` false. Turn off new-user signup in the Auth dashboard before any student import. Email OTP is not a BowlByte mailer path.

## Privacy and pickup

Logged-out and expired sessions no longer keep showing the last successful order payload. Private routes are `force-dynamic`. Logout clears the query cache and notifies other tabs. A restored back-forward page with no CSRF cookie drops private data and returns to sign-in. Order sockets connect only after a successful authorized fetch.

The tracking page requests the existing pickup credential when status is `READY` and shows the QR, manual code, ticket, cash status, and expiry. Codes stay in memory. Orders that are not ready explain that the pass appears at READY.

These fixes are in source. The running Docker images were not rebuilt, so port 3010 still serves the previous bundle.

## Not run

Disposable Argon2id import, the 263-user import, OTP login, role end-to-end tests, Playwright, and Docker retirement.
