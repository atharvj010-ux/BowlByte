# P004 realtime architecture

PostgreSQL is the source of truth. Redis Pub/Sub only tells a connected client that something changed.

## Publish

After a kitchen transaction commits, the API publishes one JSON object to `bowlbyte:canteen:{canteen_id}` and `bowlbyte:order:{order_id}`:

```json
{"type": "order.accepted", "resource_id": "<order uuid>", "version": 3, "at": "2026-10-15T00:00:00+00:00"}
```

The payload has no student name, items, or payment detail. If Redis is down, the warning is logged and the database change remains.

## WebSockets

| Path | Who |
| --- | --- |
| `/api/v1/ws/kitchen` | Active kitchen staff for their canteen |
| `/api/v1/ws/orders/{order_id}` | The student who owns that order |

The session cookie authenticates the socket. The session id is not accepted in the query string. `Origin` must be in `CORS_ORIGINS`. A bad origin closes with 1008, a missing session with 4401, and the wrong role or order with 4403. The session is loaded again about every 5 seconds, so logout or deactivation closes the socket.

On connect the server sends `{ "type": "connected" }`. Clients refetch HTTP state. They do not apply the socket payload as the order.

## Browser path

Cookies are for the web origin. The browser opens `ws://<web host>/api/v1/ws/...`. The frontend image runs `ws-proxy.mjs`: Next.js listens on `PORT + 100` at `127.0.0.1`, and the public port forwards ordinary HTTP to Next and upgrades `/api/v1/ws` to `API_INTERNAL_URL`. Next.js rewrites are not used for the upgrade.

Production should terminate TLS and proxy that upgrade to the API with `Upgrade` and `Connection` intact, on `wss://`. The API still checks `Origin`.

## Fallback

If the socket is not open, the page refetches every 4 seconds. Reconnect waits 1 second, then doubles, up to 15 seconds. A failed refetch keeps the last confirmed order on screen and says updates are unavailable. Coming back online refetches the current row. A missed Redis message cannot change the database; the next refetch repairs the screen.

Phone Web Push is not implemented.
