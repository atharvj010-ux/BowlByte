# P006 test results

Run on 15 October 2026 on this machine (12th Gen Intel Core i7-12650H, Windows). BowlByte ports stayed 3010, 8010, 5433, and 6379. The phishing-defense containers on 3000, 8000, and 5432 were left running.

| Check | Result |
| --- | --- |
| `docker compose build` | backend, worker, beat, and frontend images built |
| `docker compose up -d` | backend healthy, worker healthy, frontend on 127.0.0.1:3010 |
| `alembic upgrade head` on `bowlbyte` and `bowlbyte_test` | `0006_food_intelligence` |
| `alembic current` | `0006_food_intelligence (head)` |
| `alembic check` against `bowlbyte` | No new upgrade operations detected |
| `ruff check app tests` and `ruff format --check` | Passed |
| `pytest -q` (unit, integration excluded by config) | 60 passed |
| `pytest -m integration` | 84 passed, 2 skipped. The skips are `tests/test_p005_performance.py`, which run only when `P005_PERF=1` |
| Frontend `npm run lint` | Passed |
| Frontend `npm run typecheck` | Passed |
| Frontend `npm test` (Vitest) | 10 files, 39 passed |
| Frontend production build | `npm run build` inside the frontend image build |
| Playwright `npx playwright test --workers=1` against `http://127.0.0.1:3010` | 32 passed, 3.1m |
| `GET http://127.0.0.1:8010/api/v1/health` | 200, `environment` `development` |
| `GET http://127.0.0.1:8010/api/v1/ready` | 200, postgres up, redis up |
| `npm audit` | 5 high, all in the ESLint `braces` / `micromatch` / `fast-glob` chain. Not force-fixed |

The first Playwright run failed one new test because the production form only loaded the first page of menu items. A search field was added and the suite was run again. The 32 passed result is that second run.

Demo training, forecast, and planning timings are in `docs/P006_MODEL_EVALUATION.md`. They are one local run on seeded data, not a pilot benchmark.

Physical Android push and physical iPhone push were not tested.
