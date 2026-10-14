# P003 menu and ordering

P003 adds a database-backed menu, daily portions, a student cart, and cash-on-pickup placement. Payment stays `PENDING`. Kitchen staff can read new tickets. They cannot advance them.

## Schema

Migration `0003_menu_ordering` follows `0002_identity`. It does not edit the earlier revisions.

| Table | Role |
| --- | --- |
| `menu_categories` | Named groups for one canteen |
| `menu_items` | Name, description, `price_paise`, active and available flags, `prep_seconds`, optional image bytes |
| `kitchen_stations` | Name, `parallel_capacity`, active flag |
| `menu_item_station_assignments` | One station per item |
| `daily_stock` | `available_qty`, `reserved_qty`, and `consumed_qty` for one item and one UTC service date |
| `inventory_adjustments` | Append-only deltas for manager edits and reservations |
| `orders` | Ticket, student, canteen, status, total, `CASH`, note, service date, version |
| `order_items` | Name, unit price, quantity, line total, and station snapshot |
| `order_events` | Insert-only status history |
| `order_payments` | One row per order. New rows are `CASH` / `PENDING` |
| `order_idempotency_records` | Unique per student and checkout key |

Images are stored in PostgreSQL, not on a client-supplied path. The upload is base64 JSON limited to 1.5 MB. The bytes must match a JPEG, PNG, or WebP signature. The public URL is `/api/v1/menu/items/{id}/image`. Items without a photo use a letter placeholder in the browser.

## Placement

`POST /api/v1/orders` accepts item ids, quantities from 1 to 20, an optional note, and an idempotency key. It ignores any price, total, user, canteen, or payment field because those fields are rejected by the schema.

The service locks the menu rows, locks that day's stock in item-id order, checks availability, reserves portions, and inserts the order, snapshots, payment, event, and idempotency row in one commit.

The browser cart stores only item ids and quantities in `localStorage`. Checkout reloads current prices from the API and shows them as an estimate. The saved total is the database total.

## Seed

`python -m app.cli.seed_menu` inserts the sample categories Breakfast, Snacks, Main Course, and Beverages, three stations, and the eight sample dishes. Each sample item has `is_demo` and a `seed_key`. A second run skips existing keys. It does not create accounts or orders.

## Permissions

Students read the pilot canteen menu and their own orders. Managers change menu, stations, and stock for their membership canteen only. Kitchen staff read `PLACED` orders for their canteen. Cashiers do not get those routes. A manager cannot invite or create another manager through these routes.

## Not in this phase

Preparation transitions, ETAs, WebSockets, push notifications, cash confirmation, and QR pickup are not implemented. The manager order page reports placed value and cancelled value. Cash collected is null, with a note that collection waits for a later cashier confirmation.
