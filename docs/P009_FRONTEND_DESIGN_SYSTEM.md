# P009 frontend design system

BowlByte’s public and student surfaces use one art direction: food in motion. The page should feel like a canteen counter that is already moving, not a generic delivery template.

## Direction

- The page is a dark charcoal night scene, with a violet wash behind the landing.
- Warm ivory is the type.
- Chili is the only primary action color.
- Lime is a small accent for labels and estimates.
- The entrance uses four local lights: yellow, green, blue, and pink. Those lights stay on the isometric modules. They are not a general UI gradient.

Operational desks (kitchen, cashier, manager) inherit the same tokens and type. They do not get decorative motion.

## Color

| Token | Value | Use |
| --- | --- | --- |
| `--background` | `#0e0d12` | Page |
| `--ivory` | `#F4EDDD` | Type |
| `--ink` | `#191919` | Text on lime panels, ticket ink |
| `--chili` | `#F15438` | Primary buttons, prices, active progress |
| `--lime` | `#D5F25B` | Small highlights and the intelligence panel |
| `--card` | `#17151d` | Cards |
| `--muted-foreground` | `#c4b8a8` | Secondary text |

## Type

- Display: Bricolage Grotesque, for headlines and prices.
- Body: Figtree, for descriptions and controls.
- Headlines are large and tight. Body copy stays in a short measure.

## Space, radius, shadow

- Page columns stay inside `max-w-6xl` with `px-4` / `sm:px-6`.
- Cards use a 1.5rem radius. The hero and success panel use a slightly larger radius.
- Shadows are one soft charcoal drop on food cards. They are not stacked glass blurs.

## Components

- `MenuCard` is the food unit: a real photo when the canteen uploaded one, otherwise an original vector plate (dosa, sandwich, fries, drink, or bowl). It also shows the name, description, rupee price, calorie line, availability, and an add control that is always visible.
- `FoodDetail` is a native dialog. Escape and the backdrop close it. Focus starts on Close.
- `FoodPairings` is optional. It never adds an item by itself.
- `OrderSuccess` shows the real ticket only after the order API returns.
- `StudentDock` is the phone navigation for `/student`. Targets are at least 44px.

## Focus and responsive rules

- Buttons use a 2px ring. Inputs use the same ring.
- At `lg` (1024px) the header shows the full navigation. Below that, a Menu disclosure is used so 768px does not overflow.
- The student dock is hidden from `lg` up.
- Essential actions are not hidden behind hover.
