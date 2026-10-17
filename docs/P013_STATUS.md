# P013 status

Status: blocked for Brevo delivery, Supabase Auth import, and cutover.

## Credentials

The Supabase secret and database password in `.env` no longer match the previously disclosed prefixes. A read-only session-pooler connection with `sslmode=verify-full` and the Supabase Root 2021 CA succeeded (PostgreSQL 17.11). The admin API returned HTTP 200 and 0 Auth users. The previous full secret was not replayed, so `SUPABASE_CREDENTIALS_ROTATED` was left unset and no identities were imported. The CA path in `.env` had lost the final `t` on `prod-ca-2021.crt`; that filename was repaired. No password was changed.

## Brevo

`SMTP_HOST` is `smtp-relay.brevo.com`, port 587, STARTTLS. The password prefix is a Brevo SMTP key, not a REST API key. The server rejected login with `525 Unauthorized IP address`. No message was sent.

EMAIL DELIVERY NOT VERIFIED.

Compose still points the API at Mailpit and does not pass the Brevo password into the container. Supabase Auth SMTP is a separate dashboard setting and was not changed. To send real mail, authorize this machine's IP in Brevo (or remove the IP restriction), then point FastAPI `SMTP_HOST` at the relay. Supabase Auth needs the same host, port 587, STARTTLS, the SMTP login, the SMTP key, and the verified sender in the Auth SMTP settings. Keep autoconfirm off and public signup disabled.

## Privacy and pickup

Logged-out and expired sessions no longer keep showing the last successful order payload. Private routes are `force-dynamic`. Logout clears the query cache and notifies other tabs. A restored back-forward page with no CSRF cookie drops private data and returns to sign-in. Order sockets connect only after a successful authorized fetch.

The tracking page requests the existing pickup credential when status is `READY` and shows the QR, manual code, ticket, cash status, and expiry. Codes stay in memory. Orders that are not ready explain that the pass appears at READY.

These fixes are in source. The running Docker images were not rebuilt, so port 3010 still serves the previous bundle.

## Not run

Disposable Argon2id import, the 263-user import, OTP login, role end-to-end tests, Playwright, and Docker retirement.
