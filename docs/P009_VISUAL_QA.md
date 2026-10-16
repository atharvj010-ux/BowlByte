# P009 visual QA

Inspected in the Cursor browser against `http://127.0.0.1:3010` after the frontend image rebuild.

## Reference

The entrance contact sheet is a dark isometric floor with four raised modules. Lights come on yellow, then green, then blue, then pink, and a path connects them. The website contact sheet is a dark violet field with oversized white words that spread and give way to the next word. BowlByte uses that structure with its own food stations and its own words. The reference brands are not on the page.

## Landing

At a 1440×900 layout viewport, `scrollWidth` matched `clientWidth` (1425). The hero is the headline “Good food. Zero queue drama.”, the two actions, and a perspective floor. Four modules sit on that floor with yellow, green, blue, and pink light. The capture window is narrower than 1440, so one screenshot shows the right-hand modules and clips the left of the floor. The layout measurement does not.

At a 390×844 layout viewport, `scrollWidth` matched `clientWidth` (390). The headline, full-width Explore menu and How it works buttons, and the four modules are in the first screen. Playwright’s mobile overflow check passed on the rebuilt image.

Scrolling the first story section shows “Cravings” opening into “Made fresh”, with vector plates for dosa, sandwich, fries, and cold coffee underneath. A second section does the same from “The kitchen” to “Ready to go.”

## What was not a designed still

Menu, cart, pairing, and order success were exercised by Playwright against the real API (search, two adds, a configured fries-to-Coke add, a committed ticket, then Track my order). Those runs confirm the flows. They are not a substitute for a designed still of every signed-in screen.

## Limits

- Dishes without an uploaded photo use vector plates drawn in the product. They are not photography.
- The entrance is CSS perspective, not a WebGL scene.
- The entrance replays on a full load. It does not replay when the same document returns to `/`.
- Reduced motion shows the four lights already on and does not mount the welcome control.
