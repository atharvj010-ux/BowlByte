# API plan

The HTTP API is versioned under `/api/v1`. Health, readiness, authentication, and staff administration are implemented. Menu, order, payment, and forecast routes in this document are still a plan. A planned route must not be stubbed to return success.

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

## Identity

Implemented in P002. Clients cannot submit a role on student registration. Invitations reject `CANTEEN_MANAGER`. There is no public manager registration route.

| Method | Path | Actor | Behavior |
| --- | --- | --- | --- |
| GET | `/api/v1/auth/registration-policy` | Anonymous | College mode, without secrets |
| POST | `/api/v1/auth/student/register` | Anonymous | Create a student or send a generic follow-up. No session |
| POST | `/api/v1/auth/verify-email` | Anonymous | Consume a hashed token. No session |
| POST | `/api/v1/auth/resend-verification` | Anonymous | Rate-limited, enumeration-safe resend |
| POST | `/api/v1/auth/login` | Anonymous | New server session. Generic failure text |
| POST | `/api/v1/auth/logout` | Session plus CSRF | Delete that session |
| GET | `/api/v1/auth/me` | Session | Current user |
| GET | `/api/v1/auth/csrf` | Session | Confirm or rotate the CSRF token |
| POST | `/api/v1/auth/accept-invitation` | Invitation token | Activate kitchen or cashier. No session |
| POST | `/api/v1/admin/staff/invitations` | Manager plus CSRF | Invite kitchen or cashier for that canteen |
| GET | `/api/v1/admin/staff` | Manager | List kitchen and cashier accounts for that canteen |
| PATCH | `/api/v1/admin/staff/{id}/status` | Manager plus CSRF | Activate or deactivate. Deactivation deletes sessions |
| GET | `/api/v1/student/session` | Student | Role boundary |
| GET | `/api/v1/staff/session` | Kitchen | Role boundary |
| GET | `/api/v1/cashier/session` | Cashier | Role boundary |
| GET | `/api/v1/admin/session` | Manager | Role boundary |

## Menu, stock, and placement

Implemented in P003. Prices are integer paise. Unsafe methods keep the existing origin and CSRF checks. There is no route that sets payment to `PAID` or fulfillment to `READY` or `PICKED_UP`.

| Method | Path | Actor |
| --- | --- | --- |
| GET | `/api/v1/menu/categories` | Signed-in student, kitchen, or manager |
| GET | `/api/v1/menu/items` | Student |
| GET | `/api/v1/menu/items/{id}` | Student |
| GET | `/api/v1/menu/items/{id}/image` | Public for an active item photo |
| POST | `/api/v1/orders` | Student. Body is item ids, quantities, note, and idempotency key |
| GET | `/api/v1/orders` | Student, own orders |
| GET | `/api/v1/orders/{id}` | Owning student. Other students receive 404 |
| POST | `/api/v1/orders/{id}/cancel` | Owning student, only from `PLACED` |
| GET | `/api/v1/staff/orders` | Kitchen staff, `PLACED` tickets for their canteen |
| GET, POST, PATCH | `/api/v1/admin/categories` | Manager |
| GET, POST, PATCH | `/api/v1/admin/stations` | Manager |
| GET, POST, PATCH | `/api/v1/admin/menu` and `/api/v1/admin/menu/{id}` | Manager |
| POST | `/api/v1/admin/menu/{id}/image` | Manager. Validated JPEG, PNG, or WebP bytes |
| GET, PATCH | `/api/v1/admin/stock` and `/api/v1/admin/stock/{item_id}` | Manager |
| GET | `/api/v1/admin/orders` | Manager, own canteen |

## Planned

These routes arrive with the phase that enforces their rules. Money fields are integers in paise.

### Later fulfillment

| Method | Path | Actor | Notes |
| --- | --- | --- | --- |
| POST | `/api/v1/orders/{order_id}/transitions` | Role depends on the target state | Not implemented. P004 will carry the target state, expected version, and reason |
| POST | `/api/v1/orders/{order_id}/unclaimed` | Cashier, manager | READY to UNCLAIMED after the hold window |

The transition route will be the fulfillment writer. It must refuse a target the state machine does not allow, including `PICKED_UP` while payment is not `PAID`.

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
