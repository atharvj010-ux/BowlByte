# P006 production accounting

Saleable stock (`daily_stock`) is the quantity students can still order. A production batch is food the kitchen cooked. The two ledgers are not updated together.

## Batch equation

For every batch:

`produced = counter servings + remaining + discarded`

Opening a batch sets produced and remaining to the same quantity. A counter serving or a discard reduces remaining and increases the matching column. A correction sets produced, then sets remaining to produced minus servings minus discards. A correction below servings plus discards is rejected. Each change is an append-only event (`OPEN`, `SERVE_COUNTER`, `DISCARD`, `CORRECT`) with the actor and an idempotency key. The batch row is locked with `FOR UPDATE` for the adjustment.

A discard on a batch also writes `food_waste_records`. A waste entry without a batch does not change any batch. Completing a kitchen task does not create a waste row. Unsold food is not discarded unless a manager records it.

## Reconciliation

For a service date the reconciliation view shows, per item:

- produced, counter servings, remaining, and discarded from real batches
- online `PICKED_UP` quantities from orders

Online pickups are not added into the equation. If both a counter serving and an online pickup exist, the view warns that adding them can double-count. If pickups exist and no batch does, the view says those pickups are not waste.

## Demand history

Real history groups by canteen, menu item id, and the order's stored `service_date`. It includes ordered, cancelled, rejected, picked up, cash where the payment is `PAID`, produced, and discarded. The item name is a label. The key is the item id, so a rename does not merge two items.

Observed demand is ordered minus cancelled minus rejected. It is zero on a closed day or before the item existed. A day with `available_qty = 0` and `consumed_qty > 0` is censored and is not used as a training target. The CSV export has no student identifier.

Demo history is read only from `demo_demand_days`. It is never added to real totals, and seeding it does not insert orders, payments, or batches.
