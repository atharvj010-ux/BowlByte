# P008 pilot runbook

This is the operating procedure for a supervised counter. It is not a public launch plan.

## Before service

1. Confirm `GET /api/v1/ready` reports Postgres and Redis up.
2. Confirm the Celery worker and Beat containers are running.
3. Set `COLLEGE_ELIGIBILITY_MODE=roster` and import the college roster before students register, if roll numbers must be owned. Institutional email does not prove a roll number.
4. Publish the day's menu and stock in the manager screens.
5. Do not start the isolated staging file against the development database.

## Service flow

Students order in the browser. The kitchen accepts tickets, starts station tasks, and marks the order packed. The student pays cash at the counter. The cashier records the cash and scans a current QR. Pickup requires READY and PAID. The QR is one-time.

## Pickup hold

The default hold is 30 minutes after READY. Beat marks a late order `UNCLAIMED`. That does not refund cash, restore stock, or record waste. A manager extends the hold or writes a review note. The student needs a new QR after an extension. The canteen decides whether the food can still be handed over.

## Manual cash reconciliation

BowlByte does not have a shift-close subsystem. Use the manager cash summary.

1. At shift start, count the float and write it in the paper log. The software does not store the float.
2. During the shift, record cash only through the cashier desk. Do not edit receipt rows. Corrections are manager reversals.
3. At shift end, open the manager cash view for today's window. The screen states that recorded cash is confirmed receipts minus reversals since 00:00 UTC.
4. Write down confirmed receipts, reversals, and the displayed net.
5. Count the physical cash. Expected net is the software net plus the opening float, minus any cash removed for change or paid-in notes written on the paper log.
6. Write the difference. A non-zero difference is a manager sign-off, not an automatic adjustment.
7. Keep the paper log with the manager's name and time. Do not photograph student receipts into the git repository.

## If a worker stops

Orders, payments, and the notification outbox remain in PostgreSQL. Restart the worker. Do not mark orders picked up by hand in the database.

## If forecasting fails

Ordering continues. A failed training job stays on the job row. Plans do not change stock or payments.

## Backup

See `docs/P008_HANDOVER.md` and `docs/P007_FAILURE_RECOVERY.md`. Keep dumps off shared drives. The development database was not wiped in P008.
