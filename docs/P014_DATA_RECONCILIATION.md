# P014 data reconciliation

P014.1 copied the local `bowlbyte` database to Supabase at Alembic `0010_supabase_auth_link`. Docker was started again afterward, so P014.2 compared the databases again before the native cutover.

The comparison covered the application tables by primary key, not by row count alone. After Docker had been writable again, and again after its writers were stopped, the only difference was one remote-only `sessions` row. That row was left in place. Its owner was not identified, and it was not deleted.

No second apply was required. Orders, payments, stock, users, and audit rows matched. Auth identity links were not rewritten. The append-only cash, pickup, and audit tables were not updated or deleted.

A fresh custom dump, `bowlbyte-p0142.dump`, was taken before the native processes started. `pg_restore -l` listed 46 table-data entries. The file is 389348 bytes, the same size as the P014.1 dump. Older dumps were not removed.

After cutover, one acceptance order was placed on Supabase by a disabled disposable student account. That order is now part of the cloud history. It was not deleted. The local Docker database does not contain it.
