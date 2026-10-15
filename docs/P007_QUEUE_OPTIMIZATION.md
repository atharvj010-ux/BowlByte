# P007 queue optimization

## What was slow

Every kitchen mutation called `_lock_queue`, which locks every `QUEUED` and `PREPARING` order for the canteen, and `_refresh`, which rebuilds ETAs. The lock is there so two starts cannot interleave a capacity check. FIFO eligibility is computed inside that lock. SKIP LOCKED is not used on the kitchen queue.

`_refresh` also selected every `DONE` task the canteen had ever stored. The scheduler only needs `QUEUED`, `IN_PROGRESS`, and `DONE` tasks that still belong to an open order.

## What changed

`_refresh` now loads open tasks by canteen and `DONE` tasks only for orders still in the kitchen. Estimates are still written in the same transaction as the mutation. WebSocket events are still published after commit.

An advisory lock was tried in place of the row locks. On this machine the 10-order and 50-order batches were slower, so the row lock remains. See `docs/P007_PERFORMANCE_BASELINE.md`.

## What did not change

Station capacity, FIFO start eligibility, one-time stock consumption, and the order state machine are unchanged. ETA values are still estimates, not a second source of kitchen truth.
