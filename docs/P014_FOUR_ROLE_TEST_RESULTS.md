# P014 four-role results

These checks ran against the native API on 127.0.0.1:8010 and the WebSocket proxy on 127.0.0.1:3010, with Supabase as the database. Disposable accounts were disabled afterward. The acceptance order was not deleted.

| Check | Result |
| --- | --- |
| Student, kitchen, cashier, and manager password login | 200 |
| Menu and categories | 200, 8 items |
| Stored food images | 0 rows. The sampled item image route returned 404 |
| Place order, first response | 500 after the row had already committed |
| Idempotent retry of that order | returned the saved order |
| Other student reading that order | 404 |
| Kitchen accept | QUEUED |
| Preparation delay, start, and complete | 200 |
| Mark packed and ready | READY |
| Authenticated WebSocket through the proxy | HTTP 101 |
| Socket events | `connected`, `order.accepted`, `task.delayed` |
| Unauthenticated WebSocket | 403 |
| Wrong manual code | 404 `PICKUP_INVALID` |
| QR verify | allowed cash confirmation |
| Cash confirmation | PAID |
| Same cash key again | replayed |
| Different cash key after payment | 409 `ALREADY_PAID` |
| Pickup | PICKED_UP |
| Second pickup | 409 `PICKUP_USED` |
| Manager kitchen overview | 200 in 3.4 seconds after the station query fix |
| Manager cash summary | 200 |
| Real forecast training | worker task succeeded in 5.5 seconds, job `SUCCEEDED` |
| Logout | 200, then orders returned 401 |

The manager overview previously waited about 90 seconds because it issued several queries for each of 212 stations. `station_workload` now aggregates those counts in a few queries.

Playwright was not rerun. Its fixtures bootstrap users through Docker PostgreSQL and refuse the live database. Cart and confirmation animations were not exercised in a browser session. The landing scene and student sign-in form were opened in a browser on the native site.
