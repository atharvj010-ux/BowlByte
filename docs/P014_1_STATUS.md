# P014.1 status

Status: BLOCKED before the Docker-free cutover.

The Supabase database now matches the local BowlByte snapshot that was frozen for this pass. The running application is the restored Docker Compose stack on the local database. New orders after that restore are local until the native runtime can stay up.

## Data

- Rehearsal on disposable `bowlbyte_p014_stage` inserted the missing order graph and restored two stock rows. Identity links did not change. The stage database was dropped.
- Writers stopped: BowlByte frontend, backend, worker, and the one Beat container. Postgres stayed up for the dump. Unrelated containers were not stopped.
- Custom-format backup: `%LOCALAPPDATA%\BowlByte\p011\bowlbyte-p0141.dump` (389348 bytes, 46 table-data entries). Older `bowlbyte-p011.dump` and `bowlbyte-p012.dump` are still there. The Postgres volume was not deleted.
- Full primary-key compare before apply differed only by one local order graph, two stock quantity rows, and one remote-only session.
- Apply result: orders 2, order items 4, payments 2, events 2, idempotency 2, inventory adjustments 14, daily stock 294, users 263, audit log 1085 on both sides. Append-only cash and pickup tables were not modified. `auth.users` stayed 263 with 0 link mismatches. Alembic revision `0010_supabase_auth_link`.
- The one remote-only session was left in place. User rows were not overwritten.

## Auth code

Password login, refresh, logout, recovery, and email OTP call Supabase only when rotation is acknowledged and the Auth settings are present. Roles still come from BowlByte user rows. Tests without those settings keep the local password path. The running Docker image does not include this code.

Email OTP inbox delivery was not observed. HTTP 200 on an earlier OTP request is not verification.

## Runtime

Native Next.js and FastAPI did listen on 3010 and 8010, and one Celery task completed. WSL Redis then dropped broker connections and the Ubuntu distro hit `Wsl/Service/E_UNEXPECTED`. Docker Redis, backend, worker, Beat, and frontend were started again. `/api/v1/ready` returned 200 and the web port returned 200.

Docker has not been retired.
