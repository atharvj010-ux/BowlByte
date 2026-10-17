# P011 test results

Cutover tests were not run. There is no Supabase database URI and no server secret key, so login, order, cash, and QR checks against Supabase could not be executed without inventing credentials.

| Check | Result |
| --- | --- |
| `tests/test_supabase_identity.py` | 5 passed. Ruff passed on the new modules. |
| Auth admin with the secret key | HTTP 200, zero Auth users |
| Auth admin with the publishable key | HTTP 401 from `GET /auth/v1/admin/users` |
| Auth health | HTTP 200 |
| Auth settings | HTTP 200, `disable_signup=false`, autoconfirm off |
| Direct Postgres | IPv6-only. Connection failed: network unreachable |
| Session pooler `verify-full` | Certificate verification failed against the OS trust store |
| Source recount | 263 users, 1 order, 2 order items, 1 payment, 0 cash receipts, revision `0009_menu_organization` |
| Live Argon2id login through Supabase | Not run |
| Backend unit suite, frontend lint, Vitest, Playwright | Not re-run for this blocked cutover |
| Redis `PING` from a native install | Not run. `redis-cli` is not installed on the Windows host. |
| Celery on the host | Not started. The Compose worker and beat are still the schedulers. |

Playwright's existing specs delete orders and staff from the local development database. They were not run.
