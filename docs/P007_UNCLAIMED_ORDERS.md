# P007 unclaimed orders

`UNCLAIMED` is an order status that was already allowed by `ck_orders_status`. It is not a new payment state and not a waste record.

## Policy

- Default hold: 30 minutes after READY, stored on the canteen as `pickup_hold_minutes` (5–180).
- QR credentials keep their own lifetime (`PICKUP_CREDENTIAL_TTL_SECONDS`, default 600). Expiring a QR does not expire the order.
- A warning is queued when the hold is inside the lead window (default 10 minutes) and the order is still READY.
- Celery Beat runs `bowlbyte.sweep_pickup_holds` every `UNCLAIMED_BEAT_SECONDS` (default 60). The sweep locks due orders. A repeat run does not mark them again. A row that is already `PICKED_UP` is left alone.

## What the sweep does not do

No cash reversal, no refund, no waste row, no stock restoration, no automatic `PICKED_UP`, and no statement that the food is safe or unsafe. `ready_at` and the payment row stay. Prepared food stays consumed inventory. Food safety is a counter decision.

## Manager actions

- Extend: status returns to READY, a new `pickup_hold_until` is set, an `EXTENDED` event is stored. The old QR still fails because pickup requires READY at redemption time and a stale token fails its own expiry or revocation. The student needs a new credential.
- Review: an audited note. Status stays `UNCLAIMED`. No waste and no refund.

Cashiers see these orders under "Pickup hold ended". Students see a message that the hold ended and that this is not a refund. Kitchen staff see the same orders on the queue.

## Concurrency

Pickup and the sweep both lock the order row. If pickup commits `PICKED_UP` first, the sweep sees that status and skips it. If the sweep commits `UNCLAIMED` first, pickup and new cash confirmation return `PICKUP_HOLD_EXPIRED`. Payment that committed while the order was still READY is kept.

The deadline comparison uses `timestamptz`, so a hold that crosses midnight is a timestamp comparison, not a date comparison.

`tests/test_p007_integration.py` marks a READY order past its hold, checks that stock and payment are unchanged, rejects a new QR, and checks that a second sweep is a no-op and that extend returns READY.
