# P011 Auth migration

Status: not started against Supabase Auth. The admin API rejected the publishable key.

## Current accounts

The local database has 263 users: 261 active students, 1 student pending verification, and 1 active canteen manager. There are no kitchen or cashier accounts in that count. Every stored password hash uses Argon2id with `m=65536,t=3,p=4`, which is inside the parameter range GoTrue documents for `password_hash` import.

That compatibility has not been proven with a live login. The import must be tested on one disposable Auth user before any real hash is sent. No hash was sent.

## Planned mapping

1. Apply `0010_supabase_auth_link` so `users.supabase_auth_user_id` exists. This revision is in the repository and has not been applied to the live database. Applying it while the running backend image is still at `0009_menu_organization` would make the next container start fail its migration.
2. For each user without a link, call the Auth admin API with the server secret key.
3. Confirm email only when BowlByte status is `ACTIVE` and `email_verified_at` is set.
4. Import pending users with `email_confirm=false`.
5. Do not import disabled users, and do not invent passwords when a hash is not Argon2id.
6. Store the Auth user id on the existing BowlByte user. Do not rewrite `orders` or `audit_log` actor ids.
7. Keep `STUDENT`, `KITCHEN_STAFF`, `CASHIER`, and `CANTEEN_MANAGER` on the BowlByte row. Staff invitations remain manager-created.

`app.services.supabase_identity` implements this plan. `scripts/start-dev.ps1` refuses to launch a native stack until `SUPABASE_SECRET_KEY` and `SUPABASE_DB_URL` are usable.

## Still required in the dashboard

- Create a server-only secret key and put it in `.env` as `SUPABASE_SECRET_KEY`.
- Turn off public signups so the client cannot bypass college eligibility.
- Keep the site URL on the local development origin. Do not deploy BowlByte publicly in this phase.
