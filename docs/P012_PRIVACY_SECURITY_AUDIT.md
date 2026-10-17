# P012 privacy and security

## Still blocked

- The Supabase admin secret in `.env` is the value pasted into chat.
- The database password appeared in a failed Alembic log and has not been rotated.
- `.env` is not tracked. A history search for `sb_secret_` hit the earlier P011 commit that names the setting, not a stored key.
- No Auth users were created with the exposed key during this resume.

## Enforced in the API response

Every API response now sets `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, and `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`. `Strict-Transport-Security` is set only when the API request scheme is HTTPS. The health test checks the first three.

Next.js adds the same framing and content-type headers, plus `Permissions-Policy` with camera limited to self, and a page CSP. HSTS is not set on the Next responses, because the local site is HTTP. A TLS terminator should add HSTS in a real HTTPS deployment.

## Existing controls that were not re-tested end to end

- Cookie sessions, CSRF origin checks, and role checks remain the live authorization path.
- Students read their own orders. Kitchen and cashier canteen ids come from membership rows.
- Anon and authenticated table grants on the Supabase copy are 0.
- Password recovery and verification links use the URL fragment.
- Email bodies are not logged. The new HTML templates escape text.
- Audit rows for cash and pickup stay append-only in the restored triggers. This change does not delete them.

Cross-canteen and cross-student access were not re-run as HTTP tests in this session.
