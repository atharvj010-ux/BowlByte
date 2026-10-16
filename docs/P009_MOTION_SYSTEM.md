# P009 motion system

Motion explains the order. It is not a separate show.

## Rhythm

| Moment | Duration | Notes |
| --- | --- | --- |
| Button and badge | about 150–180ms | Cart badge scale |
| Food flying to the cart | 560ms | Transform and opacity only |
| Hero assembly | about 0.8–1.2s, staggered | Runs once on load |
| Welcome | about 1.4s, skippable | Session flag `bowlbyte.welcome` |
| Order ticket | about 700ms after a short delay | Total celebration stays under 4s |

There is no scroll hijacking. The browser scroll remains normal.

## What moves

- Welcome: charcoal full-screen BowlByte line, then the hero. Skip is always available. `prefers-reduced-motion: reduce` never shows it.
- Hero: four original SVG layers (plate, dosa, chutney and potato, seeds) assemble in the center of the frame. This is BowlByte vector art, not a downloaded 3D model and not a hotlinked photo. Menu cards without a canteen photo use the same kind of vector plate.
- Food card: the photo lifts slightly on hover or keyboard focus. Touch users still see the add button.
- Add to cart: the cart count updates immediately in `localStorage`. A copy of the card image then travels toward `#bowlbyte-cart-target`. If the target is missing, the image is missing, or reduced motion is on, only the count and a short “Added to cart” status change.
- Order success: a short burst and a ticket. Reduced motion, or Skip, shows the ticket immediately. The cart is cleared only after the order response is parsed.

## Reduced motion

Global CSS disables the hero, flight, burst, ticket, and welcome animations. The welcome effect also checks the media query before showing. Cart and order state do not wait for animation.
