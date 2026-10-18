# P015 test results

Commands were run from `backend/` or `frontend/` on 18 October 2026. Secrets were not printed.

| Suite | Result |
| --- | --- |
| `pytest` (default, excludes integration) | 95 passed |
| `pytest -m integration` | NOT RUN. Disposable Postgres is inside the stopped Docker container |
| `ruff check` on the edited order and session files | passed |
| `npm run typecheck` | passed |
| Vitest, ESLint, production build, Playwright | NOT RERUN. Playwright cannot target Supabase and has no replacement database |
| Live `GET /`, `/student/login`, `/api/v1/health`, `/api/v1/ready` | 200 |
| Live `GET /api/v1/orders` without a session | 401 |

The new test is `test_committed_order_is_reloaded_when_the_pooler_drops_the_connection`.
