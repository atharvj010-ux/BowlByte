# P006 known limitations

Carried forward from P005:

1. Physical Android push: NOT TESTED.
2. Physical iPhone push: NOT TESTED.
3. HTTPS staging is still required before phone delivery can be claimed.
4. `npm audit` still reports high findings in the development ESLint chain. They were not force-fixed.
5. P004 queue scaling is not optimised.
6. Institutional email mode does not independently verify roll-number ownership.
7. Login proxy IP rate limiting still shares one counter across clients behind the same address.

P006 limits:

- Forecasts are all-day. Orders have no meal period.
- Future Sundays are forecast unless a closure row exists. Demo Sundays are closed only inside the demo table.
- Order analytics use the stored UTC `service_date`. Production defaults to `Asia/Kolkata`. They can disagree near midnight.
- The gradient-boosting candidate is not auto-activated, and on the seeded one-item run it did not beat the baseline.
- Planning weights are stored preferences. The allocator is a greedy station-minute fill, not an OR-Tools solve.
- Residual bands are not calibrated confidence intervals.
- Demo accuracy is not real canteen accuracy. There is no real-history MAE.
- A production batch does not reconcile itself to a specific online order. Overlap is a warning, not a join.
- Training artifacts are pickle-based. The loader trusts only checksummed files in `var/forecast_artifacts`.
- The six index names that `alembic check` used to report were declared on the P002 models. The check on 15 October 2026 reported no new upgrade operations. Applied revisions 0001–0005 were not edited.
