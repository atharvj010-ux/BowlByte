# P004 order and task state machine

Payment status stays independent of preparation. A `READY` order can still be `CASH` / `PENDING`. Kitchen actions never set a payment to `PAID`. `PICKED_UP` remains defined for P005 and is not a working transition.

## Order statuses

| From | To | Who | Rule |
| --- | --- | --- | --- |
| PLACED | ACCEPTED | Kitchen staff | Recorded in the same transaction as queueing |
| ACCEPTED | QUEUED | Kitchen staff | Same transaction. Tasks are created here |
| QUEUED | PREPARING | Kitchen staff | First preparation task starts |
| PREPARING | READY | Kitchen staff | Every task is `DONE` and `packed` is true |
| PLACED | CANCELLED | Owning student | Unchanged from P003. Releases reservations |
| PLACED | REJECTED | Kitchen staff | Releases reservations. No consumption |
| QUEUED | REJECTED | Kitchen staff | Only when every task is still `QUEUED` |

`ACCEPTED` is not left waiting on a background job. Accept writes both events, then the order rests at `QUEUED`. Repeating accept on an order that is already `QUEUED`, `PREPARING`, or `READY` returns the current order and does not create more tasks.

Any other transition returns HTTP 409. A `READY` order cannot move back to `PREPARING`.

Each change inserts an `order_events` row with the actor, previous status, new status, and reason. `orders.version` increases by one. Delay records a same-status event and still increases the version.

## Preparation tasks

One task is created per ordered unit. A line of quantity 3 creates units 1, 2, and 3. The pilot refuses acceptance above `KITCHEN_MAX_TASKS_PER_ORDER` (40) and tells the kitchen to split the order.

| From | To | Effect |
| --- | --- | --- |
| QUEUED | IN_PROGRESS | Staff start. One reserved unit becomes consumed |
| IN_PROGRESS | DONE | Staff complete. The station slot is free |
| QUEUED | CANCELLED | Rejection before any unit has started |

A timer does not mark a task `DONE`. Completing a task that is already `DONE` returns the order again and does not consume stock. Starting a task that is not `QUEUED` returns 409.

The station and `expected_duration_seconds` are copied from the order line at acceptance. A later menu edit does not rewrite those snapshots. If a line has no station, or the station is inactive, acceptance is rejected with an instruction to assign an active station. Each menu item has one station assignment, so that assignment is the primary station.

## Lock order

A kitchen change locks every queued and preparing order in the canteen, ordered by id, before it locks a station or a task. That stops two starts from each holding one order and then waiting to write the other order's estimate. The station is locked before the task. Locking the task first takes a key share on the station, and two starts then deadlock when they upgrade that share to `FOR UPDATE`. The item's `daily_stock` row is locked last.

With one free slot, only the earliest queued tasks for that station may start. Order is acceptance time, ticket number, unit index, then task id. A later ticket returns 409, "An earlier ticket is waiting at this station." There is no manager priority override in P004.
