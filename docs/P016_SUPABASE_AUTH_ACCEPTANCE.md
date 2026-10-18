# P016 Supabase Auth acceptance

The live API on port 8010 is the Supabase Auth runtime. This phase did not complete a successful browser sign-in for the four roles. No new Auth user was created, and the 263 imported identities were not changed.

## What was verified on the running application

Checked on 18 October 2026 against `http://127.0.0.1:8010` and the settings file, without printing secrets:

| Check | Result |
| --- | --- |
| Rotation acknowledged and Auth settings present | Enabled |
| Publishable key is not a secret key | Yes |
| Secret key uses the server-only prefix | Yes |
| Session pooler host, port 5432, `sslmode=verify-full`, database `postgres` | Yes |
| `current_database()` | `postgres` |
| PostgreSQL version | 17.11 |
| Unknown email and wrong password | HTTP 401 |
| Non-JWT `bowlbyte_session` cookie on `/api/v1/auth/me` | HTTP 401 |
| Login without an allowed Origin | HTTP 403 |
| Anonymous `GET /api/v1/orders` | HTTP 401 |
| Anonymous WebSocket upgrade on port 3010 | HTTP 403 |
| Student registration for an email outside the college domain | HTTP 403 |
| Row created for that probe email | 0 |
| Eligibility mode | `institutional_domain` |
| Supabase `mailer_autoconfirm` | false |
| Supabase `disable_signup` | false |

`disable_signup` is false on the Supabase project. BowlByte still refuses an ineligible registration before inserting a user. Authorization uses the BowlByte user row linked by `supabase_auth_user_id`. The Auth verifier does not read `user_metadata` or `app_metadata` for a role.

## What was not verified

Successful hosted sign-in, dashboard landing, logout, refresh, multi-tab use, and account switching were not executed in a browser. No authorized test password was available for an existing student, kitchen, cashier, or manager account, and this phase did not create one.

The isolated Playwright suite signs in with local passwords against `bowlbyte_e2e` after Supabase settings are cleared. That run is not hosted Auth proof. Its results are in `docs/P016_FOUR_ROLE_ACCEPTANCE.md`.

Expired-token, disabled-account, and unconfirmed-account cases were not replayed against the live project. The code rejects a token that fails ES256, issuer, audience, or expiry checks, and it rejects a user who is not `ACTIVE`. Those branches were not given a live expired or disabled token in this phase.
