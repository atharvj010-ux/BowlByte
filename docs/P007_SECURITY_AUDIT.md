# P007 security audit

Reviewed against the code on this branch after the P007 changes. Findings below are the ones that still matter for a college pilot. Tests named here were run on `bowlbyte_test` unless marked as a code review.

## Authentication

| Check | Result |
| --- | --- |
| Passwords | Argon2id. `tests/test_passwords.py` asserts the `$argon2id$` prefix |
| Sessions | HttpOnly session cookie, server-side row, logout and expiry covered by `test_expired_and_disabled_sessions_are_rejected` |
| Secure cookie | `COOKIE_SECURE` is false in local Docker and must be true behind HTTPS. Production startup rejects a development environment |
| CSRF | Mutating routes use `require_csrf`. Ordering tests reject a missing token |
| Login limits | Per-email bucket plus a client label. See proxy finding below |
| Verification tokens | One-time hash, expiry already enforced in P002 |

Session fixation: login creates a new session row and a new cookie. A previous cookie is not reused as the authenticated session.

Logout and deactivation delete or disable the session. A WebSocket that already passed auth is not torn down on the same millisecond. The next subscription or a reconnect loads the principal again. Bound: the live socket can continue until it drops or the server restarts. That interval is not a fixed number of seconds. Treat it as a remaining medium risk for a pilot where deactivating a cashier must cut an open kitchen socket immediately.

## Authorization

Staff routes resolve a canteen from the membership, not from a client-supplied canteen id. Student order reads filter `student_user_id`. Cash reversal is manager-only. Forecast training and plan approval use the manager dependency. Cross-canteen access returns 404 or 403 in the existing kitchen and ordering tests.

Frontend route guards are not the enforcement layer. The API tests above hit the services.

## Proxy client address

Severity: high before this phase, reduced now.

The Next.js proxy used to send `x-bowlbyte-client: web` for every browser, so every browser shared one login-IP bucket. It now sends an IP. The API accepts that header only when `x-bowlbyte-proxy` matches `PROXY_SHARED_SECRET` and the value parses as IPv4 or IPv6. `X-Forwarded-For` is never read by the API. `tests/test_passwords.py` covers a spoofed forwarded header, a missing secret, and a non-IP label.

The Next.js 16 route handler cannot see the TCP peer, so local requests are labeled `0.0.0.0` unless `TRUST_PROXY=true`. Per-email limits still apply. Behind the staging proxy, the Next server uses the rightmost `X-Forwarded-For` hop, which Caddy appends.

## Enrollment

Severity: medium. Not a pilot blocker if the college uses roster mode. Blocker if the college needs proof of roll-number ownership and does not supply a roster.

`institutional_domain` proves the email domain only. Anyone with a college mailbox can type another student's roll number. `roster` mode locks the roster row, checks a one-time enrollment code with Argon2, and the unique `(college_id, roll_number)` constraint stops a second claim. There is no identity-document check. If the college does not provide a roster, this limitation remains.

## Input and supply chain

| Item | Result |
| --- | --- |
| SQL | SQLAlchemy queries with bound parameters |
| CSV | Demand export prefixes `=`, `+`, `-`, `@` cell text. Unit test `test_csv_export_neutralizes_formula_text` |
| Service worker | `frontend/public/sw.js` caches only `/offline.html` and the icon. API and QR responses are not cached |
| Push SSRF | Existing endpoint allow-list and blocked-IP checks remain. Test endpoints stay off unless `PUSH_ALLOW_TEST_ENDPOINTS` is true, which production refuses |
| Model files | `_load_artifact` requires the file under the artifact directory and a matching SHA-256. Untrusted paths are rejected |
| Secrets in logs | Push and session code do not log tokens, VAPID private keys, or pickup secrets |

Image upload size limits were not re-measured in this phase. Menu images, if present, should stay on the existing validation. No new upload path was added.

## Remaining risks

| Severity | Item | Pilot blocker |
| --- | --- | --- |
| Medium | Live WebSocket is not force-closed on logout | No, if staff sessions are short and the socket is one browser |
| Medium | Institutional email does not prove a roll number | Yes, unless roster mode is used |
| Low | Local Docker shares one client IP | No. Per-email limits remain |
| High (dev only) | GHSA-vfj7-8cjw-p6xm in ESLint's tree | No. `npm audit --omit=dev` reported 0 |
