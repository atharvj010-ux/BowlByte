# P011 database migration

Status: the public schema was copied to Supabase after a fresh backup. Docker still serves the local database. Supabase is not the live authority yet.

## Source

- PostgreSQL 16.15 in the existing BowlByte Compose service.
- Alembic revision on that database: `0009_menu_organization`.
- 46 application tables in `public`.
- Sequences: `cash_receipt_no_seq`, `order_ticket_seq`, `production_batch_no_seq`.
- Triggers: `users_set_updated_at`, `cash_receipts_append_only`, `cash_reversals_append_only`, `pickup_events_append_only`.
- Functions in the dump include `set_users_updated_at()` and `bowlbyte_forbid_ledger_change()`.
- Exact counts: 263 users, 1 order, 2 order items, 1 payment, 0 cash receipts.
- Menu images are in `menu_items.image_bytes`. The dump includes them. They were not sent to Supabase Storage.

## Backup

A custom-format dump was taken with `pg_dump -Fc` from the running database and copied out of the container. `pg_restore -l` read the archive: 351 TOC entries, dumped from PostgreSQL 16.15, gzip custom format, about 382 KB. The file is outside the Git repository:

`C:\Users\athar\AppData\Local\BowlByte\p011\bowlbyte-p011.dump`

The Docker volume `postgres_data` was not removed.

## Restore rule

The restore may target only the BowlByte `public` schema. It must not drop or replace Supabase's `auth` schema. If `public.users` already exists on the target, the restore stops. The connection must use TLS and either the direct host or the session pooler on port 5432. The transaction pooler on port 6543 is rejected because BowlByte uses transactions and row locks.

A second custom-format dump, `bowlbyte-p012.dump`, was taken after stopping the backend, worker, and beat. It is stored next to the earlier dump and is 381,620 bytes. Those three services were started again and still use local PostgreSQL.

The restore used the session pooler `aws-0-ap-northeast-2.pooler.supabase.com` on port 5432 with `sslmode=verify-full` and the Supabase Root 2021 CA. `pg_restore` exited 0 for the `public` schema only. Supabase `auth` was not replaced.

Verified on Supabase PostgreSQL 17.11:

- 46 public tables
- 263 users
- 1 order, 2 order items, 1 payment, 0 cash receipts
- 0 orders without a matching user
- 4 public triggers
- `anon` and `authenticated` table grants: 0 after `supabase_lockdown.sql`
- `users.supabase_auth_user_id` added, with 0 identities linked
- Alembic revision on Supabase: `0010_supabase_auth_link`
- Alembic revision on the local database: `0009_menu_organization`

The local Docker database remains the database the running application writes.
