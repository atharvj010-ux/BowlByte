# P012 release readiness

Status: blocked. The Supabase data copy is verified. Email authentication, the animation work, role end-to-end tests, and Docker retirement are not complete.

## Closed before this phase

- Session pooler connection on port 5432 with `sslmode=verify-full`.
- Public Supabase signup is disabled (`disable_signup=true`).
- Email autoconfirm is off.

## Data copy

See `docs/P011_DATABASE_MIGRATION.md`. Counts match the source snapshot. No Auth users were created. `users.supabase_auth_user_id` is null for all 263 accounts.

## Blocked gates

1. The Supabase secret key in `.env` is still the value that was pasted into chat. It has not been rotated. Password-hash import and account creation through the admin API stay stopped until a new secret exists only in `.env`.
2. The database URI was printed by a failed Alembic config parse because `%40` is interpolation syntax. Rotate the database password in the Supabase dashboard and update `.env`. The password is not repeated here.
3. `SMTP_HOST` and `SMTP_USERNAME` are empty. Registration and password-reset mail cannot be called verified.
4. The running Compose stack was restarted onto local PostgreSQL. New local orders will not appear in the Supabase copy until a later cutover.
5. Kitchen, cashier, manager, and full order-to-pickup checks were not run against Supabase.
6. Docker is still required. Redis and Celery were not moved to the host.

## Not claimed

Email delivery, phone push, cinematic order confirmation, and a Docker-free runtime were not verified in this phase.
