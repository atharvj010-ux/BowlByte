# P004 known limitations

- Cash collection, receipts, QR pickup, and `PICKED_UP` are not implemented. Ready orders stay `CASH` / `PENDING`.
- Web Push and demand forecasting are not implemented.
- There is no manager priority override. The queue is FIFO by acceptance time and ticket.
- Orders above 40 preparation tasks cannot be accepted. Split them.
- One station per menu item. There is no multi-stage recipe.
- Waste and write-off after cooking has started are later work. Started orders cannot be rejected here.
- ETA uncertainty is a fixed 20 percent of the remaining estimate, at least 60 seconds. It is not calibrated from history. Overdue running work is projected 60 seconds ahead and kept in progress.
- Redis Pub/Sub can drop messages. Clients recover by refetching PostgreSQL.
- The new-ticket sound is a short tone after the staff member enables it. It is not an operating-system notification.
- Menu photos are still stored as `bytea`.
- The local 10/50/100 accept timing is a single-process development measurement, not a production scale result. On this machine, placing and accepting 10, 50, and 100 orders in one process took 2.22s, 12.66s, and 25.08s. Each kitchen change locks the canteen's active orders, so that time grows with the queue.
- WebSocket UI latency and a forced Redis disconnect were not measured as separate benchmarks. Publish failure is covered by the API continuing when Redis raises, and the browser recovers by polling.
- Institutional enrollment and the shared proxy rate-limit key are unchanged from P002.
- `npm audit` still reports the `braces` advisory through `eslint-config-next@16.4.0`. Forcing the audit fix downgrades that package and breaks this Next.js version. It is not fixed.
- `PICKED_UP`, cashier cash confirmation, and notification delivery remain the P005 and P006 contracts. P004 does not claim them.
