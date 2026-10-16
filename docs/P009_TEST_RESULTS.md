# P009 test results

Numbers below are from commands that finished in this implementation. A single `npx playwright test` of all 38 tests was not run again after the cinematic landing. The landing, menu, cart, pairing, and order-success path was.

## Frontend

- `npx vitest run`: 11 files, 42 tests passed.
- `npx tsc --noEmit`: exit 0.
- `npx eslint` on the edited landing, student, header, and layout files, `--max-warnings 0`: exit 0. A full `src e2e` lint was not re-run in this pass.
- Docker `next build` inside `docker compose up -d --build --no-deps frontend`: exit 0. The log did not print First Load JS sizes.

## Playwright

`PLAYWRIGHT_BASE_URL=http://127.0.0.1:3010`.

| Last run | Result |
| --- | --- |
| `e2e/smoke.spec.ts` | 2 passed |
| `e2e/p009-experience.spec.ts` | 5 passed |

The P009 spec covers the landing, the skippable welcome, reduced motion, no horizontal overflow at 390px, a real menu item, two adds updating the cart count, a manager-configured fries-to-Coke pairing that the student adds, and a success ticket with the real number and `PLACED · CASH · PENDING` before tracking opens.

An earlier attempt failed before any assertion because the sandbox Playwright browser was missing. After `npx playwright install chromium`, the suite above passed. One landing assertion failed first because two links were both named “Explore menu”. The closing action is now “Open the menu”. The hero link is still “Explore menu”.

## Backend

No backend or migration change in this pass. Nutrition and pairing tests from the earlier P009 commit were not re-run.

## Performance that was actually measured

At 1440×900, `documentElement.scrollWidth` was 1425 and `clientWidth` was 1425. At 390×844, both were 390. No Lighthouse run was taken, and no cold transfer size was recorded for this build.
