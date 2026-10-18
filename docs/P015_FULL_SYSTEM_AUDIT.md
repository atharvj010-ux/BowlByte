# P015 system audit

HEAD at the start of this phase was `6ffb003`, plus an uncommitted sign-in hydration fix. Docker was not started. Supabase was not migrated or re-imported. Live tables were not truncated.

## What was exercised in this phase

- Backend unit tests, including the new post-commit order reload test.
- Ruff on the order and session changes.
- Frontend typecheck after the hydration edits.
- Live smoke: site HTTP 200, readiness HTTP 200 in 0.52s, health in 0.003s, student sign-in page in 0.19s, anonymous orders HTTP 401.
- The API process was reloaded so the order fix is in the running server. Redis, the worker, and Beat were left running.

## What was not rerun

Integration tests and Playwright need a disposable PostgreSQL database. The previous one lived in the stopped BowlByte Docker Postgres container. This machine has no native PostgreSQL service. Starting Docker was out of bounds, and the live Supabase database was not used for destructive tests.

OTP inbox delivery, password-recovery inbox delivery, and physical phone push were not observed.

## Isolated environment

No Docker-free disposable PostgreSQL instance was available. Test Redis database `/1` is supported by the Windows Redis build, but it cannot replace PostgreSQL. Destructive suites stay blocked until a separate database exists whose name is neither `bowlbyte` nor `postgres`.
