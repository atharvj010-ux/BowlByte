# P008 handover

BowlByte on commit `3a3a081` plus the P008 commit is a local demonstration of a college canteen: accounts, menu, stock, kitchen queue, cash, QR pickup, notifications, unclaimed holds, and a synthetic forecast. The repository has not been pushed unless a later command says otherwise.

## Run the local demo

From the repository root, the existing project is already defined in `docker-compose.yml`. Do not stop containers whose names do not start with `bowlbyte`.

Health: `http://127.0.0.1:8010/api/v1/health` and `http://127.0.0.1:8010/api/v1/ready`.

Site: `http://127.0.0.1:3010`.

Mail capture: `http://127.0.0.1:8025`.

## People and college

The repository does not name the student team, the guide, or the department. The user message mentioned Vidyalankar Institute of Technology as a possibility. That name is **not confirmed** in the BowlByte files, so the academic sources leave it as a placeholder.

## Backup

Development database `bowlbyte` on `bowlbyte-postgres-1`, host port 5433. P008 measured a custom-format dump at 757 ms and a restore into `bowlbyte_restore` at 1728 ms. Both copies were at `0007_pickup_holds` with the same order count. The disposable database and the dump were deleted. Do not drop `bowlbyte`. Do not copy a dump to a shared drive. Retention for a pilot: keep seven daily dumps on the operator's encrypted disk, and delete them when the college asks.

```powershell
docker exec bowlbyte-postgres-1 pg_dump -U bowlbyte -d bowlbyte -Fc -f /tmp/bowlbyte.dump
docker exec bowlbyte-postgres-1 psql -U bowlbyte -d postgres -c "CREATE DATABASE bowlbyte_restore;"
docker exec bowlbyte-postgres-1 pg_restore -U bowlbyte -d bowlbyte_restore --no-owner /tmp/bowlbyte.dump
```

Menu images are inside that dump. Forecast artifacts in development are inside the API container filesystem. Staging uses a named volume. Notification outbox rows are in PostgreSQL.

## Staging

Validate only, unless secrets and a hostname exist:

```powershell
docker compose --env-file deploy/staging.env.example -f docker-compose.staging.yml config --quiet
```

## Tests

Commands and the latest counts are in `docs/P008_FINAL_TEST_RESULTS.md`.

## Do not claim

Public HTTPS, phone push, a real roster, a measured drop in waste, or a published IEEE paper.
