# P004 ETA algorithm

Estimates come from `app/services/eta.py`. The function takes the current clock, station capacities, and the canteen's queued and running tasks. Tests pass a fixed clock. The service stores absolute UTC timestamps, so a page refresh does not rewrite the estimate just because the clock moved.

There is no machine-learning model.

## Steps

1. Load active stations and tasks in `QUEUED`, `IN_PROGRESS`, or `DONE` for the canteen.
2. Give each active station one lane per `parallel_capacity`.
3. Place each running task on the earliest lane. Its finish is `started_at + duration + extra delay`. If that time is already past, the task is overdue: it still occupies the lane until `now + 60 seconds`, and the order is marked overdue. It is not treated as done.
4. Sort queued tasks by acceptance time, ticket number, unit index, and task id.
5. Assign each queued task to the earliest lane of its own station. Stations do not wait for each other.
6. The order finish is the latest unfinished task finish, plus the packing buffer (default 120 seconds).
7. Uncertainty is 20 percent of the remaining time, and at least 60 seconds. The response includes `eta_earliest_at`, `eta_ready_at`, and `eta_latest_at`. The UI labels this as approximate.

An inactive or missing station blocks the order: the ready time is null and `eta_blocked` is true.

If every task is `DONE` but staff have not confirmed packing, the estimate is `now + packing buffer` until they mark the order ready.

`eta_version` increases only when the ready second, the overdue flag, or the blocked flag changes. Reads do not recalculate. Recalculation runs on accept, start, complete, delay, reject, and station capacity or active-flag changes. The session does not autoflush, so the recalculation writes pending task rows before it reads the workload. Without that write, a newly accepted order would stay without an estimate until a later change.

## Worked example

Clock is 12:00. Packing buffer is 2 minutes. Uncertainty is forced to 0 in the unit test so the arithmetic is exact.

- Sandwich station: a running task has 12 minutes left. The new sandwich needs 6 minutes. One lane, so it finishes at 12:18.
- Coffee station: a running task has 4 minutes left. The new coffee needs 3 minutes. It finishes at 12:07.
- Order ready time is `max(12:18, 12:07) + 2 minutes` = 12:20.

The stations are not added together. Two sandwiches on a station with capacity 2 occupy both lanes and finish together. The same two sandwiches on capacity 1 finish one after the other.

A 300 second delay on a running task moves that task's finish, and therefore the order, by 300 seconds. The task stays `IN_PROGRESS`.

The frontend formats the UTC timestamps in the browser's local timezone. The stored values stay UTC.
