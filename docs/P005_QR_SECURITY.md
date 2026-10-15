# P005 pickup credential security

A student proves ownership of a READY order at the counter with a short-lived QR code. A 12 character manual code covers a broken camera.

## What the credential is

- QR content: `bbp1.` plus 32 random bytes, URL-safe base64. 256 bits from `secrets`.
- Manual code: 12 characters from a Crockford-style alphabet, shown as `XXXX-XXXX-XXXX`. Input is normalised (case, dashes, and `O`, `I`, `L`, `U` look-alikes).
- The QR holds nothing else. No order id, ticket, student, price or URL.
- Both values are stored only as HMAC-SHA256 with a server key (`PICKUP_HASH_KEY`). The raw values exist in the issuing response and in the student's page memory. They are never written to storage, URLs, logs or the database.
- Lifetime: 600 seconds (`PICKUP_CREDENTIAL_TTL_SECONDS`).
- One active credential per order, enforced by a partial unique index. Issuing a new one revokes the old one.

## Lifecycle

1. The order is `READY`. The student opens the order page and presses "Show pickup QR". Only the owner can issue. Another student gets `404`.
2. The cashier scans or types it. `POST /api/v1/cashier/pickup/verify` is read-only. It returns the order and two flags (`can_confirm_cash`, `can_complete_pickup`). It changes nothing.
3. If payment is pending, the cashier records cash (see `P005_CASH_PAYMENT.md`).
4. `POST /api/v1/cashier/orders/{id}/complete-pickup` redeems the credential and sets `PICKED_UP` in one transaction.

## Redemption

Lock order: order, payment, credential. The transaction checks:

- order is `READY` and in the cashier's canteen
- payment is `PAID`
- credential matches the order, is not revoked, not expired, not redeemed

Then it sets `redeemed_at`, `redeemed_by` and the idempotency key, moves the order to `PICKED_UP` with `picked_up_at` and `picked_up_by`, and appends a `pickup_events` row and an audit row.

A credential can never be redeemed twice. A second attempt with a different key is refused. A retry of the same request with the same key (a lost response) returns the first result and changes nothing. Two cashiers redeeming at the same moment give one success and one refusal. Both properties are tested on PostgreSQL.

## Refusals look the same

Unknown, expired-and-unknown, cross-canteen and garbage credentials all return one identical `404` message. An attacker learns nothing about which part failed. Specific messages (expired, already used, payment pending) are only given for a credential that matches an order in the cashier's own canteen.

## Throttling

| Control | Limit |
| --- | --- |
| Credential issue, per student | 6 per 10 minutes, counted in PostgreSQL |
| Failed lookups, per cashier | 10 per 15 minutes (Redis) |
| Failed lookups, per ticket | 5 per 15 minutes (Redis) |

Throttling is applied before any lock is taken. If Redis is unavailable the failure counters report "try again" rather than skipping the check.

## Other controls

- CSRF on every state-changing route. Role and canteen are checked on the server.
- Responses carrying a credential are `Cache-Control: no-store`.
- The camera scanner (`@zxing/browser`) runs only on a secure context after the cashier presses Start. The scanned text is sent to the API and is not stored.
- Redemption is never triggered by a scan. A scan fills the verify step. The cashier presses a button to hand over.
- Logs contain order id, actor id and outcome. No token, code or hash.

## Residual risk

- Someone who photographs a student's screen within the 10 minute window could present it. The cashier still sees the ticket number and the student can ask for a new code. The code is single-use, so the true owner would find it already redeemed.
- The HMAC key is a single server secret. Rotating `PICKUP_HASH_KEY` invalidates outstanding credentials, which is acceptable for 10 minute codes.
