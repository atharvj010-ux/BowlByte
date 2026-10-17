# P011 test results

Cutover tests were not run. There is no Supabase database URI and no server secret key, so login, order, cash, and QR checks against Supabase could not be executed without inventing credentials.

| Check | Result |
| --- | --- |
| `tests/test_supabase_identity.py` | 5 passed. Ruff passed on the new modules. |
| Auth admin with the publishable key | HTTP 401 from `GET /auth/v1/admin/users` |
| Auth health | HTTP 200 |
| Auth settings | HTTP 200, `disable_signup=false`, email provider enabled, autoconfirm off |
| Live Argon2id login through Supabase | Not run |
| Backend unit suite, frontend lint, Vitest, Playwright | Not re-run for this blocked cutover |
| Redis `PING` from a native install | Not run. `redis-cli` is not installed on the Windows host. |
| Celery on the host | Not started. The Compose worker and beat are still the schedulers. |

Playwright's existing specs delete orders and staff from the local development database. They were not run.
