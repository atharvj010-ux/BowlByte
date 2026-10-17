# P011 architecture

Status: blocked before cutover. Docker Compose is still the BowlByte runtime.

## Before

- Next.js and FastAPI run in Docker. The browser calls `/api/v1` on the web origin, and Next.js proxies that to FastAPI.
- PostgreSQL 16 and Redis 7 run in Docker. Celery worker and Celery Beat run in Docker.
- Accounts, sessions, and Argon2id password hashes live in the `users` and `sessions` tables.
- FastAPI is the authority for orders, stock, cash, QR pickup, kitchen tasks, and forecasting.
- Menu images are `bytea` on `menu_items`, not object storage.

## After, once the missing settings exist

- Supabase Auth is the identity provider. BowlByte `users.id` stays the owner id on orders, payments, and audit rows. `users.supabase_auth_user_id` is the link.
- Supabase PostgreSQL holds the BowlByte `public` schema. The managed `auth` schema is not replaced.
- FastAPI still performs orders, stock, cash, pickup, and kitchen writes. The browser does not write those tables through the Data API.
- Next.js, FastAPI, Redis, and Celery move to the host only after a verified restore. That move has not happened.
- Redis is not replaced by Supabase. An Ubuntu WSL distro exists and is stopped. `redis-cli` is not installed on the Windows host. Docker Redis remains the broker.

## Settings

| Name | Where it may be read |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser and server |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser and server |
| `SUPABASE_SECRET_KEY` | Server only |
| `SUPABASE_DB_URL` | Server only |

The first two are present. The secret key and database URI are not. The publishable key was checked against `GET /auth/v1/admin/users` and received HTTP 401, so it is not an admin credential.

Public signup is currently enabled on the Supabase project (`disable_signup=false`). It must be disabled before any client is pointed at Supabase Auth. Eligibility stays on the FastAPI registration path. Auth `user_metadata` is not a role source.

## What was not changed

Dockerfiles, Compose files, the login session code, and the local database volume are unchanged. No cloud table was written.
