# P009 motion system

Motion explains the order. It never blocks the menu and never hijacks scrolling. The library is Motion for React (`motion/react`).

## Reference mapping

- **Entrance (video 1).** An elevated isometric floor holds four raised modules. They light in sequence (yellow, green, blue, pink) along routed traces with a pulse traveling on them. The camera eases in, and pointer parallax adds depth. BowlByte’s modules are its own stations: Discover food, Place order, Kitchen preparation, and Ready for pickup.
- **Website (video 2).** Oversized warm-white words sit on a dark violet frame. Letters split, scale, and leave through masks while the image underneath changes, then the next word assembles. BowlByte uses this for “Cravings.” → “Made fresh.” and “The kitchen” → “Ready to go”.

## Entrance timeline

| Stage | Time (ms) | What lights |
| --- | --- | --- |
| 0 | 0 | All modules dim |
| 1 | 200 | Entry trace |
| 2 | 700 | Discover food (yellow) |
| 3–4 | 1150–1750 | Trace, then Place order (green) |
| 5–6 | 2200–2800 | Trace, then Kitchen preparation (blue) |
| 7–8 | 3250–3850 | Trace, then Ready for pickup (pink) |
| 9–10 | 4300–4700 | Exit trace, final pulse |
| 11 | 5900 | Settled |

- The sequence plays on a full page load. A module flag is set when it finishes or Skip is pressed, so returning to `/` by client navigation shows the settled scene, and a refresh plays it again.
- Skip (“Lights on”) jumps to the settled state.
- Reduced motion starts settled and never shows Skip.
- The header, Explore menu, and How it works stay usable throughout.

## Scroll scenes

- `KineticSwap` is a 280vh section with a sticky stage. Progress comes from `useScroll` with offset `["start start", "end end"]`.
  - Outgoing letters spread, lift, scale, and fade between 14% and 46% progress.
  - Incoming letters assemble between 48% and 78%.
  - Back images drift with depth and fade. Incoming images are revealed by a clip-path wipe.
  - Captions change between 30% and 70%.
- Opacity, clip-path, and color use the function form of `useTransform` (`useRange`). Motion hands the array form of those properties to a native `ViewTimeline`, whose range ignores the scroll offset. In testing, that made fades run backwards: the old word was still visible at 90% progress. Transforms stay on Motion’s JavaScript path.
- The journey section is a sticky horizontal track that moves from 0% to −60% as you scroll. Below 1024 px it becomes a normal vertical list.
- `KineticText` headings reveal when the heading is 35% visible. The observer watches the heading, not each character, because a character starts clipped by its mask and would never intersect.

## Commerce motion

- **Add to cart.** The cart line is saved first. Then a copy of the dish image flies along a 14-point quadratic curve to the visible cart target in 0.82s, lifting, rotating from −10° to 18°, and shrinking. At most four flights run at once.
  - On landing, the badge springs and a status reads “Added {dish}”.
  - Reduced motion, a missing image, a missing target, or an off-screen source skips the flight. The count still updates immediately.
- **Order success.** It appears only after `POST /orders` succeeds and the response parses.
  - Food images fly in and sparks burst.
  - “Order in. Happiness loading.” assembles.
  - The ticket drops in at 1.45s with the real number, items, total, and PLACED / CASH / PENDING stamps.
  - The actions appear at 2.1s. Skip is available until then.
  - A failed request shows the error and keeps the cart.
- **Tracking.** The status headline cross-fades on change and the progress bar animates to the real fraction. Nothing advances without a server status.

## Reduced motion

`prefers-reduced-motion: reduce`:

- shortens every CSS animation and transition to effectively zero
- forces `[data-kin]` elements to `transform: none`, `opacity: 1`, and `clip-path: none`
- unpins the kinetic and journey scenes
- hides the outgoing images and captions
- shows the entrance settled

Cart and order state never wait for an animation.
