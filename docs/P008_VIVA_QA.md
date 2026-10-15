# P008 viva questions

Short answers are the first sentence. The rest is the detail an examiner can ask for. Team names, guides, and the college name are not in the BowlByte repository, so they are not invented here.

1. **Why Next.js and FastAPI?** The browser is a React application and the API is a typed Python service. Next.js serves the interface and proxies `/api/v1` so the browser stays on one origin. FastAPI validates requests and keeps payment and kitchen rules on the server.

2. **Why PostgreSQL?** Orders, stock, receipts, and the notification outbox need transactions and constraints. A receipt cannot be edited, because a trigger rejects updates and deletes.

3. **Why Redis?** Redis backs rate limits and publishes live hints after a database commit. Losing a Redis message does not change an order. Clients refetch.

4. **Why Celery?** Push delivery and forecast training are slow and must not sit inside the request that marks an order ready. Beat retries the outbox and the pickup-hold sweep. Both read PostgreSQL, so a restart continues the same rows.

5. **How do sessions work?** The password check uses Argon2id. Login inserts a new session row and sets an HttpOnly cookie. Logout and expiry make that row unusable. In production the cookie name is `__Host-bowlbyte_session` and `Secure` is required.

6. **What about CSRF?** Mutating requests must send the CSRF cookie value in a header. A cross-site form does not have that header.

7. **Why cash only?** The canteen collects money at the counter. The order is cash pending until a cashier records the notes. There is no payment provider.

8. **How is stock reserved?** Placement locks the daily stock row and moves quantity from available to reserved. Cancellation moves it back. Acceptance does not sell it twice.

9. **How is overselling prevented?** The stock update is in the same transaction as the order, with a row lock. Two students cannot both take the last portion.

10. **When is stock consumed?** Starting preparation consumes the reserved quantity. Rejecting a still-queued order releases it. An unclaimed ready order does not put food back.

11. **What is the station-aware ETA?** Each portion is a task on a station with a capacity. The scheduler places running tasks first, then queued tasks in ticket order. The result is an estimate stored on the order. It is not a second source of kitchen truth.

12. **How does queue concurrency work?** Kitchen mutations lock the open orders for that canteen before changing capacity. Two staff members cannot both start the last slot. SKIP LOCKED is not used on that queue, because it could skip a ticket.

13. **Why was the lock not replaced?** An advisory lock was slower on the 10- and 50-order laptop batches, so the row lock stayed. The estimate query no longer reads every historical done task.

14. **How do WebSockets work?** After commit, the API publishes a hint. The browser refetches. The kitchen page also refetches every few seconds. Logout does not instantly close a socket that is already open.

15. **How is the QR protected?** The raw token is shown once and stored as a hash. It expires on its own clock, separate from the pickup hold. Redemption is one row update under a lock. A second attempt loses.

16. **What are Web Push limits?** The outbox row means the event is durable. A 2xx from the push service means the service accepted it. It does not mean a phone displayed it. Android and iPhone were not tested.

17. **What is synthetic versus real data?** The forecast table in the report is a seeded series of 60 rows and one item. Real recorded history without enough days stays insufficient. Those scores are not a canteen pilot.

18. **How was the model chosen?** The choice uses validation MAE only. Seasonal naive was 2.143. HistGradientBoosting was 3.000. The baseline stayed. Holdout was not used to choose.

19. **Why did the baseline win?** The series is small and seasonal. A boosted tree did not beat the simple lag on that validation window. A larger real history could change the result. That has not been observed.

20. **How is waste accounted?** A manager records a batch and a waste reason. Produced equals served at the counter plus remaining plus discarded. An unclaimed order does not create a waste row by itself.

21. **What does plan approval do?** It stores the manager's decision. It does not create a batch, change stock, or mark an order paid.

22. **How are roles separated?** Students see their own orders. Cashiers record cash for their canteen. Kitchen staff move preparation. Only a manager reverses cash or approves a plan. The check is on the API, not only on the page.

23. **How does the proxy rate limit work?** The Next.js server strips client `x-bowlbyte-*` headers and sets a client IP only with a shared secret. The API ignores `X-Forwarded-For` unless that secret matches. Locally the label is `0.0.0.0` because the route handler cannot see the TCP peer. Per-email limits still apply.

24. **What is UNCLAIMED?** A ready order past the canteen hold. Payment and stock stay as they were. The old QR fails. A manager can extend the hold, which requires a new QR.

25. **What are the main limitations?** No public HTTPS deployment, no phone push proof, no roster from the college, no shift-close module, and no measured waste reduction.

26. **What is the deployment shape?** Docker Compose for the demo. Staging is a different Compose project with its own volumes and Caddy in front. It was validated and not started.

27. **Where do images and models live?** Menu images are bytes in PostgreSQL. Forecast artifacts are files under the artifact directory, checked by path and SHA-256. Staging mounts that directory on a named volume.

28. **How do you recover the database?** `pg_dump` from the BowlByte Postgres container and `pg_restore` into a new database. P007 restored a dump in about 2.4 seconds and then dropped the disposable database. The live database was not wiped.

29. **What would you do next?** A college hostname and certificate, a real roster, and one observed Android or iPhone notification. Not a new payment method.

30. **What must you not claim?** Do not claim a published paper, a public website, a phone notification, or a reduction in food waste. The evidence does not show those.

31. **How are notifications deduplicated?** The ready event key includes the order id and version. A repeated ready transition does not insert a second row.

32. **Why is the formatter red on one old file?** Migration `0006` was already applied. Formatting it would change a frozen file. Only that path is excluded from the formatter. Asking Ruff to format that file directly still fails.
