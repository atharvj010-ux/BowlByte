# P011 Auth migration

Status: blocked. The Auth admin API still lists zero users. Public signup is disabled and email autoconfirm is off. The exposed admin secret and database password have not been rotated, so no password hash has been imported.

## Current accounts

The local database has 263 users: 261 active students, 1 student pending verification, and 1 active canteen manager. There are no kitchen or cashier accounts in that count. Every stored password hash uses Argon2id with `m=65536,t=3,p=4`, which is inside the parameter range GoTrue documents for `password_hash` import.

That compatibility has not been proven with a live login. The import must be tested on one disposable Auth user before any real hash is sent. No hash was sent.

## Planned mapping

1. `0010_supabase_auth_link` is applied on the Supabase copy only. The live Docker database is still `0009_menu_organization`. The SQLAlchemy `User` model does not map `supabase_auth_user_id`, so the running image can keep starting. All 263 Supabase user rows have a null link.
2. For each user without a link, call the Auth admin API with the server secret key.
3. Confirm email only when BowlByte status is `ACTIVE` and `email_verified_at` is set.
4. Import pending users with `email_confirm=false`.
5. Do not import disabled users, and do not invent passwords when a hash is not Argon2id.
6. Store the Auth user id on the existing BowlByte user. Do not rewrite `orders` or `audit_log` actor ids.
7. Keep `STUDENT`, `KITCHEN_STAFF`, `CASHIER`, and `CANTEEN_MANAGER` on the BowlByte row. Staff invitations remain manager-created.

`app.services.supabase_identity` implements this plan. `scripts/start-dev.ps1` refuses to launch a native stack until `SUPABASE_SECRET_KEY` and `SUPABASE_DB_URL` are usable.

## Resume check

`GET /auth/v1/admin/users` with `SUPABASE_SECRET_KEY` returned HTTP 200 and an empty user page. The key matches `NEXT_PUBLIC_SUPABASE_URL`. No BowlByte user was created.

`GET /auth/v1/settings` still reports `disable_signup=false` and `mailer_autoconfirm=false`. The secret key cannot change that project setting. Turn public signup off in the Supabase dashboard before any client is pointed at Supabase Auth.

## Still required in the dashboard

- Turn off public signups so the client cannot bypass college eligibility.
- Download the database CA certificate from Database settings. The Windows trust store rejected the pooler certificate under `sslmode=verify-full`.
- Copy the session-pooler URI from the Connect panel. The direct host is IPv6-only and this network cannot route to it.
- Keep the site URL on the local development origin. Do not deploy BowlByte publicly in this phase.
