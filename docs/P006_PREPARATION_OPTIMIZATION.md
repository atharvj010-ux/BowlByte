# P006 preparation planning

The recommendation answers how many additional portions to cook. It does not reserve stock.

## Quantity

```
target = confirmed unfulfilled orders, when there is no forecast
target = max(forecast, confirmed unfulfilled orders) + buffer, otherwise
buffer = round(forecast * PLANNING_BUFFER_RATIO)   # default 0
additional = max(0, target - usable remaining - already scheduled)
```

Confirmed orders are items on orders in `PLACED`, `ACCEPTED`, `QUEUED`, `PREPARING`, or `READY` for that service date. They are a floor. They are not added on top of a forecast that already represents the day's demand.

Usable remaining is `remaining_qty` on real batches for that date. Scheduled is the additional quantity on approved plans for that date, minus what those batches already produced, and never below zero. `daily_stock.available_qty` is not used.

## Stations

Free seconds for a station are `parallel_capacity * PLANNING_WINDOW_SECONDS` (default 3 hours) minus the expected duration of that day's `QUEUED` and `IN_PROGRESS` tasks. An inactive station, or a capacity override of zero in a simulation, has no free time. Items are filled in order of confirmed quantity, then forecast. Each recommended portion consumes the item's preparation seconds. The recommended quantity never exceeds the minutes that remain, so the greedy plan is feasible by construction.

`PLANNING_SHORTAGE_WEIGHT` (default 3) and `PLANNING_OVERPRODUCTION_WEIGHT` (default 1) are stored on the plan as preferences. The allocator does not solve a weighted cost. Google OR-Tools is not installed. If a caller sets the timeout flag, every item is unmet and the solver name is `TIMEOUT`; those quantities are not a plan to cook. The HTTP path uses `GREEDY`.

## Example from the demo measurement

On the seeded one-item series the draft said, in substance: forecast 21, confirmed 0, usable 0, scheduled 0, recommend 21, because the station still had room. That sentence is an estimate from demo history. It is not a measured saving and it is not a real service day.

## Approval and what-if

States are `DRAFT`, `REVIEWED`, `APPROVED`, `REJECTED`, and `SUPERSEDED`. Approving a plan supersedes another approved plan for the same date. A second approve of the same plan returns the existing decision. An override on a draft stores the quantity and a reason and appends an event. A new forecast does not rewrite an approved plan.

`POST /api/v1/admin/planning/simulate` can raise demand by a factor between 0.5 and 2, shorten the window, or treat a station as unavailable. The response is labelled as an estimate and is not stored. The handler checks that the saleable-stock total is unchanged.
