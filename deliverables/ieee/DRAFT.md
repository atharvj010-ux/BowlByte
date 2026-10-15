# BowlByte: a transactional canteen queue with a guarded demand forecast

Optional draft. Not submitted. Not peer reviewed.

## Abstract

BowlByte records college canteen orders as cash-pending rows, reserves stock in the same transaction, and schedules preparation across stations with limited capacity. Pickup uses a one-time QR after a cashier records cash. A demand forecast is trained off the request path and cannot change orders or stock. On a seeded series of 60 rows and one item, a seasonal-naive baseline had a lower validation MAE (2.143) than histogram gradient boosting (3.000) and remained selected. The result is not a measurement of a live canteen, and no reduction in waste is claimed.

## Method

Orders use explicit states, including an unclaimed hold that does not refund cash. Estimates are recomputed inside the kitchen transaction and published after commit. Model selection uses a chronological validation window. The holdout is reported and not used for selection.

## Limitations

No public deployment and no handset notification study. Institutional email does not prove roll-number ownership.
