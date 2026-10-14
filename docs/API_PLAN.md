# API plan

The HTTP API is versioned under `/api/v1`. P001 implements two routes. Every other route in this document is a plan. A planned route must not be stubbed to return success.

Interactive OpenAPI is available at `/docs` when `ENVIRONMENT` is not `production`.

## Error envelope

Handled failures use:

```json
{
  "error": {
    "code": "HTTP_ERROR",
    "message": "Not Found",
    "details": {}
  }
}
```

Validation failures use `422` and `VALIDATION_ERROR`. Unexpected failures use `500` and `INTERNAL_ERROR` with no traceback. Domain conflicts, including an illegal order transition or a stale `version`, will use `409`. Missing authorization will use `401` when there is no session and `403` when the session is not allowed to perform the action.

## Implemented

### `GET /api/v1/health`

Liveness. Does not contact PostgreSQL or Redis.

```json
{
  "status": "ok",
  "service": "bowlbyte-api",
  "environment": "development"
}
```

### `GET /api/v1/ready`

Readiness. Executes `SELECT 1` and Redis `PING`.

HTTP 200:

```json
{
  "status": "ready",
  "checks": {
    "postgres": { "status": "up", "detail": null },
    "redis": { "status": "up", "detail": null }
  }
}
```

HTTP 503 uses `"status": "not_ready"` and `"status": "down"` on the failed check. `detail` is the exception class name, not the driver message.

## Planned

These routes arrive with the phase that enforces their rules. Money fields are integers in paise.

### Identity

| Method | Path | Actor | Behavior |
| --- | --- | --- | --- |
| POST | `/api/v1/auth/register` | Anonymous | Create a student. Send a real verification email. Do not return a session that can order |
| POST | `/api/v1/auth/verify-email` | Anonymous | Consume a hashed token |
| POST | `/api/v1/auth/login` | Anonymous | Start a session |
| POST | `/api/v1/auth/logout` | Any session | Revoke the session |
| POST | `/api/v1/staff` | Manager | Provision kitchen, cashier, or manager access for this canteen |
| POST | `/api/v1/staff/{assignment_id}/disable` | Manager | Disable that assignment |

There is no public staff registration route.

### Menu and stations

| Method | Path | Actor |
| --- | --- | --- |
| GET | `/api/v1/menu` | Verified student, staff |
| POST | `/api/v1/menu-items` | Manager |
| PATCH | `/api/v1/menu-items/{item_id}` | Manager |
| GET | `/api/v1/stations` | Kitchen, manager |
| PUT | `/api/v1/stations/{station_id}` | Manager |

`price_paise` is an integer.

### Orders

| Method | Path | Actor | Notes |
| --- | --- | --- | --- |
| POST | `/api/v1/orders` | Verified student | Creates PLACED and a PENDING cash payment |
| GET | `/api/v1/orders` | Student | Own orders only |
| GET | `/api/v1/kitchen/orders` | Kitchen, manager | Canteen queue |
| POST | `/api/v1/orders/{order_id}/transitions` | Role depends on the target state | Body carries the target state, expected version, and reason when required |
| POST | `/api/v1/orders/{order_id}/unclaimed` | Cashier, manager | READY to UNCLAIMED after the hold window |

The transition route is the only fulfillment writer. It refuses a target the state machine does not allow, including `PICKED_UP` while payment is not `PAID`.

### Cash and pickup

| Method | Path | Actor | Notes |
| --- | --- | --- | --- |
| POST | `/api/v1/orders/{order_id}/payments/cash` | Cashier, manager | PENDING to PAID after the amount matches |
| POST | `/api/v1/orders/{order_id}/payments/void` | Manager | PAID to VOIDED with a reason |
| POST | `/api/v1/orders/{order_id}/pickup` | Cashier, manager | READY and PAID, then PICKED_UP |

There will be no `/checkout`, `/razorpay`, `/stripe`, `/upi`, or payment-intent route.

The student order resource can show payment status. It does not accept a payment status in the request body.

### Notifications and realtime

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/notifications` | In-app list for the current user |
| POST | `/api/v1/push-subscriptions` | Store a real browser push subscription |
| DELETE | `/api/v1/push-subscriptions/{id}` | Remove it |
| WebSocket | `/api/v1/ws` | Later live queue updates |

A notification row is `SENT` only after the push send or the in-app write succeeds. A worker exception stores `FAILED` and leaves the order alone.

### Analytics

| Method | Path | Actor |
| --- | --- | --- |
| GET | `/api/v1/analytics/summary` | Manager |

The summary counts orders and payments from PostgreSQL. It does not invent forecast demand. Forecasting, when it exists, will be a separate resource that names the model and the evaluation, and it will not be served by this summary.

## Worker tasks

| Task | P001 | Later |
| --- | --- | --- |
| `bowlbyte.worker_ping` | Implemented. Returns `ok`. No side effects | Remains an infrastructure probe |
| Notification delivery | Not registered | Sends Web Push and records the attempt |
| Unclaimed sweep | Not registered | Finds READY orders past the hold window and records candidates for staff. It does not mark PICKED_UP |
| ETA refresh | Not registered | Recomputes preparation estimates from workload, capacity, and prep minutes |

## Compatibility

Breaking changes to an implemented contract require `/api/v2` or an explicit, reviewed change while the pilot still has a single client. P001's health and readiness shapes are that contract.
