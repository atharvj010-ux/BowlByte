# Cash payment flow

BowlByte takes cash at the counter. There is no online payment.

The repository must not add Razorpay, Stripe, a UPI gateway, a payment-link API, or a checkout SDK. A client must not be told that a payment succeeded unless a cashier or manager committed a `PAID` row after checking the cash.

P005 implements this flow with the changes listed below. The detailed, current description is `P005_CASH_PAYMENT.md`. Where this document and that one disagree, the P005 document describes what the code does.

## What P005 changed from this design

- Cash can be recorded only when the order is `READY`, not earlier.
- Only a cashier of the canteen records cash. Managers do not.
- Every confirmation inserts a numbered, append-only `cash_receipts` row (`CR-000123`). Retries use an idempotency key.
- A correction does not set `VOIDED`. A manager appends a `cash_reversals` row, the payment returns to `PENDING`, and the order can be paid again as a new attempt. `VOIDED` is not used.
- A reversal is allowed only while the order is `READY` and `PAID`. After pickup it is refused.
- Pickup also needs a one-time credential (QR or manual code).

## States

| Payment status | Meaning |
| --- | --- |
| PENDING | No cash has been recorded. This is the status created with the order |
| PAID | An authorized cashier or manager confirmed that the correct cash amount was collected |
| VOIDED | A manager reversed a recorded payment. The original PAID event remains in the audit trail |

`PENDING` and `PAID` are the operating states. `VOIDED` exists only for the controlled correction path. Students never set any of these.

The payment method value is `CASH`. There is no other method in version 1.

## Amounts

Every amount is an integer number of paise.

- `100` paise is ₹1.00
- A price of ₹45.50 is stored as `4550`
- Totals add integers
- Percentages, when a later phase needs them, are calculated in integers and rounded with an explicit rule at the boundary
- `float` and database `numeric` floating approximations are not used for stored money
- The API accepts and returns paise as integers, not rupee strings and not JSON floats

Presentation code may format paise for display. The formatted string is not written back as the source of truth.

## Who can change a payment

| Action | Student | Kitchen | Cashier | Manager |
| --- | --- | --- | --- | --- |
| Create PENDING with the order | Indirectly, by placing the order | No | No | No |
| Set PAID | No | No | Yes | Yes |
| Set VOIDED | No | No | No | Yes |

The cashier verifies the physical notes and coins against the order total before `PAID` is stored. The software records who confirmed it and when. It cannot see the cash drawer.

## Relationship to the kitchen

Fulfillment may move through `ACCEPTED`, `QUEUED`, `PREPARING`, and `READY` while the payment is `PENDING`.

`READY` plus `PENDING` is a normal lunch-rush state: the food is cooked and the student still needs to pay at the counter.

That combination cannot become `PICKED_UP`.

Recording `PAID` does not change fulfillment to `PICKED_UP`. The student might pay and step aside while the kitchen finishes. Pickup is a second action.

## Cash receipt

Cash receipt is one transaction:

1. Authenticate the cashier or manager and confirm their assignment to the order's canteen.
2. Lock the payment row and the order row.
3. Reject the write unless the payment is `PENDING`, the method is `CASH`, and the order is not `REJECTED`, `CANCELLED`, or `UNCLAIMED`.
4. Compare the submitted amount, in paise, with the order total. A mismatch is rejected. The cashier does not override the total inside the receipt call.
5. Set status to `PAID`, store the actor, and insert a payment event.
6. Insert the audit row in the same transaction.
7. Commit.

The receipt transaction does not set fulfillment to `PICKED_UP` and does not mark a notification delivered.

## Pickup confirmation

Pickup is a different transaction, defined with the QR rules in `DATABASE_DESIGN.md` and the `READY -> PICKED_UP` guard in `ORDER_STATE_MACHINE.md`.

1. Lock the order and the payment.
2. Require fulfillment `READY`.
3. Require payment `PAID`.
4. Require a cashier or manager assigned to that canteen.
5. Consume the pickup token when QR pickup exists.
6. Set fulfillment to `PICKED_UP` and append the fulfillment event and audit row.
7. Commit.

Doing step 5 and step 6 without step 3 is a defect. The check and the update stay in one transaction so a concurrent void cannot slip between them.

## Void and correction

A void is for mistakes: the wrong order was marked paid, or cash recorded as received was returned because the order was unclaimed or cancelled after payment.

1. Only a manager assigned to the canteen may void.
2. A reason is required.
3. The transaction locks the payment row.
4. The current status must be `PAID`.
5. Status becomes `VOIDED`. The PAID event is not updated or deleted.
6. A payment event and an audit row record the manager, the reason, and the time.
7. If fulfillment is already `PICKED_UP`, the void does not rewrite history into `READY`. The food left the counter. The mismatch stays visible for the manager's report.

A void does not create a gateway refund. Any cash handed back happens at the drawer and is represented only by this audited status change.

Students cannot void, and cashiers cannot void.

## What the student can see

The student can see `PENDING`, `PAID`, or `VOIDED` for their own order. They cannot post a new status. A student calling a payment route receives `403` once those routes exist.

## Independence

| Concern | Storage | Effect of failure |
| --- | --- | --- |
| Fulfillment | Order status and order events | Does not change payment |
| Payment | Payment status and payment events | Does not mark the order collected |
| Notification | Notification attempt status | Does not change fulfillment or payment |

A retry of a notification cannot be used as proof of payment.
