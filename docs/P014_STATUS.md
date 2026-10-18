# P014 status

Status: BLOCKED before database cutover. Supabase Auth now holds the 263 BowlByte identities. Docker is still the application runtime, and `DATABASE_URL` was not switched.

## Credential verification

The operator confirmed, through the Supabase dashboard, that the exposed secret key was deleted and the database password was reset after exposure. `SUPABASE_CREDENTIALS_ROTATED=yes` is set in `.env` only. The replacement secret returns HTTP 200. The replacement pooler password authenticates on port 5432 with `sslmode=verify-full` and the existing CA. The old secret and old password were not replayed. No secret or database URI was printed.

## Identity import

A disposable Argon2id hash was imported through the Auth admin API, a real password login returned HTTP 200, and that disposable user was deleted.

All 263 application user ids match on the local database and on Supabase. The idempotent importer created 263 Auth users: 262 confirmed active accounts and 1 pending account left unconfirmed. Disabled accounts: 0. Hash failures: 0. `users.supabase_auth_user_id` matches `auth.users.id` for all 263 rows on both databases. Order and payment counts were unchanged by the import. Auth user count after a later OTP probe was deleted: 263.

## Email

Public signup remains disabled and email confirmation remains required. One OTP request for the authorized test recipient, with user creation disabled, returned HTTP 200 from Supabase Auth. The disposable Auth row used for that probe was removed. Inbox receipt was not observed.

SMTP SUBMISSION ACCEPTED — INBOX DELIVERY NOT VERIFIED.

## Not switched

Local PostgreSQL is still authoritative. Since the earlier snapshot it has 2 orders, 4 order items, and 2 payments; Supabase has 1 order, 2 order items, and 1 payment. Sessions also differ. Those rows were not copied. Writers were not stopped, no new backup was taken, and Docker was not retired. The running application still checks BowlByte password hashes and cookie sessions.

Native Next.js, FastAPI, Redis, Celery, and a second Beat process were not started.
