# P007 failure recovery

## Backup

On 15 October 2026 the live `bowlbyte` database (PostgreSQL 16 in `bowlbyte-postgres-1`, host port 5433) was dumped with `pg_dump -Fc` and restored into a new database `bowlbyte_restore` on the same server. The dump file stayed under `backend/var/`, which is gitignored, and was not published.

| Step | Result |
| --- | --- |
| Dump | Success, 1204 ms |
| Restore | Success, 2365 ms |
| `alembic_version` after restore | `0006_food_intelligence` (the live database had not yet been upgraded) |
| Row check | 115 users, 2 orders |
| Disposable database | Dropped after the check |

The live `bowlbyte` database was not dropped or truncated. Phishing-defense containers were not used.

Restore procedure:

```powershell
docker exec bowlbyte-postgres-1 pg_dump -U bowlbyte -d bowlbyte -Fc -f /tmp/bowlbyte.dump
docker exec bowlbyte-postgres-1 psql -U bowlbyte -d postgres -c "CREATE DATABASE bowlbyte_restore;"
docker exec bowlbyte-postgres-1 pg_restore -U bowlbyte -d bowlbyte_restore --no-owner /tmp/bowlbyte.dump
```

Do not copy that dump to a shared drive. It contains account rows.

## Failure behaviour already covered by tests

| Scenario | Expected behaviour | Evidence |
| --- | --- | --- |
| Cash confirmation retried | One receipt | `test_cash_retry_is_idempotent_and_second_attempt_is_rejected` |
| Concurrent cash | One receipt | `test_concurrent_cash_confirmations_create_one_receipt` |
| Concurrent QR redemption | One pickup | `test_concurrent_redemptions_allow_exactly_one` |
| Expired or disabled session | Rejected | `test_expired_and_disabled_sessions_are_rejected` |
| Forecast or plan | Does not move stock | `test_demo_training_forecast_and_plan_do_not_move_stock` |
| Pickup hold vs collection | No payment or stock change | `test_expired_hold_blocks_pickup_without_touching_payment_or_stock` |
| Outbox while push is down | Row stays pending until the worker runs | P005 outbox tests; the READY transaction still commits |

Redis, Celery, and the API process were not killed against the live database in this phase. The outbox and the hold sweep both read PostgreSQL, so a worker restart retries the same rows. A forecast training failure is a job row, not an order transition.
