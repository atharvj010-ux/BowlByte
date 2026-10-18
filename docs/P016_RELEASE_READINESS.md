# P016 release readiness

**Status: PASS WITH ISSUES**

**Verdict: NOT READY — hosted sign-in and mailbox delivery are still unverified**

The native application is running on Supabase PostgreSQL and Supabase Auth, with Windows Redis, one Celery worker, and one Beat scheduler. Docker is not part of startup, tests, or CI. The isolated regression passed. Two release checks that this phase was asked to close are still open, so this is not a claim of complete local release.

## Verified

- Next.js on `http://127.0.0.1:3010` returned HTTP 200.
- FastAPI health and readiness on port 8010 returned HTTP 200.
- The configured database is the Supabase session pooler, database `postgres`, PostgreSQL 17.11, TLS `verify-full`.
- Redis database 0 answered a ping. The live worker and exactly one Beat were still running after QA.
- Anonymous WebSocket upgrade was rejected. Authenticated realtime behavior passed inside the isolated Playwright suite.
- Backend unit tests: 95 passed. Integration: 90 passed, 2 skipped. Vitest: 51 passed. Playwright: 57 passed, 1 skipped. Ruff, ESLint, TypeScript, and the production build passed.
- Menu rows: 286. Rows with an uploaded image: 0. Illustrative placeholders are the current content. Upload validation already rejects non-images. Missing photographs are a content requirement.

## Not verified

| Item | Why it blocks a clean release claim |
| --- | --- |
| Student, kitchen, cashier, and manager hosted browser sign-in | The live Auth path rejected a bad password, but no authorized account was signed in |
| OTP, verification link, and password recovery | SMTP login was accepted. No message was sent or read |
| Brevo inbox delivery | No delivery log or mailbox was available |
| Physical push | No phone received a notification |
| Supabase pooler disconnect | The order recovery test used local fault injection only |

## Defects

| Severity | Open items |
| --- | --- |
| P0 | None |
| P1 | None in the exercised application paths |
| P2 | Supabase `disable_signup` is false. BowlByte registration still returned 403 for an ineligible email and created no user. |
| P3 | Menu photography is absent. HSTS is absent on the local HTTP listener. Optional performance and screenshot tests stay skipped unless their flags are set. |

## Backups

Historical dumps remain under `%LOCALAPPDATA%\BowlByte\p011`. They were not opened or deleted. The portable test cluster under `%LOCALAPPDATA%\BowlByte\e2e` remains the only disposable database.

## Completion

About 84 percent of the numbered release checks have direct evidence. Hosted role sign-in and end-to-end email are the missing portion. That is not 100 percent.

Details: `docs/P016_ZERO_DOCKER_AUDIT.md`, `docs/P016_SUPABASE_AUTH_ACCEPTANCE.md`, `docs/P016_EMAIL_VERIFICATION.md`, `docs/P016_FOUR_ROLE_ACCEPTANCE.md`, `docs/P016_FINAL_SECURITY_AUDIT.md`, and `docs/P016_FINAL_REGRESSION.md`.
