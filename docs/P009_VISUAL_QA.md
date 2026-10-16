# P009 visual QA

All stills are real browser captures from Playwright Chromium against the production Docker build at `http://127.0.0.1:3010`. They are in `docs/screenshots/p009/`. To regenerate them:

```powershell
cd frontend
$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:3010'; $env:P009_SHOTS='1'; npx playwright test e2e/p009-experience.spec.ts
```

## References

The supplied clips are in `design-reference/P009/`. FFmpeg was not available, so they were compared through the cropped contact sheets (`entrance_cropped_contact.jpg` and `website_cropped_contact.jpg`). Those sheets show nine and eleven frames.

## What was captured

| Area | Files |
| --- | --- |
| Entrance mid-sequence | `entrance-mid-1440`, `entrance-mid-390` |
| Settled hero | `hero-settled-{1440,1280,768,390,360}` |
| Kinetic break-up | `kinetic-break-{1440,1280,768,390,360}` |
| Kinetic arrival (Made fresh) | `kinetic-made-fresh-{1440,1280,768,390,360}` |
| Queue, journey, kitchen swap, pay, intelligence | `made-fresh-*`, `journey-*`, `kinetic-kitchen-*`, `pay-pickup-*`, `intelligence-*` at 1440 and 390 |
| Student dashboard | `student-dashboard-1280` |
| Menu | `menu-1280`, `menu-390` |
| Add-to-cart flight in the air | `cart-flight-1280` |
| Detail with pairing | `detail-pairing-1280` |
| Cart with pairing | `cart-1280` |
| Success, assembling and final | `success-assemble-1280`, `success-ticket-1280` |
| Tracking | `tracking-1280`, `tracking-390` |

## Comparison with the references

- **Entrance.** As in the reference, the modules start dim on a dark floor. They light yellow, then green, then blue, then pink, joined by L-shaped light traces. The modules have lit tops, dark sides, contact shadows, and colored light pools. BowlByte’s scene is closer to the camera and labels each station on the floor in mono type. At 390 px a numbered legend replaces the floor labels.
- **Kinetic type.** As in the reference, a giant word fills a violet frame, splits into clipped letters, and gives way to the next word while the image underneath changes: burger to dosa, and coke to sandwich. BowlByte’s images float as cut-outs rather than a full-bleed interior photo.

## Refinement pass

The first full capture surfaced these problems. Each was fixed and captured again.

1. **Backwards fades in the scroll scenes.** At 90% progress the outgoing word, outgoing images, and old caption were still visible, overlapping the new ones. Cause: Motion offloaded opacity and clip-path to a native `ViewTimeline` with the wrong range. Fixed by using function-form transforms. `kinetic-made-fresh-*` now shows a clean “MADE FRESH.” over the dosa.
2. **Scroll headings never appeared.** “From craving to counter.”, “Ready. Pay. Pick up.”, and “BowlByte intelligence.” were blank. Each character observed itself, but it starts clipped by its mask, so it never intersected. Fixed by observing the heading. The journey heading also stretched to the 3,400px track width, so it could never be 50% visible. Its grid column is now `minmax(0, 1fr)`.
3. **Header overflow on a signed-in phone.** At 360 px the student header was 11px too wide. The cart and Menu controls are now icons with screen-reader text below 640 px.
4. **Stale header after sign-in.** The header showed “Sign in” on the student dashboard until a reload, so the flight had no desktop cart target. Login now writes the signed-in user into the shared query cache.
5. **Pairing card squeezed in the dialog.** The name truncated to “Co…” and Add overlapped it. The list now uses auto-fill columns with a 15rem minimum.
6. **Cart said “This item is no longer listed” while loading.** The lines and summary now show a loading state until the menu query resolves.
7. **Screen-reader region names spelled out letters.** Chrome named regions like “G O O D F O O D”. Sections now carry their own `aria-label`.

## Known limits

- Images are original illustrations, labeled as such. The demo database has no uploaded canteen photos.
- The entrance is SVG with Motion. It is not a WebGL scene.
- The demo database holds many test categories (“Breakfast 06aa6d” and so on) from earlier end-to-end runs, and the menu chip row shows them.
- Full-page captures of signed-in phone screens draw the fixed student dock mid-page. That is how the screenshot is stitched, not how the layout looks.
