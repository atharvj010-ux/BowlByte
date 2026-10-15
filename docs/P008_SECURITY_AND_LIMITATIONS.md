# P008 security and limitations

P007 findings that were not closed:

| Item | Status |
| --- | --- |
| Android and iPhone push display | NOT TESTED |
| Public HTTPS | NOT DEPLOYED |
| Roll-number ownership | Blocked until the college provides a roster and roster mode is on |
| Local login IP label `0.0.0.0` | Remains when `TRUST_PROXY` is unset. Per-email limits remain |
| WebSocket after logout | The open socket is not force-closed. The next request loads the session again |
| GHSA-vfj7-8cjw-p6xm | Five high findings in the ESLint development tree. `npm audit --omit=dev` was 0 in P007. Re-check is recorded in `docs/P008_FINAL_TEST_RESULTS.md` |
| Migration `0006_food_intelligence.py` | Formatter still fails on that file alone. Ruff's format exclude lists that path only. `ruff format --check .` uses the project config and skips it. `ruff format --check alembic/versions/0006_food_intelligence.py` still fails. The file was not edited |
| Kitchen throughput | Single-process laptop numbers only |
| Forecast scores | Synthetic, 60 demo rows, one item. Seasonal naive validation MAE 2.143. HistGradientBoosting validation MAE 3.000. No waste reduction claim |
| Cash shift close | Not implemented. Manual procedure is in `docs/P008_PILOT_RUNBOOK.md` |

P008 adds startup rejection of production defaults: secure cookies, a long proxy secret, a non-default database password, real pickup and push keys, a VAPID public key, and a VAPID private key on the worker process. The frontend container still does not receive the VAPID private key.

No new secret was committed.
