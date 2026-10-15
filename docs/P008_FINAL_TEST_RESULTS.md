# P008 test results

Date: 16 October 2026. Commands were run on this machine. Skipped tests are not counted as passed.

| Check | Result |
| --- | --- |
| `docker compose -f docker-compose.yml config --quiet` | Passed |
| `docker compose --env-file deploy/staging.env.example -f docker-compose.staging.yml config --quiet` | Passed. Staging was not started |
| Docker image build | `docker compose up -d --build` rebuilt backend, worker, beat, and frontend. Containers came up healthy |
| Alembic current | `0007_pickup_holds (head)` |
| Alembic check | No new upgrade operations |
| `ruff check .` | Passed. `alembic/versions/0006_food_intelligence.py` ignores E501 in project config only |
| `ruff format --check .` | Passed. The same file is excluded from the formatter |
| `ruff format --check alembic/versions/0006_food_intelligence.py` | Failed. The applied migration was not edited |
| Backend unit tests | 65 passed |
| PostgreSQL integration | 85 passed, 2 skipped, 65 deselected. Eligibility mode was `institutional_domain` |
| Frontend lint, typecheck, Vitest | Lint passed, typecheck passed, 39 Vitest tests passed |
| `next build` | Passed |
| Playwright | 33 passed in 5.7 minutes against `http://127.0.0.1:3010` |
| npm audit | 5 high. All are `braces` through `eslint-config-next` (GHSA-vfj7-8cjw-p6xm). `npm audit fix --force` would downgrade ESLint and was not run |
| `npm audit --omit=dev` | 0 vulnerabilities |
| API health and ready | `ok` and `ready`. PostgreSQL and Redis up |
| Backup and restore | Dump 757 ms. Restore into `bowlbyte_restore` 1728 ms. Both sides: 1 order, revision `0007_pickup_holds`. Disposable database and dump deleted. `bowlbyte` was not dropped |
| Phone push | NOT TESTED |
| Public HTTPS | NOT DEPLOYED |
| Report DOCX and slide PPTX | Generated |
| A1 poster PDF | Generated. Page box about 1684 by 2385 points |
| Report PDF, slide PDF, MP4 | NOT GENERATED |

The two skipped integration tests run only when `P005_PERF=1`. They were not run in this pass.

Responsive captures are in `deliverables/report/screenshots/` at 390, 768, and 1280 pixels. The pictured pickup QR belongs to an order that the same run marked `PICKED_UP`.
