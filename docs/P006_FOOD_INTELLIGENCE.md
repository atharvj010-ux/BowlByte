# P006 food intelligence

A canteen that cooks from habit overproduces on quiet days and runs short on busy ones. BowlByte already records orders, kitchen tasks, cash, and pickup. P006 adds the records a manager needs before a forecast is meaningful: what was cooked, what was thrown away, and what was merely left unsold.

The phase has three parts.

1. Production batches and waste, kept apart from saleable stock and from online orders.
2. A demand forecast for the next open day and the next seven open days, with a baseline and a scikit-learn candidate.
3. A preparation recommendation the manager can approve. Approval records an intention. It does not cook food, take payment, or move stock.

Managers use `/admin/production`, `/admin/waste`, and `/admin/intelligence`. Students, cashiers, and kitchen staff cannot train a model or approve a plan.

## What a number means

| Label | Meaning |
| --- | --- |
| ACTUAL / REAL | Read from this canteen's orders, batches, waste, or cash |
| DEMO | Seeded synthetic history in `demo_demand_days` |
| Estimate | A forecast or a what-if plan |
| Unavailable / undefined | The denominator was zero, or the history was too short |

Closed days are stored as closures or, in the demo set, as closed observations. They are not ordinary days with zero sales. A stockout day is marked censored: the observed sale may be less than the demand that would have occurred.

Order `service_date` remains the UTC date stored when the order was placed. New production dates default to `Asia/Kolkata` unless `CANTEEN_TIMEZONE` is set. Around midnight those two dates can disagree. That is recorded in `docs/P006_KNOWN_LIMITATIONS.md`.
