# P002 authentication

BowlByte accounts are rows in PostgreSQL. The browser does not store a JWT, and it does not store a session token in `localStorage` or `sessionStorage`.

## Passwords and tokens

Passwords are hashed with Argon2id (`argon2-cffi`). Verification tokens, invitation tokens, session credentials, and CSRF values are 256-bit random values from `secrets.token_urlsafe`. The database stores SHA-256 hashes of those values. Raw tokens are placed only in the email link fragment (`#token=`), so they are not sent to the Next.js or API access logs as a query string. Application logs record failure class names, not passwords, session cookies, or raw tokens.

## College eligibility

`COLLEGE_ELIGIBILITY_MODE` has three values:

| Mode | What proves enrollment |
| --- | --- |
| `disabled` | Nothing. Registration returns 403 until an operator changes the mode. This is the default |
| `institutional_domain` | The email domain equals `COLLEGE_EMAIL_DOMAIN`, and the person opens the verification link |
| `roster` | A row imported by `python -m app.cli.import_roster` matches the roll number, and the enrollment code matches the stored Argon2id hash |

A roll number without the enrollment code is rejected in roster mode. An arbitrary personal email is rejected in institutional mode. Duplicate registration returns the same generic acceptance message as a new registration.

Institutional mode proves control of a mailbox on the college domain. It does not prove that the person owns the roll number they typed. Use roster mode when roll numbers must be pre-assigned. If the college has not provided a domain or a roster, leave the mode at `disabled`.

## Email

SMTP settings are `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_STARTTLS`, `SMTP_USE_TLS`, and `SMTP_FROM`. Local Compose sends mail to Mailpit with no authentication. The Mailpit UI is published on loopback only (`MAILPIT_UI_PORT`, default 8025). Verification links use `PUBLIC_APP_URL`. The default lifetime is 15 minutes. A new token consumes older unused tokens. Resend is rate-limited in Redis.

If SMTP fails after the account row is committed, the API returns 503 and does not claim the message was sent. The person can use resend.

## Sessions

Login creates a new session and deletes older sessions for that user. The cookie is host-only, `Path=/`, `SameSite=Lax`, and `HttpOnly`. `Secure` is on when `COOKIE_SECURE=true`, and the cookie name becomes `__Host-bowlbyte_session`. Local HTTP uses `bowlbyte_session`. Idle timeout defaults to 30 minutes. Absolute timeout defaults to 12 hours. Both are enforced when the session is loaded. Logout deletes the server row. A disabled account's sessions are deleted, and a later request with the old cookie is rejected.

A second cookie, `bowlbyte_csrf`, is readable by the page so it can send `X-CSRF-Token`. It is not the session credential. Unsafe API methods also require an `Origin` in the configured allowlist. Login, registration, verification, resend, and invitation acceptance rely on that origin check because the person has no session yet. Logout and staff changes require the CSRF token as well.

Login failures are counted in Redis for the email and the client address. The limits default to 5 attempts per email and 50 per client address in 15 minutes. If Redis is down, those checks fail closed. The web proxy sets a shared client key of `web` together with `PROXY_SHARED_SECRET`. Direct callers cannot spoof that header unless they know the secret. Behind one web server, the address bucket is shared, so the per-email bucket is the control that stops guessing one password.

## Staff

`python -m app.cli.bootstrap_manager` creates the pilot college, the pilot canteen, and the first manager. The password comes from a prompt or from one stdin line. Arguments are rejected. A second manager cannot be created by this command or by the invitation API.

A manager invites `KITCHEN_STAFF` or `CASHIER` for the canteen on their own membership. The invitation email contains the only copy of the token. Accepting it creates an active account with `email_verified_at` set, because the token proves mailbox control, and it does not create a session. Deactivation sets the account to `DISABLED`, marks the membership inactive, and deletes sessions.

## Same-origin API

Browser code calls `/api/v1/*`. `frontend/src/app/api/v1/[...path]/route.ts` forwards the request to `API_INTERNAL_URL`, copies `Set-Cookie`, and strips client-supplied `x-bowlbyte-*` headers before adding the proxy secret. Credentialed CORS is limited to the explicit `CORS_ORIGINS` list. Production should serve the site and the API cookie on one HTTPS origin and set `COOKIE_SECURE=true`.

## Limitations

- One college and explicit canteen memberships. A manager cannot act on another canteen's staff.
- Institutional mode can let the first college-email registrant claim a roll number.
- The web proxy's shared client key means the IP rate limit is not a per-browser limit until the deployment overwrites the client address at a trusted edge.
- Verification links in Mailpit are development mail, not a production provider. Point `SMTP_*` at an authorized provider for a real deployment.
- Ordering, cash, QR, notifications, and forecasting are not authenticated features yet because they are not implemented.
