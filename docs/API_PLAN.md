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

Implemented in P003. Prices are integer paise. Unsafe methods keep the existing origin and CSRF checks. No route sets payment to `PAID` or fulfillment to `PICKED_UP`. Kitchen staff can set fulfillment to `READY` after every preparation task is done.

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

## Kitchen queue and tracking

Implemented in P004. Mutations require the kitchen role, the staff member's canteen, and CSRF. Students can read only their own tracking resource. Cashiers cannot call these mutations.

| Method | Path | Actor |
| --- | --- | --- |
| GET | `/api/v1/staff/orders` | Kitchen, `PLACED` tickets |
| GET | `/api/v1/staff/queue` | Kitchen, queued, preparing, and ready tickets plus station workload |
| GET | `/api/v1/staff/stations` | Kitchen, station workload |
| GET | `/api/v1/staff/preparation-tasks` | Kitchen |
| POST | `/api/v1/staff/orders/{id}/accept` | Kitchen |
| POST | `/api/v1/staff/orders/{id}/reject` | Kitchen. Body `{ "reason": "..." }` |
| POST | `/api/v1/staff/preparation-tasks/{id}/start` | Kitchen |
| POST | `/api/v1/staff/preparation-tasks/{id}/complete` | Kitchen |
| POST | `/api/v1/staff/preparation-tasks/{id}/delay` | Kitchen. `extra_seconds` 30–3600 and a reason |
| POST | `/api/v1/staff/orders/{id}/ready` | Kitchen. Body `{ "packed": true }` |
| GET | `/api/v1/orders/{id}/tracking` | Owning student |
| GET | `/api/v1/admin/kitchen/overview` | Manager |
| WebSocket | `/api/v1/ws/kitchen` | Kitchen session cookie, trusted origin |
| WebSocket | `/api/v1/ws/orders/{id}` | Owning student |

Changing a station's capacity or active flag recalculates estimates for that canteen. The response does not include a payment-status field the client can set.

## Cash, pickup, and notifications

Implemented in P005. Every mutation needs a session of the right role and a CSRF token. Money fields are integers in paise. Responses for these paths are `private, no-store`. There is no `/checkout`, `/razorpay`, `/stripe`, `/upi`, or payment-intent route and none will be added.

### Cashier (role `CASHIER`, own canteen)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/cashier/orders` | Board: READY and unpaid, paid and waiting, picked up in the last 24 hours, plus totals |
| GET | `/api/v1/cashier/orders/{id}` | One order |
| GET | `/api/v1/cashier/history` | The cashier's own receipts. `limit`, `offset` |
| POST | `/api/v1/cashier/pickup/verify` | Body `{ "token": "..." }` or `{ "ticket_number": "B12", "code": "ABCD-EFGH-JKMN" }`. Read-only. Returns the order and `can_confirm_cash`, `can_complete_pickup` |
| POST | `/api/v1/cashier/orders/{id}/confirm-cash` | Body `{ "amount_paise": 4000, "idempotency_key": "..." }`. READY only. Returns `receipt`, `order`, `replayed` |
| POST | `/api/v1/cashier/orders/{id}/complete-pickup` | Body `{ "token" \| "code", "idempotency_key" }`. Needs READY, PAID and an unredeemed credential. Returns `order`, `replayed` |

Idempotency keys match `^[A-Za-z0-9_-]{8,80}$`. Error codes include `ORDER_NOT_READY`, `ALREADY_PAID`, `AMOUNT_MISMATCH`, `NOT_FOUND`, `CONFLICT` and `429` on throttling.

### Student

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/v1/orders/{id}/pickup-credential` | Owner, READY order. Returns the token, manual code and expiry once. Revokes any earlier credential |
| GET | `/api/v1/orders/{id}/pickup-status` | State only (`NOT_READY`, `AVAILABLE`, `ACTIVE`, `EXPIRED`, `COLLECTED`). Never returns the secret |

### Manager (role `CANTEEN_MANAGER`)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/admin/cash/summary` | `date_from`, `date_to`. Order value, gross cash, reversals, net cash, awaiting payment and pickup |
| GET | `/api/v1/admin/cash/transactions` | Receipts with cashier and reversal. `limit`, `offset` |
| POST | `/api/v1/admin/cash/{receipt_id}/reverse` | Body `{ "reason", "kind", "confirm": true, "idempotency_key" }`. READY and PAID orders only |
| GET | `/api/v1/admin/push/metrics` | Delivery counts and latency |

