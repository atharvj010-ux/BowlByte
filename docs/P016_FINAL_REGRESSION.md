# P016 final regression

Run on 18 October 2026. Integration and Playwright used `127.0.0.1:55432/bowlbyte_e2e` and Redis database 15. They did not write to the Supabase database. The live site on ports 3010 and 8010 stayed up.

| Suite | Result |
| --- | --- |
| Ruff | Pass |
| Backend unit pytest | 95 passed |
| Backend integration pytest | 90 passed, 2 skipped, 95 deselected |
| ESLint | Pass after ignoring `.next-build` |
| TypeScript | Pass |
| Vitest | 51 passed |
| Playwright | 57 passed, 1 skipped |
| Production build | Pass, output directory `.next-build` |

The two integration skips are `tests/test_p005_performance.py`. They run only when `P005_PERF=1`. The Playwright skip is the optional P009 screenshot capture, which runs only when `P009_SHOTS=1`.

The first ESLint invocation failed because it linted the local production output in `.next-build`. That directory is gitignored. `frontend/eslint.config.mjs` now ignores it, and the lint command was run again successfully. `frontend/tsconfig.json` was restored after Next.js added `.next-build` type paths during the production build, so the committed config does not depend on that local directory.

## Order creation

The integration suite includes `test_post_commit_disconnect_still_returns_the_saved_order`. The suite passed, so that case passed with the rest: the handler returns the saved order after a forced refresh error, and the disposable database keeps one order and one payment.

This is fault injection on the portable PostgreSQL server. It is not a reproduction of a dropped connection on the Supabase session pooler. No disposable Supabase project was available, and the live Supabase database was not fault-injected.

## Runtime left running

After the suites: web HTTP 200, health HTTP 200, ready HTTP 200. Celery was one worker pair (process 61128 and child 55564) and one Beat pair (process 33080 and child 62712). On Windows the launcher and child are one scheduler, not two. An older database-15 worker was stopped before the final Playwright run, and the worker started for that run was stopped afterward.
