# P001 verification baseline

Recorded before authentication work. This document states what was run and what remains unresolved. The braces finding below is not fixed.

## Git

The repository had no commits when this baseline was recorded. The working tree was the P001 foundation. `.env` is gitignored and is not part of the baseline.

## Dependency audit

`npm audit` in `frontend/` reported 5 high-severity findings and no critical, moderate, or low findings. All five are one development-toolchain chain:

| Package | Installed | Advisory |
| --- | --- | --- |
| `braces` | 3.0.3 | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), range `<=3.0.3`, stack-exhaustion denial of service through deeply nested patterns |
| `micromatch` | 4.0.8 | via `braces` |
| `fast-glob` | 3.3.1 | via `micromatch` |
| `@next/eslint-plugin-next` | 16.4.0 | via `fast-glob` |
| `eslint-config-next` | 16.4.0 | via `@next/eslint-plugin-next` |

Path:

`eslint-config-next@16.4.0` → `@next/eslint-plugin-next@16.4.0` → `fast-glob@3.3.1` → `micromatch@4.0.8` → `braces@3.0.3`

`braces@3.0.3` is the newest published version, so there is no compatible upgrade. `npm audit fix --force` proposes downgrading `eslint-config-next` to 14.2.35. That downgrade is incompatible with Next.js 16.4 and was not applied. The chain is pulled in by the ESLint plugin used at development time. It is not an application runtime authentication or request-handling dependency.

## ESLint

`eslint@9.39.5` is deprecated on npm: "This version is no longer supported." `eslint-config-next@16.4.0` accepts `eslint >= 9`. The direct dependency is pinned to `eslint@10.12.0`.

`npx eslint .` completed with exit code 0 after that pin.

Nested packages still declare a peer range that stops at ESLint 9: `eslint-plugin-import@2.32.0`, `eslint-plugin-jsx-a11y@6.10.2`, and `eslint-plugin-react@7.37.5`. npm installed ESLint 10 with an `ERESOLVE` override. Lint runs. Those nested peer ranges are a remaining mismatch inside the Next.js ESLint package, not a failed lint.

## Checks run for this baseline

| Check | Result |
| --- | --- |
| Frontend `npx eslint .` | Exit 0 |
| Frontend `npm run typecheck` | Exit 0 |
| Frontend `npm test` (Vitest) | 6 passed |
| Frontend Playwright Chromium install | Exit 0. Chrome for Testing, headless shell, FFmpeg, and Winldd downloaded |
| Frontend Playwright `e2e/smoke.spec.ts` against `http://127.0.0.1:3010` | 2 passed |
| Backend `ruff check .` | All checks passed |
| Backend `pytest` | 5 passed, 1 integration test deselected |

The smoke tests checked the public landing page and the unimplemented-auth copy on `/student`. That copy is the P001 behavior. Phase P002 replaces it with real session checks and updates the smoke test.

Earlier P001 bring-up, already in place before this record, confirmed health and readiness on the overridden ports, Alembic `0001_baseline`, the production frontend build, and a connected Celery worker. Those containers were left running. The phishing-defense containers on ports 3000, 8000, and 5432 were not modified.

## Local ports in use

| Service | Address |
| --- | --- |
| Web | http://127.0.0.1:3010 |
| API | http://127.0.0.1:8010 |
| PostgreSQL | 127.0.0.1:5433 |
| Redis | 127.0.0.1:6379 |

Compose defaults remain 3000, 8000, and 5432. The overrides live in the gitignored `.env`.
