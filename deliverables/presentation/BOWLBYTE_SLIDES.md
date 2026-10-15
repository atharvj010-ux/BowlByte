# BowlByte slides

Fifteen slides. The editable deck is `BOWLBYTE_SLIDES.pptx`. A slide PDF was **NOT GENERATED**.

Paste each slide into the college template when the template is available. Team names are placeholders.

## 1. Title

BowlByte — Intelligent Canteen Automation, Smart Queue Management and Food Waste Reduction Platform

Team: [names not in the repository]

Guide: [not in the repository]

College: [not confirmed in the repository]

## 2. Problem

Students cannot see kitchen progress. The last portion can be promised twice. Cash corrections need an audit. Waste is easy to forget and easy to invent.

## 3. Objectives

Order ahead. Prepare at stations. Pay cash at the counter. Record production and waste. Suggest quantities without changing stock by themselves.

## 4. Existing versus proposed

Paper tickets have no lock and no receipt log. BowlByte stores the order, the reservation, and the receipt in PostgreSQL and checks the role on the server.

## 5. Architecture

Browser → Next.js → FastAPI → PostgreSQL. Redis for limits and live hints. Celery for push and training. One web process and one API process.

## 6. Student experience

Menu, cart, cash-pending order, live status, QR when the order is ready. Screens for the demo are the running site on port 3010. Public landing captures are in `deliverables/report/screenshots/` when that folder exists after the P008 capture.

## 7. Kitchen and ETA

One task per portion. Capacity and ticket order. The time shown is an estimate computed with the kitchen update.

## 8. Cash and QR

Cashier records the amount. Receipts are insert-only. The QR expires on its own and works once. Pickup needs ready and paid.

## 9. Notifications

In-app notification is in the ready transaction. Push is a later delivery. A push-service acceptance is not a phone display. Phones were not tested.

## 10. Food intelligence

Batches, waste reasons, demo demand kept apart from real orders, and a plan the manager must approve.

## 11. Forecast evaluation

Seeded series only. Seasonal naive validation MAE 2.143. HistGradientBoosting 3.000. Baseline kept. No waste reduction number.

## 12. Testing and security

Automated browser and database tests cover the order path, cash races, and QR reuse. Production startup rejects development secrets. Five high npm findings are in ESLint's development tree.

## 13. Demo flow

Sign in, order, accept, cook, ready, notify, pay, scan, pick up, show the manager receipt, show the forecast with the synthetic label.

## 14. Limitations

No public site. No phone proof. Roster still required for roll numbers. No automatic till close. Local performance is one laptop.

## 15. Conclusion

The system is ready to demonstrate locally. A supervised pilot needs a roster and an operator. It is not ready for the public internet.
