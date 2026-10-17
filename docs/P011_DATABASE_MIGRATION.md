# P011 database migration

Status: source backup rechecked and unchanged. Supabase Postgres was not written.

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

`SUPABASE_DB_URL` is now set. It is the direct host `db.<project-ref>.supabase.co` on port 5432, database `postgres`, user `postgres`, with the password wrapped in square brackets and no `sslmode`. That host has only an IPv6 address, and a connection to it failed with network unreachable. Session-pooler hosts on port 5432 answer over IPv4, but `sslmode=verify-full` with the operating-system trust store failed certificate verification. `sslmode=disable` was not used. The pooler cluster host is not in the URI, and the docs say it cannot be derived from the region, so the target schema was not inspected and no restore was attempted.

After a restore, `backend/app/db/supabase_lockdown.sql` revokes `anon` and `authenticated` from the BowlByte tables. FastAPI keeps using the database owner role.
