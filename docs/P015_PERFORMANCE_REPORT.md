# P015 performance

Measured on the running native process, 18 October 2026:

| Request | Time |
| --- | --- |
| `GET /api/v1/health` | 0.003s |
| `GET /api/v1/ready` (Supabase and Redis) | 0.52s |
| `GET /` | 0.14s |
| `GET /student/login` | 0.19s |

The manager overview was 3.4s in P014 after the station aggregation change and was not timed again. No Lighthouse score was collected. Redis and Beat were still draining the outbox on the live worker before this phase's API reload. The worker process was not restarted.
