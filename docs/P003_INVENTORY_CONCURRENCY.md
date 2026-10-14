# P003 inventory and concurrency

Daily stock is the saleable portion count for one menu item on one UTC date. It is not an ingredient recipe. Ingredient inventory is a later concern.

## Balances

| Column | P003 meaning |
| --- | --- |
| `available_qty` | Portions a student can still buy |
| `reserved_qty` | Portions held by `PLACED` orders |
| `consumed_qty` | Stays zero. P004 can move reserved portions here when preparation starts |

A missing stock row means zero available portions. Ordering does not create a row in order to invent stock.

Checks keep all three quantities at zero or above. Placement and cancellation lock stock rows with `SELECT … FOR UPDATE` ordered by `menu_item_id`, then change the balances. Menu item rows are locked in the same id order before the stock locks.

## Manager edits

`PATCH /api/v1/admin/stock/{item_id}` sets today's `available_qty`. It does not change `reserved_qty` and it does not reset another date. The delta is stored as an `inventory_adjustments` row. There is no midnight job that overwrites outstanding reservations.

## Cancellation

A student may cancel only their own `PLACED` order. The same `daily_stock` row identified by the order's `service_date` receives the portions back: reserved decreases and available increases. A second cancel sees `CANCELLED` and does not move stock again. Another student's cancel is a 404 and does not reveal the order.

## Idempotency

The key is unique for the authenticated student. The service takes a transaction-scoped PostgreSQL advisory lock derived from the student id and the key, then reads the stored request hash.

- Same key and same items, quantities, and note: return the original order.
- Same key and a different body: `409 IDEMPOTENCY_CONFLICT`.
- A failed attempt does not store a key, so a later corrected request can use a new key.

Two concurrent checkouts of the last portion lock the same stock row. One reserves it. The other receives `409 INSUFFICIENT_STOCK`. The available quantity cannot pass below zero because the check constraint and the locked comparison both reject that write.

## Deadlock order

Placement locks menu items, then stock, both sorted by item id. Cancellation locks the order row, then stock in the same item-id order. It does not lock menu items, so it does not cycle with placement.
