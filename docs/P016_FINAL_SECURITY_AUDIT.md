# P016 final security audit

Checked on 18 October 2026 against the running native app and the Supabase project. Tokens, cookies, and connection strings are not copied here.

## Controls observed

| Control | Evidence |
| --- | --- |
| Anonymous orders | `GET /api/v1/orders` returned 401 |
| Opaque session cookie | `GET /api/v1/auth/me` with a non-JWT cookie returned 401 |
| CSRF origin | Login without an allowed Origin returned 403 |
| Invalid credentials | Unknown email and wrong password returned 401 |
| Closed registration | Email outside the college domain returned 403 and inserted no user |
| WebSocket | Anonymous upgrade on port 3010 returned 403 |
| Data API | `GET /rest/v1/users` with the publishable key returned 401 |
| Browser bundle | `sb_secret_` was not found in `frontend/src`, `frontend/.next`, or `backend/app` |
| API headers | `nosniff`, `referrer-policy`, `x-frame-options: DENY`, and a locked content security policy |
| Web headers | The same framing and content-type protections, plus a content security policy that allows Supabase connections |
| Pickup replay and cross-student reads | Covered by the isolated Playwright run, 57 passed |
| Cash recorded once | Covered by the cash pickup scenarios in that run |
| Audit tables | No append-only trigger was disabled |
| Rate limits | Login and registration limits were left at their configured values |

Role checks stay on the BowlByte user row. `identity_subject` uses the JWT `sub` and does not authorize from client metadata.

## Findings that are not a passing control

Supabase Auth `disable_signup` is false. Someone who has the publishable key can call the Auth signup API directly. That does not create a BowlByte role. A BowlByte session still requires an active linked user. This is a project setting to tighten, not an application bypass observed in this pass.

HSTS is not set on `http://127.0.0.1`. That matches the local HTTP listener.

## Not verified here

A live expired JWT, a disabled live account, a cross-canteen browser session, and an inbox-delivered recovery link were not exercised against the hosted project. SQL injection and upload rejection remain covered by the existing backend tests; this phase did not add a new exploit case.
