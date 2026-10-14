# P004 inventory consumption

P003 reserves stock when the student places an order: `available_qty` decreases and `reserved_qty` increases. `consumed_qty` stays unchanged until preparation starts.

## When a task starts

For the order's stored `service_date` and the menu item on that task:

- `reserved_qty` decreases by 1
- `consumed_qty` increases by 1
- `available_qty` is unchanged

The adjustment reason is `task_consume` with `delta_available = 0` and `delta_reserved = -1`. The task transition and the stock update commit together. A second start of the same task does not insert another adjustment.

Example, one item, two units reserved:

| Step | available | reserved | consumed |
| --- | --- | --- | --- |
| After placement of 2 | 5 | 2 | 0 |
| First task starts | 5 | 1 | 1 |
| Second task starts | 5 | 0 | 2 |

If `reserved_qty` is already 0, the start returns 409 and does not mark the task in progress. Quantities are checked so they cannot go negative.

Acceptance and queueing do not consume stock. Rejection before any task has started releases every reserved unit of that order once (`order_reject`: reserved down, available up) and does not increase `consumed_qty`. Repeating the reject returns the current `REJECTED` order and does not release stock again.

Student cancellation is still only from `PLACED`. After a task is `IN_PROGRESS`, this phase has no cancel, reject, or waste write-off.

## Concurrency

Two staff starting the same task serialize on the order row and then the task row. The loser sees a status other than `QUEUED` and returns 409 without a second consume.

Two staff starting different tasks on a station with one free slot serialize on the station row. The capacity count and the eligible-task check run while that lock is held. The loser does not consume stock.

A capacity reduction does not stop tasks that are already `IN_PROGRESS`. Further starts wait until the in-progress count is back within capacity. An inactive station refuses new starts with "That station is not accepting work."
