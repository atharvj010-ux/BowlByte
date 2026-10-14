# P004 kitchen engine

Kitchen staff use `/staff`. The desk shows incoming `PLACED` orders, waiting tickets, tickets in preparation, ready tickets, and station workload. Workload counts come from `preparation_tasks` and `kitchen_stations`: waiting, in progress, capacity, estimated backlog, and the longest-waiting ticket number.

Actions:

- Accept creates one task per unit and queues the order.
- Reject requires a reason and is refused after a task has started.
- Start, complete, and delay act on one task.
- Confirm packed and ready is shown only when every task is `DONE`.

Station backlog seconds are `sum(queued durations) / capacity`. That figure is an estimate. The manager page at `/admin/kitchen` says so. Average preparation and queue wait are null until a task has both `started_at` and `completed_at`. They are not shown as zero. Cash collected is not on this page.

A new-ticket tone plays only after a staff member chooses "Enable new-ticket sound", which is the browser gesture that allows audio. Mute turns it off. The tone is not required for the queue to work.

## Recovery

API or worker restarts do not change task rows. The next staff action or station edit recalculates estimates from those rows. An overdue in-progress task stays in progress and is visible as running long. Nothing marks food complete because a process restarted or a timer elapsed.

There is no separate operational "force complete" control. Staff complete the physical task, or they leave it in progress.

## Pilot bounds

- At most 40 preparation tasks per order.
- Delay additions are 30 to 3600 seconds, with a reason.
- Queue and task lists are limited (50 orders, 200 tasks).
- Local timing covered 100 sequential accept calls. That is not a production capacity claim.
