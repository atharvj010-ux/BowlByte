# Order state machine

Fulfillment status and payment status are different fields. This document defines fulfillment. Cash rules are in `CASH_PAYMENT_FLOW.md`. Notification delivery has its own status and never moves an order.

P003 executes the student path into `PLACED` and from `PLACED` to `CANCELLED`. It does not execute acceptance, preparation, ready, pickup, rejection, or unclaimed transitions.

## Primary path

```text
PLACED -> ACCEPTED -> QUEUED -> PREPARING -> READY -> PICKED_UP
```

| From | To | Who may do it | Rule |
| --- | --- | --- | --- |
| — | PLACED | Verified student | The order, its items, a PENDING cash payment, and the PLACED event are written in one transaction |
| PLACED | ACCEPTED | Kitchen staff or manager of the canteen | The kitchen has accepted the ticket |
| ACCEPTED | QUEUED | Kitchen staff, manager, or the queue service | The order is waiting on station capacity |
| QUEUED | PREPARING | Kitchen staff or manager | A station has started it |
| PREPARING | READY | Kitchen staff or manager | Preparation is finished and the order is at the counter |
| READY | PICKED_UP | Cashier or manager | Allowed only when payment status is PAID. This is not the cash-receipt action |

`PICKED_UP` is terminal.

An order may sit in `ACCEPTED`, `QUEUED`, `PREPARING`, or `READY` while payment is still `PENDING`. Kitchen staff do not wait for cash before they cook. Cashiers do not treat a READY ticket as collected.

## Rejection

Rejection is allowed only before the order enters the queue.

| From | To | Who | Rule |
| --- | --- | --- | --- |
| PLACED | REJECTED | Kitchen staff or manager | A reason is required |
| ACCEPTED | REJECTED | Kitchen staff or manager | A reason is required |

`REJECTED` is terminal. The payment stays `PENDING` because cash was not collected. A student cannot reject an order.

`QUEUED`, `PREPARING`, `READY`, and `PICKED_UP` cannot transition to `REJECTED`. After queueing, the cancellation rules apply instead.

## Cancellation

| From | To | Who | Rule |
| --- | --- | --- | --- |
| PLACED | CANCELLED | Owning student, or manager | Allowed before the kitchen accepts |
| ACCEPTED | CANCELLED | Kitchen staff or manager | The student may request it. Staff confirm it |
| QUEUED | CANCELLED | Kitchen staff or manager | A reason is required |
| PREPARING | CANCELLED | Manager only | A reason is required and the row records that food may already have been committed |

Students cannot cancel once the order is `QUEUED`, `PREPARING`, or `READY`.

`READY` is not cancelled by a student or by a cashier. If nobody collects it, the unclaimed path is used.

`CANCELLED` is terminal. Cancelling does not set payment to `PAID`. If a manager must reverse a payment that was already recorded, that is the void flow, not a fulfillment edit.

## Unclaimed orders

| From | To | Who | Rule |
| --- | --- | --- | --- |
| READY | UNCLAIMED | Cashier or manager | Allowed only after the canteen hold window has elapsed |

`UNCLAIMED` is terminal for fulfillment. It is not `PICKED_UP` and it is not a silent delete.

- If payment is `PENDING`, it remains `PENDING`. Nobody records a sale that did not happen.
- If payment is `PAID`, the payment row stays `PAID` until a manager records an audited void. Returning cash is a physical drawer action plus that void. The software does not call a payment gateway.
- The disposition of the food is recorded on the unclaimed event so waste can be counted later. P001 does not calculate waste.

The hold window is canteen configuration. It is not hard-coded as a universal number in application code scattered across handlers. One setting, read inside the transition, decides whether the unclaimed transition is legal.

## Illegal transitions

Any transition not listed above is rejected. Examples:

- `PLACED` directly to `READY` or `PICKED_UP`
- `PREPARING` back to `PLACED`
- `PICKED_UP`, `REJECTED`, `CANCELLED`, or `UNCLAIMED` to any other fulfillment status
- `READY` to `PICKED_UP` while payment is `PENDING` or `VOIDED`
- A student, or an anonymous caller, moving kitchen status
- A kitchen account recording payment or pickup

The service loads the current fulfillment status and payment status under a row lock, compares them with the expected version, and writes the new status plus a status event. A stale client receives a conflict and must reload. The handler does not catch that conflict and retry the write with the newer state.

## Status events

Every successful transition appends an event:

- order id
- from status
- to status
- actor user id
- reason, when required
- timestamp

Events are insert-only. The current status on the order row is a projection of the latest accepted transition, updated in the same transaction as the event insert.

## ETA, later

Once orders exist, the initial ETA uses current queue depth, station capacity, and the preparation minutes stored on each item. It does not use a forecast. Forecasts stay out of the ETA until a later phase has a model and an evaluation.
