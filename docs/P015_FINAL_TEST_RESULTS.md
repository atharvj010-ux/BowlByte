# P015 test results

Commands were run from `backend/` or `frontend/` on 18 October 2026. Secrets were not printed. Destructive tests used only `bowlbyte_e2e` on `127.0.0.1:55432` and Redis database 15.

| Suite | Result |
| --- | --- |
| Ruff `app` and `tests` | passed |
| Unit pytest | 95 passed |
| Integration pytest | 90 passed, 2 skipped |
| ESLint | passed |
| TypeScript | passed |
| Vitest | 51 passed |
| Production build | passed |
| Playwright | 57 passed, 1 skipped |
| Live `GET /`, `/api/v1/health`, `/api/v1/ready` | 200 |
| Live `GET /api/v1/orders` and `/api/v1/menu/items` without a session | 401 |

The integration skip is the performance module, which runs only when `P005_PERF=1`. The Playwright skip is the optional P009 screenshot capture, which runs only when `P009_SHOTS=1`.

The order recovery is covered by `test_committed_order_is_reloaded_when_the_pooler_drops_the_connection` and `test_post_commit_disconnect_still_returns_the_saved_order`. The second test runs on the disposable PostgreSQL server. It does not reproduce a Supabase session pooler.
