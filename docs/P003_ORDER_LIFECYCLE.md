# P003 order lifecycle

Fulfillment and payment stay separate. P003 writes two fulfillment states.

| Status | Who | What is stored |
| --- | --- | --- |
| `PLACED` | Verified student | Order, item snapshots, `CASH` / `PENDING` payment, and a `PLACED` event |
| `CANCELLED` | Owning student, from `PLACED` only | Status, version bump, `CANCELLED` event, stock release |

The database check also allows `ACCEPTED`, `QUEUED`, `PREPARING`, `READY`, `PICKED_UP`, `REJECTED`, and `UNCLAIMED` so P004 and P005 can use the same table. No P003 endpoint sets those values. `POST /api/v1/orders/{id}/ready` and any payment confirmation path are not registered.

A cancelled order stays in history. It is not returned to the kitchen list. Placing it again requires a new order.

## Snapshots

Each line stores the item name, unit price in paise, quantity, line total, station name, and `prep_seconds` from the locked menu row. Later edits to the menu do not change the line. The line total check is `unit_price_paise * quantity`.

## What P004 should consume

- `kitchen_stations.parallel_capacity` for how many tickets a station can prepare at once
- `order_items.prep_seconds` and `station_id` as the workload inputs
- `order_events` rows whose `to_status` is `PLACED` as the start of the ticket
- `daily_stock.reserved_qty` as portions already promised and not yet consumed
- `orders.version` for the compare-and-swap transition described in `docs/ORDER_STATE_MACHINE.md`

P004 should not treat a `PENDING` payment as a reason to refuse preparation. Cash collection remains P005. Pickup remains blocked until payment is `PAID`.

## Student and staff screens

Students see their own tickets, historical prices, `CASH`, and `PENDING`. Kitchen staff see ticket number, time, items, quantities, note, `PLACED`, and `PENDING` for their canteen. The screen is labeled Incoming orders. It does not show a queue position or an estimate.
