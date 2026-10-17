# P011 database migration

Status: source backup verified. Supabase was not written.

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

`SUPABASE_DB_URL` is not configured, so this restore was not attempted. The target was not checked for an existing BowlByte schema for the same reason.

After a restore, `backend/app/db/supabase_lockdown.sql` revokes `anon` and `authenticated` from the BowlByte tables. FastAPI keeps using the database owner role.
