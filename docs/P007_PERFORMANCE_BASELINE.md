# P007 performance baseline

Machine: 12th Gen Intel Core i7-12650H, Windows, local virtualenv, PostgreSQL 16 on 127.0.0.1:5433 database `bowlbyte_test`. Single process through the FastAPI test client. Not a production capacity measurement.

Command: `python scripts/bench_queue.py` with `BENCH_COUNTS=10,50,100`. Each count is sequential place-and-accept. The 50 run starts after the 10, and the 100 run starts after those, so the queue is cumulative. Errors were 0 in every run.

| Batch | Before (row lock, full DONE scan) | Advisory-lock experiment | After (row lock kept, DONE scan bounded) |
| --- | --- | --- | --- |
| 10 | 2.767 s (276.7 ms each) | 5.267 s | 4.774 s |
| 50 | 12.917 s (258.3 ms each) | 22.598 s | 23.088 s |
| 100 | 28.239 s (282.4 ms each) | 24.197 s | 26.758 s |

The earlier note of about 25–26 seconds for 100 place-and-accept matches this before measurement (28.2 s on this run).

The advisory lock was slower on the 10 and 50 batches, so it was removed. The 10 and 50 times also moved after the DONE-scan change. Those batches are short and the machine was under other load between runs, so the difference is not a claimed speedup or regression of the kitchen algorithm. The 100-order figure stayed in the same band (28.2 s before, 26.8 s after).

What the code inspection showed: `_refresh` loaded every historical `DONE` task for the canteen. The kept change loads `DONE` tasks only for orders still `QUEUED` or `PREPARING`. A fresh benchmark has no old DONE rows, so it cannot show that saving.
