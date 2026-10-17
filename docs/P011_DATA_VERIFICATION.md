# P011 data verification

The live database was read. Supabase was not written, so there is no cloud copy to compare.

| Check | Result |
| --- | --- |
| Database version | PostgreSQL 16.15 |
| Alembic revision | `0009_menu_organization` |
| Users | 263 |
| Orders | 1 |
| Order items | 2 |
| Payments | 1 |
| Cash receipts | 0 |
| Backup `pg_restore -l` | Readable, 351 TOC entries |
| Order owner rewrite | Not performed |
| Auth link column on the live database | Not added |
| Supabase `public` schema | Not inspected; no database URI |

The one local order, its payment, and its owner id are still only in the Docker database. Cash receipt count is zero. Append-only triggers for cash receipts, cash reversals, and pickup events are present in the source.

Menu image bytes stay in PostgreSQL. Forecast artifacts under `backend/var/` and the push encryption keys in `.env` are local files. Moving PostgreSQL would not move them.
