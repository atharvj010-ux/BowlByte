# P009 test results

Numbers below are from commands that finished in this implementation. A single `npx playwright test` of all 38 tests was not green in one invocation; the files were re-run after locator fixes until each file’s last run passed.

## Frontend

- `npx vitest run`: 11 files, 42 tests passed.
- `npx eslint src e2e --max-warnings 0`: exit 0.
- `npx tsc --noEmit`: exit 0.
- Docker `next build` inside `docker compose up -d --build frontend`: exit 0. The log lists routes as static or partial prerender. It did not print First Load JS sizes.

## Playwright

`PLAYWRIGHT_BASE_URL=http://127.0.0.1:3010`.

| Last run | Result |
| --- | --- |
| `e2e/auth.spec.ts` | 3 passed |
| `e2e/smoke.spec.ts` | 2 passed |
| `e2e/ordering.spec.ts` | 4 passed |
| `e2e/p009-experience.spec.ts` | 5 passed, then the four landing checks passed again after the mobile hero change |
| `e2e/intelligence.spec.ts` | 6 passed |
| `e2e/kitchen.spec.ts` | 7 passed |
| `e2e/cash-pickup.spec.ts` | 10 passed |
| `e2e/p008-screenshots.spec.ts` | 1 passed |

The P009 spec covers the landing, the skippable welcome, reduced motion, no horizontal overflow at 390px, a real menu item, two adds updating the cart count, a manager-configured fries-to-Coke pairing that the student adds, and a success ticket with the real number and `PLACED · CASH · PENDING` before tracking opens.

## Backend

Nutrition unit tests and the nutrition/pairing integration test passed earlier in this phase against `bowlbyte_test` at migration `0008_nutrition_pairings`. They were not re-run after the later frontend-only edits.

## Performance that was actually measured

A warm navigation of `/` at 390px reported `duration` 563ms and `domContentLoadedEventEnd` 520ms, with `transferSize` 0. That is a cached load, not a cold network measurement and not a Lighthouse score. No Lighthouse run was taken.

## Notes

Playwright sometimes sees two copies of the same field. The tests use the control inside `#content`. A second hidden copy is not treated as a second order.

Cash-pickup scenario 7 disables earlier push-subscription rows for that student before opting in with the failing endpoint, so a leftover device does not count as a successful delivery. The new delivery is still required to stay `PENDING` with `http_503`, and the order stays `READY`.
