# P009 motion system

Motion explains the order. It is not a separate show.

## Reference mapping

The entrance follows the first supplied contact sheet: a dark isometric floor, four raised modules, and lights that turn on in order — yellow, then green, then blue, then pink — with a glowing path between them. The modules are original BowlByte stations (plated food, order ticket, kitchen, pickup). They do not reuse the reference product’s words or icons.

The landing type follows the second contact sheet: oversized ivory words on a dark violet field. “Cravings” spreads and leaves, then “Made fresh” arrives. “The kitchen” does the same into “Ready to go.” The browser scroll is never hijacked. The sticky scenes use a CSS view timeline where the browser supports it, and a stacked fallback otherwise.

## Rhythm

| Moment | Duration | Notes |
| --- | --- | --- |
| Button and badge | about 150–180ms | Cart badge scale |
| Food flying to the cart | 560ms | Transform and opacity only |
| Entrance lights | about 4.8s, skippable | Yellow, path, green, path, blue, path, pink, then a pulse |
| Scroll words | tied to the section | View timeline, not a timer |
| Order ticket | about 700ms after a short delay | Total celebration stays under 4s |

## What moves

- Entrance: a module flag starts the sequence on a full document load. A later visit to `/` in the same document does not replay it. Skip removes the welcome control. The header stays usable, including Explore menu. `prefers-reduced-motion: reduce` shows the four lights already on and does not mount the welcome control.
- Hero: CSS 3D. The floor is rotated in perspective. Each module has a top, a front, and a side, plus a colored pool of light. This is not a Three.js scene.
- Scroll type: the two words share one sticky frame. The outgoing word opens its letter-spacing and moves left. The incoming word arrives from the right. Food plates sit under the first pair.
- Food card: the photo lifts slightly on hover or keyboard focus. Touch users still see the add button.
- Add to cart: the cart count updates immediately in `localStorage`. A copy of the card image then travels toward `#bowlbyte-cart-target`. If the target is missing, the image is missing, or reduced motion is on, only the count and a short “Added to cart” status change.
- Order success: a short burst and a ticket. Reduced motion, or Skip, shows the ticket immediately. The cart is cleared only after the order response is parsed.

## Reduced motion

Global CSS disables the entrance, scroll-word, flight, burst, ticket, and welcome animations. The entrance effect also checks the media query before playing. Cart and order state do not wait for animation.
