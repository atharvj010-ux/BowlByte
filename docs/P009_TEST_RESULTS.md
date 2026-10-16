# P009 test results

Every number below comes from a command that finished in this pass, against the rebuilt production image.

## Frontend

- `npx tsc --noEmit`: exit 0.
- `npx eslint src e2e --max-warnings 0`: exit 0.
- `npx vitest run`: 13 files, 46 tests passed. New in this pass:
  - `food-art.test.ts`: a canteen photo wins over an illustration, dish matching works, and unknown dishes get no image.
  - `kinetic.test.tsx`: one readable heading name while the letters are split.
- Production build: `next build` inside `docker compose up -d --build frontend` exited 0. That command also recreated the backend container, with no backend code change.

## Playwright

`PLAYWRIGHT_BASE_URL=http://127.0.0.1:3010`, Chromium, one worker.

| Run | Result |
| --- | --- |
| `auth`, `smoke`, `ordering`, `kitchen`, `cash-pickup`, `intelligence`, `p009-experience` together | **43 passed, 1 skipped** (3.7 min) |
| `p009-experience` with `P009_SHOTS=1` | 12 passed, including the five-width capture |

- The skipped test is the screenshot capture. It runs only when `P009_SHOTS` is set.
- `p008-screenshots.spec.ts` was not run because it rewrites the academic report screenshots.

What `p009-experience` checks:

- The entrance can be skipped and settles. It replays on refresh but not on client navigation. Reduced motion starts settled.
- The kinetic and journey scenes render while scrolling.
- The landing has no horizontal overflow at 360, 390, 768, 1280, and 1440 px. The signed-in menu has none at 360 and 390, and tracking has none at 390.
- A manager configures a fries-to-Coke pairing.
- A student adds twice, with the flight and the cart count going 1 → 2. The student opens the detail view, adds the pairing (count 3), and the cart shows “Pay cash at the canteen counter.” and “Perfect together.”.
- The student places the order. The success ticket shows the real `B…` number and PLACED / CASH / PENDING, and Track my order opens tracking.

Test changes, all caused by intentional UI changes:

- `ordering.spec.ts` uses exact text for the two cart item names, because the cart summary now repeats them (“Veg Sandwich × 1”).
- `p009-experience.spec.ts` targets visible nodes. React streaming briefly keeps a hidden second copy of the page in `<div hidden id="S:0">` for about 0.5–0.8s after load. It caused intermittent strict-mode and detached-node failures. Users never see it, and no hydration error was logged.
- `login-form.test.tsx` renders inside a `QueryClientProvider`, because login now updates the shared user cache.

## Backend

No backend code, migration, or API change in this pass. The backend test suite was not rerun.

## Not measured

No Lighthouse run and no transfer-size budget were recorded. The entrance and scroll scenes are SVG, CSS, and Motion. There is no WebGL or video on the page.
