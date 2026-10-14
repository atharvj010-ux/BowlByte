# BowlByte project specification

BowlByte is a college canteen platform for counter pickup. Students will browse a menu and place orders. Kitchen staff will move those orders through preparation. Cashiers will confirm cash and hand the order over. Managers will run the menu, staff, stock, stations, and reports.

This document is the product contract for the pilot. Phase P001 builds the repository, application shells, API foundation, and runtime. It does not implement ordering, accounts, cash recording, QR pickup, notifications, or forecasting.

## Pilot boundary

Version 1 serves one canteen. Data that belongs to a canteen carries a canteen identifier so a later release can add another canteen without rewriting the order, payment, or staff rules.

There is no delivery. A completed order is collected at the counter.

## People

| Role | How the account is created | What they do |
| --- | --- | --- |
| Student | Self-registration, then email verification | Browse the menu, place an order, watch preparation, receive notifications, collect at the counter |
| Kitchen staff | Provisioned by a canteen manager | Accept work and move preparation status through to READY |
| Cashier | Provisioned by a canteen manager | Confirm the cash received and confirm handover |
| Canteen manager | Provisioned by an authorized administrator, including the first bootstrap manager | Menu, staff, stock, stations, corrections, and analytics |

Staff and manager accounts are never created through the student registration form.

## Ordering

An order is for counter pickup at the pilot canteen. Preparation may start while cash is still unpaid. Collection is a separate step and is allowed only after cash has been recorded as paid.

The fulfillment lifecycle is:

`PLACED -> ACCEPTED -> QUEUED -> PREPARING -> READY -> PICKED_UP`

Controlled rejection, cancellation, and unclaimed paths are defined in `ORDER_STATE_MACHINE.md`. Those paths are part of the contract even though the transitions are not implemented in P001.

Estimated preparation time will be calculated from kitchen workload, station capacity, and each item's preparation time. That calculator is not part of P001. Demand forecasting comes after the queue is real.

## Money

BowlByte accepts cash only.

There is no Razorpay, Stripe, UPI gateway, payment API, or online checkout. A screen must not imitate a successful payment.

Payment status starts as `PENDING`. An authorized cashier or manager records `PAID` only after checking that the correct cash amount was collected. A student cannot change payment status.

Fulfillment status, payment status, and notification delivery status are independent. Marking an order READY does not mark it paid. Marking it paid does not mark it collected. A failed notification does not roll either of those back.

A READY order with PENDING payment cannot become PICKED_UP.

Cash receipt and pickup confirmation are separate audited operations. Corrections and voids are manager-controlled and are appended to an audit trail. They are not silent edits.

All stored money is an integer number of paise. Floating-point money is not allowed in the database, the API, or calculations.

## Notifications

Students will receive in-app updates and PWA Web Push. Push uses VAPID. P001 does not register subscriptions and does not send push messages. The product must not show a notification as delivered unless the delivery attempt actually succeeded.

## What P001 includes

- One Next.js application with public pages and separate student, kitchen, cashier, and manager scaffolds
- A FastAPI service with versioned routing, structured logs, and centralized errors
- PostgreSQL, Redis, and a Celery worker in Docker Compose
- `GET /api/v1/health` and `GET /api/v1/ready`
- Architecture and domain documentation
- Lint, typecheck, and test commands

## What P001 does not include

- Registration, email verification, sessions, or staff provisioning
- Menus, stock, stations, or orders
- Cash recording, receipts, voids, or QR pickup
- Web Push and notification delivery
- ETA calculation and demand forecasting
- A second canteen

Screens that exist for later roles say that authentication and operations are not available. They do not display sample orders, sample payments, or sample forecasts.
