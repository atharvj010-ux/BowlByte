# P014 status

Status: BLOCKED at credential rotation. No Auth users were imported, `DATABASE_URL` was not switched, and Docker is still the BowlByte runtime.

Git HEAD at the start of this check was `62ad022`.

## What was verified

The replacement Supabase secret is installed and usable. It does not start with the previously disclosed prefix. The admin API returned HTTP 200 and 0 Auth users. Public signup is disabled, email confirmation is required, and the email provider is enabled.

The session pooler URI uses port 5432 and `sslmode=verify-full`. The configured CA file exists, and a read-only connection authenticated. The remote database is `postgres` at Alembic `0010_supabase_auth_link` on PostgreSQL 17.11. The local Docker database is still `bowlbyte`, Alembic `0010_supabase_auth_link`, with 263 users.

`SUPABASE_CREDENTIALS_ROTATED` is unset. The old secret was not replayed, and there is no dashboard evidence that it was deleted. The old database password was not tested, so its invalidation is also unproven. Neither value is stored in Git. `sb_secret_` appears in tracked files only as a placeholder comment in `.env.example`.

## Required before import or cutover

1. In the Supabase dashboard, delete the previously exposed secret key. Confirm that key is gone, not merely unused.
2. Reset the database password so the previously exposed password is rejected. Keep the new URI on the session pooler, port 5432, with `sslmode=verify-full` and the existing CA. Do not paste the URI into chat or logs.
3. Set `SUPABASE_CREDENTIALS_ROTATED=yes` in `.env` only after both of those steps are done.

Do not import the 263 users, do not switch the live database, and do not retire Docker until that flag is honestly set.
