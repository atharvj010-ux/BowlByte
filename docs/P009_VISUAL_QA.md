# P009 visual QA

Inspected in the Cursor browser against `http://127.0.0.1:3010` after the frontend image rebuild.

## Landing

At a 390×844 layout viewport the first screen shows the assembled dosa plate, the headline “Good food. Zero queue drama.”, and the two real actions (Explore menu, How it works). `scrollWidth - clientWidth` was 0.

At a 1440×900 layout viewport the plate sits beside the headline: about 448×448px, starting near x=801. `scrollWidth` matched `clientWidth` (1425). The screenshot panel itself is narrower than that layout, so a single capture clips the right-hand plate. The layout measurement does not.

The story rail is a horizontal row of original vector plates (dosa, sandwich, fries, cold coffee). The next card is allowed to peek. Below it, the kitchen/ETA panel and the lime cash panel stack on a phone.

## What was not a design screenshot

Menu, cart, pairing, order success, and live tracking were exercised by Playwright against the real API (search, two adds, a configured fries-to-Coke add, a committed ticket, then Track my order). Those runs confirm the flows. They are not a substitute for a designed still of every signed-in screen.

`e2e/p008-screenshots.spec.ts` passed and writes phone, tablet, and desktop captures under `deliverables/report/screenshots` for the operational path. Those files are demonstration captures, not a claim that every pixel was art-directed again in this pass.

## Limits

- Dishes without an uploaded photo use vector plates drawn in the product. They are not photography.
- The welcome overlay is skipped once `bowlbyte.welcome` is set, and it is skipped entirely for reduced motion.