### Push and notifications (students)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/push/public-key` | `{ supported, public_key }` |
| GET | `/api/v1/push/subscriptions` | The caller's devices, without endpoints or keys |
| POST | `/api/v1/push/subscriptions` | Body `{ endpoint, keys: { p256dh, auth }, expiration_time, device_label }`. Validated and encrypted |
| DELETE | `/api/v1/push/subscriptions` | Body `{ endpoint }` |
| POST | `/api/v1/push/test` | Queues a test message. 3 per 10 minutes |
| GET | `/api/v1/notifications` | In-app list with `unread_count` |
| GET | `/api/v1/notifications/unread-count` | Count only |
| POST | `/api/v1/notifications/read-all` | |
| POST | `/api/v1/notifications/{id}/read` | |
| WebSocket | `/api/v1/ws/cashier` | Cashier hints for the canteen |
| WebSocket | `/api/v1/ws/notifications` | Hints for the signed-in user |

The student order resource shows payment status, `paid_at` and `picked_up_at`. It does not accept a payment status in a request body. A push row is `ACCEPTED` only when the push service answered 200, 201 or 202. A worker error leaves the order alone.

## Food intelligence

Manager session, canteen scoped, CSRF on writes. Training returns 202 and runs in Celery. A student, cashier, or kitchen account receives 403.

| Method | Path | Notes |
| --- | --- | --- |
| GET, POST | `/api/v1/admin/production` | List and open a batch |
| GET | `/api/v1/admin/production/{id}` | Batch plus correction events |
| POST | `/api/v1/admin/production/{id}/adjust` | Serve, discard, or correct |
| GET | `/api/v1/admin/production/reconciliation` | Batches beside online pickups, not added together |
| GET, POST | `/api/v1/admin/waste` | Recorded discards |
| POST | `/api/v1/admin/closures` | Mark or clear a closed day |
| GET | `/api/v1/admin/intelligence/overview` | Recorded orders, production, discards, cash |
| GET | `/api/v1/admin/intelligence/demand-history` | `source=REAL` or `DEMO`. `export=csv` has no student column |
| GET | `/api/v1/admin/intelligence/waste-history` | Recorded discards only |
| POST | `/api/v1/admin/intelligence/demo-dataset` | Replaces demo rows for that canteen |
| POST | `/api/v1/admin/forecasting/train` | Queues a job. Rate limited |
| GET | `/api/v1/admin/forecasting/jobs/{id}` | Job status |
| GET | `/api/v1/admin/forecasts` | Recent runs |
| POST | `/api/v1/admin/forecasts/generate` | Persists a run |
| GET | `/api/v1/admin/forecasts/{id}` | Values, cutoff, limitations |
| GET | `/api/v1/admin/forecasts/models` | Candidates and evaluations |
| GET | `/api/v1/admin/forecasts/evaluations` | Same scores, with a demo warning |
| POST | `/api/v1/admin/forecasts/models/{id}/activate` | Explicit manager activation |
| POST | `/api/v1/admin/planning/generate` | Draft plan |
| GET | `/api/v1/admin/planning` and `/api/v1/admin/planning/{id}` | History and detail |
| POST | `/api/v1/admin/planning/{id}/approve` and `.../reject` | Intent only |
| POST | `/api/v1/admin/planning/{id}/override` | Draft quantity change with a reason |
| POST | `/api/v1/admin/planning/simulate` | Not stored. Stock is unchanged |

`bowlbyte.train_forecast` is the worker task, with a 90 second soft limit and a 120 second hard limit.

## Planned

| Method | Path | Actor | Notes |
| --- | --- | --- | --- |
| POST | `/api/v1/orders/{order_id}/unclaimed` | Cashier, manager | READY to UNCLAIMED after the hold window |

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
| ETA refresh | Not a Celery task | Recalculated inside the kitchen transaction that changes workload |

## Compatibility

Breaking changes to an implemented contract require `/api/v2` or an explicit, reviewed change while the pilot still has a single client. P001's health and readiness shapes are that contract.
