# P009 frontend design system

BowlByte’s public and student surfaces share one direction: **BowlByte — cravings in motion**. It takes structure from two supplied references, an isometric entrance and a kinetic-type website. It takes nothing else from them: no words, logos, products, or imagery.

## Direction

- The scene is charcoal, lit by violet from inside the story frames.
- Warm white carries the type.
- Lime is the primary action color: Explore menu, Track my order, and the estimate panel.
- Coral is the commerce color: Add to cart, Place order, prices, and the cart pill.
- Electric blue is used for small indices and the intelligence bars.
- The entrance uses four station lights: yellow, green, blue, and pink. They stay on the isometric modules and are not reused as a page gradient.
- Kitchen, cashier, and manager desks inherit the tokens and type. They have no decorative motion.

## Color

| Token | Value | Use |
| --- | --- | --- |
| `--background` | `#0e0d12` | Page |
| `--ink` | `#191919` | Text on lime and on the ticket |
| `--ivory` | `#F4EDDD` | Type |
| `--lime` | `#D5F25B` | Primary pill, eyebrows, estimate panel |
| `--chili` | `#F15438` | Add, Place order, prices, cart |
| `--violet` | `#5c2ea8` | Light inside the kinetic frames and the success stage |
| `--electric` | `#4aa8ff` | Indices, intelligence bars |
| `--tone-yellow/green/blue/pink` | `#f6d15a` `#3df28b` `#4aa8ff` `#ff5c8a` | The four entrance stations only |

## Type

- Display: Bricolage Grotesque, extra-bold and uppercase, for titles, prices, and ticket numbers.
- Body: Figtree.
- Mono: JetBrains Mono, letter-spaced, for eyebrows, tags, status stamps, and floor labels.
- Kinetic headings are split into masked characters. The heading element carries the real text as `aria-label`, and the split spans are `aria-hidden`. A section named by one of these headings uses its own `aria-label`, because Chrome otherwise builds the region name from the split spans letter by letter.

## Components

- `EntranceScene` (`components/home/entrance-scene.tsx`) is an SVG isometric floor with four two-tier modules, routed light traces, floor labels, and a Skip control.
- `KineticText` and `KineticSwap` (`components/motion/kinetic.tsx`) handle masked character headings and the pinned word-swap scenes.
- `MenuCard` shows the photo, name, description, rupee price, nutrition line, serving, availability, and an Add button that is always visible. A mouse pointer tilts the card. Touch shows the same card flat.
- `FoodPicture` uses the canteen’s uploaded photo when there is one. Otherwise it uses an original illustration labeled “Illustrative image”, or a drawn plate when no illustration matches the dish name.
- `FoodDetail` is a native dialog with large media, facts, Add to cart, and `FoodPairings` (“Perfect together.”).
- `CartDesk` holds animated lines, quantity controls, a sticky summary, the cash note, and pairings. It shows a loading state until prices arrive.
- `OrderSuccess` is the ticket celebration, shown only after the order API has returned.
- `OrderDetail` (tracking) has the hero ticket, status headline, progress, step rail, kitchen task chips, ETA panel, and pickup pass.

## Food imagery

`frontend/public/food/` holds 11 dishes in two sizes, 22 WebP files. They are original illustrations made for this project, not photography of the canteen and not taken from either reference. Every place that shows one also shows an “Illustrative” tag or note. No menu item in the demo database has an uploaded photo. When a canteen uploads one, it replaces the illustration automatically.

## Responsive and focus rules

- Checked at 360, 390, 768, 1280, and 1440 px with no horizontal overflow.
- Below 640 px, the signed-in header shows the cart as a bag icon with the count, and Menu as an icon. Both keep their text names for assistive technology, so the cart’s accessible name is still “Cart N”.
- The full navigation appears from 1024 px. The student dock is used below that.
- Buttons and inputs show a 2px ring on focus. Essential actions are never hover-only.
