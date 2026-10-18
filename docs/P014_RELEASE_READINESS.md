# P014.2 release readiness

Status: PASS WITH ISSUES.

The native site, API, Windows Redis, one Celery worker, and one Beat scheduler are the live runtime. Supabase PostgreSQL and Supabase Auth are authoritative. A disposable four-role order went from placement through cash payment and one-time pickup, and the student's WebSocket received the kitchen event.

## Verified in this phase

- Backend unit tests: 94 passed.
- Backend integration tests on disposable `bowlbyte_test`: 89 passed, 2 skipped.
- Ruff: passed.
- Vitest: 51 passed.
- ESLint: passed.
- TypeScript: passed.
- Production build: passed, 42 routes.
- Native health after Docker was stopped: web and `/api/v1/ready` returned 200.

## Not claimed

- OTP and password-recovery inbox delivery.
- Physical phone push delivery.
- Playwright on the native Supabase runtime.
- Food photographs. The live menu has no stored image bytes.
- The first create-order response returned 500 once even though the order was saved. The idempotent retry returned it, and the rest of the workflow completed. The exception was not captured because that API process was buffering logs.
- Windows Celery solo pool and the third-party Windows Redis build are local limitations, not an upstream-supported production pool.

## Docker

BowlByte containers are stopped and their restart policy is `no`. The PostgreSQL volume and the dumps under `%LOCALAPPDATA%\BowlByte\p011` stay. Compose is not the start path. Unrelated containers were left running. Docker Desktop was not uninstalled.
