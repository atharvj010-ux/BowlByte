# P002 test results

Recorded after the authentication implementation was running on the local BowlByte ports. These are the commands that completed. The braces audit finding is still open.

## Commands and results

| Check | Result |
| --- | --- |
| `docker compose ps` | `bowlbyte-backend-1` healthy on 127.0.0.1:8010, `bowlbyte-frontend-1` on 127.0.0.1:3010, `bowlbyte-mailpit-1` healthy on 127.0.0.1:8025 and 1025, `bowlbyte-postgres-1` healthy on 127.0.0.1:5433, `bowlbyte-redis-1` healthy on 127.0.0.1:6379, `bowlbyte-worker-1` healthy |
| `alembic current` inside the backend container | `0002_identity` (head) |
| `GET http://127.0.0.1:8010/api/v1/health` | 200, `environment` `development` |
| `GET http://127.0.0.1:8010/api/v1/ready` | 200, postgres up, redis up |
| `GET http://127.0.0.1:3010/api/v1/health` | 200, same body as the direct health check |
| `GET http://127.0.0.1:3010/` | 200 |
| Backend `ruff check .` and `ruff format --check .` | All checks passed. 44 files already formatted |
| Backend `pytest` (integration marker excluded by addopts) | 8 passed, 12 deselected |
| Backend `pytest -m integration` against `bowlbyte_test` on 127.0.0.1:5433, Redis 127.0.0.1:6379, SMTP 127.0.0.1:1025, Mailpit `http://127.0.0.1:8025` | 12 passed, 8 deselected, 33.07s |
| Frontend `npm run lint` | Exit 0 |
| Frontend `npm run typecheck` | Exit 0 |
| Frontend `npm test` (Vitest) | 4 files, 8 passed |
| Frontend `npx next build` | Exit 0. 22 routes. Protected account routes are partial prerender. `/api/v1/[...path]` is dynamic |
| Frontend `npx playwright test` with `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3010` and `MAILPIT_URL=http://127.0.0.1:8025` | 5 passed, 32.5s |
| Frontend `npm audit` | Exit 1. 5 high-severity findings, no critical, moderate, or low findings |

The Playwright file `e2e/auth.spec.ts` registered an eligible student, read the verification link from the Mailpit API, confirmed the email, signed in, reloaded, opened `/admin` and saw the denial, then logged out and confirmed `/student` returned to the sign-in screen. It then bootstrapped a manager through `docker compose exec`, invited kitchen staff, accepted the invitation in a second browser context, denied `/cashier`, deactivated that staff row, and confirmed `/staff` returned to the kitchen sign-in screen.

An earlier full-suite run failed once because a previous kitchen row already showed `DISABLED`, so the assertion passed before the new account's session was revoked. The test now waits for the PATCH of that email's row. The 5-passed result above is the run after that correction.

## Security cases

The twenty cases in `docs/P002_SECURITY_TESTS.md` are covered by the integration module and the Playwright auth spec that passed in the table above. Password hashing is the unit test `test_password_hash_uses_argon2id_and_verifies`.

## Unresolved audit finding

`npm audit` still reports the same five high-severity findings recorded in `docs/P001_VERIFICATION.md`. They are one development-toolchain chain:

`eslint-config-next@16.4.0` → `@next/eslint-plugin-next@16.4.0` → `fast-glob@3.3.1` → `micromatch@4.0.8` → `braces@3.0.3`

Advisory: [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). `braces@3.0.3` is the newest published release. `npm audit fix --force` would install `eslint-config-next@14.2.35`, which is incompatible with Next.js 16.4. That downgrade was not applied.

Nested ESLint plugins still declare a peer range that stops at ESLint 9 (`eslint-plugin-import@2.32.0`, `eslint-plugin-jsx-a11y@6.10.2`, `eslint-plugin-react@7.37.5`). The direct dependency remains `eslint@10.12.0`. `npm run lint` completed with exit code 0.

## Containers left running

BowlByte stayed on 3010, 8010, 5433, and 6379. Phishing-defense containers were not stopped or modified.
