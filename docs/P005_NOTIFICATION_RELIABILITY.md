# P005 notification reliability

What can go wrong with a "your order is ready" message, and what BowlByte does about it.

## Guarantees

- The in-app notification is written in the same transaction as `READY`. If the order is `READY`, the record exists. Nothing is lost if Redis, Celery or a push service is down.
- At most one `ORDER_READY` notification and one outbox event exist per order version.
- A push failure never reverses `READY`, never changes payment and never blocks the kitchen request. The kitchen request does not wait for any network call.
- No UI or API text says a notification was displayed. The strongest state is `ACCEPTED`, meaning the push service took the message.

## Failure table

| Failure | Behaviour |
| --- | --- |
| Redis down when READY is committed | Kick is skipped. Beat drains within 15 seconds once Redis returns |
| Worker crashes mid-send | Claim lease (`PUSH_CLAIM_SECONDS`, 90) expires and another worker retries. The device may get a duplicate, never a lost message |
| Two workers at once | `FOR UPDATE SKIP LOCKED` plus a unique `(event, device)` row. One sends |
| Push service `5xx`, `429`, timeout | Retry with backoff 30s, 60s, 120s, 240s, up to 5 attempts, honouring `Retry-After` |
| Push service `404` or `410` | Subscription disabled (`GONE`). No retry |
| Push service `400`, `401`, `403`, `413` | `REJECTED`. No retry |
| Order collected before the send | Event marked `STALE`, no push |
| Event older than 30 minutes | `EXPIRED`, no push |
| Student has no device | `NO_SUBSCRIPTION`. The in-app record remains |
| Device now belongs to another account | `SKIPPED` (`recipient_changed`) |
| Student offline or WebSocket down | The order page polls every 4 seconds. A reload always shows the stored status and history |

## What a student can rely on

The order page and the notification list. Push is a convenience on top.

## Observability

`GET /api/v1/admin/push/metrics` (manager) returns delivery counts by status, the number of pending events, average and maximum send latency in milliseconds and the average attempt count. It contains no endpoints or keys.

## Not covered

- Real phone delivery, lock-screen behaviour and tap routing: **not tested** (see `P005_REAL_DEVICE_TESTING.md`).
- Duplicate display is possible after a worker crash between a send and its record. Each ready notification carries a per-order tag (`order-{id}`) so a phone replaces a repeat instead of stacking it.
- No dead-letter alerting. A manager has to look at the metrics.
