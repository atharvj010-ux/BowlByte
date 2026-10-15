# P005 cash collection

BowlByte takes cash at the counter and nothing else. P005 adds the cashier side: recording cash, handing the order over, and a manager-only correction. There is no online payment, payment API, or checkout.

## Two separate state machines

| Machine | States | Who moves it |
| --- | --- | --- |
| Preparation (order `status`) | `PLACED`, `ACCEPTED`, `QUEUED`, `PREPARING`, `READY`, `PICKED_UP` | Kitchen to `READY`. Cashier to `PICKED_UP` |
| Payment (`order_payments.status`) | `PENDING`, `PAID` | Cashier to `PAID`. Manager reversal back to `PENDING` |

The kitchen never touches payment. Payment never changes preparation. The one coupling is the pickup guard: `PICKED_UP` needs `READY` and `PAID`.

Web Push, the in-app notification and the outbox never change either state. A push failure never reverses a kitchen transition.

## Rules enforced by the server

- Only a `CASHIER` of the order's own canteen can record cash. Students, kitchen staff and managers get `403`. A cashier of another canteen gets the same `404` as an unknown order.
- Cash can be recorded only when the order is `READY` (`ORDER_NOT_READY`, `409`, otherwise).
- The submitted `amount_paise` must equal the order total (`AMOUNT_MISMATCH`). The cashier cannot override the total.
- A paid order cannot be paid again (`ALREADY_PAID`).
- Amounts are integer paise everywhere.
- Scanning or verifying a pickup code never marks an order `PAID`.
- A cashier can complete pickup only for a `READY` and `PAID` order, with a valid unexpired credential that has not been redeemed.

## Recording cash

`POST /api/v1/cashier/orders/{id}/confirm-cash` with `{ "amount_paise": 4000, "idempotency_key": "..." }`. CSRF is required.

One transaction, lock order: order, then payment, then receipt.

1. Lock the order for the cashier's canteen and its payment row.
2. Check `READY`, `CASH`, `PENDING` and the amount.
3. Take the next number from `cash_receipt_no_seq` and insert a `cash_receipts` row (shown as `CR-000123`).
4. Set the payment to `PAID` with `paid_at` and `paid_by`, bump the order version, append an order event and an audit row.
5. Commit, then publish a live hint.

Retries are safe. The same `idempotency_key` for the same payment returns the stored receipt (`replayed: true`) and creates nothing. A unique constraint on `(payment_id, idempotency_key)` is the backstop. Two cashiers racing on different keys produce one receipt and one `409`.

## Audit trail

`cash_receipts` keeps who confirmed (`cashier_user_id`), when (`received_at`), the amount, the ticket number at the time, the attempt number and the idempotency key. The audit log records `cash.confirmed`. The order event reason is `cash_received:CR-000123`.

`cash_receipts`, `cash_reversals` and `pickup_events` are append-only. A database trigger (`bowlbyte_forbid_ledger_change`) rejects `UPDATE` and `DELETE`, even from application code with a bug. `TRUNCATE` is not blocked, which only matters for test resets.

## Correction before pickup

`POST /api/v1/admin/cash/{receipt_id}/reverse` is manager-only. Body: `reason` (5 to 300 characters), `kind` (`CASH_RETURNED` or `ERRONEOUS_ENTRY`), `confirm: true`, `idempotency_key`.

- Allowed only while the order is `READY` and `PAID`. After `PICKED_UP` it returns `409` with a plain message. Refunds after handover are out of scope.
- The receipt is never edited or deleted. A `cash_reversals` row is appended (unique per receipt).
- The payment returns to `PENDING`, and `paid_at` and `paid_by` are cleared.
- A pickup credential issued earlier is not honoured while the payment is `PENDING`, because completion needs `PAID`.
- Paying again creates a new receipt with `attempt_no` 2 and a new receipt number. Net cash is receipts minus reversals.
- The audit log records `cash.reversed` with the manager.

The earlier design reserved a `VOIDED` payment status. P005 does not use it. A reversal is an appended row and a return to `PENDING`, which keeps the history and the state machine simple.

## Cashier screens

`/cashier` shows two live lists (READY and unpaid, paid and waiting for handover), today's recorded cash net of reversals, a "check a pickup code" panel, and a manual fallback form. The cashier is asked to count the exact amount before the confirm button works. `/cashier/history` lists the signed-in cashier's own receipts.

## Manager view

`/admin/cash` shows order value placed (not cash), gross cash recorded, reversals, net cash, orders awaiting payment, awaiting pickup and picked up, plus a receipts table with the cashier name and a reversal form. It states plainly that this is cash BowlByte was told about, not a till reconciliation. Dates use the canteen day in the stated timezone.

## Student copy

When `READY` and unpaid: "Your order is ready. Pay ₹X in cash at the counter." Paid but not collected: "Cash payment confirmed. Please collect your order." with the time. `PICKED_UP`: "Order collected successfully. Enjoy your meal!"
