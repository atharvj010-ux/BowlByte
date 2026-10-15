# P007 test results

Filled in as commands finish. Numbers below are the ones already observed. Later rows in the release note supersede this file if a full regression is recorded there.

| Command | Result |
| --- | --- |
| `alembic upgrade head` on `bowlbyte_test` | `0007_pickup_holds` |
| `alembic check` on `bowlbyte_test` | No new upgrade operations detected |
| `pytest` (unit, integration deselected) | 64 passed |
| `pytest -o addopts="" -m integration` | 85 passed, 2 skipped (the P005 latency file needs `P005_PERF=1`) |
| `tests/test_passwords.py` proxy cases | Included in the unit run |
| `python scripts/bench_queue.py` | 0 errors. See `docs/P007_PERFORMANCE_BASELINE.md` |
| Frontend `npm run lint`, `npm run typecheck`, `npm test` | Lint clean, typecheck clean, Vitest 39 passed |
| `npm run test:e2e` against `http://127.0.0.1:3010` | 32 passed |
| `ruff check` | Clean |
| `ruff format --check` | Fails only on already-applied `alembic/versions/0006_food_intelligence.py` line wrapping. That file was not edited |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `npm audit` | 5 high, GHSA-vfj7-8cjw-p6xm, dev tooling only |
| Staging compose config | Exit 0. Stack not started |
| Backup and restore | Dump 1204 ms, restore 2365 ms, then the disposable database was dropped |
| Android / iPhone | NOT TESTED |
