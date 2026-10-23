# P017 — Secure default staff account provisioning

Status: **PASS WITH ISSUES**

Date: 20 October 2026

## Outcome

Three operator-designated Admin desk identities are provisioned in BowlByte and Supabase Auth, linked, active, and canteen-scoped to `pilot`. Live password grants returned HTTP 200 with the correct roles. Isolated e2e cluster tests for the bootstrap helper passed when the disposable database was available.

## Accounts

| Desk | Role | Email | App status | Auth link | Membership |
| --- | --- | --- | --- | --- | --- |
| Kitchen | `KITCHEN_STAFF` | `bowlbytekitchen@gmail.com` | ACTIVE | linked | pilot |
| Manager | `CANTEEN_MANAGER` | `managebowlbyte@gmail.com` | ACTIVE | linked | pilot |
| Cashier | `CASHIER` | `cashatbowlbyte@gmail.com` | ACTIVE | linked | pilot |

Canteen: `pilot` (`3fa9f103-2dd6-4abe-a8b8-096464fa7ca6`).

Passwords are held only in Supabase Auth. They were not written to git, docs, or process logs.

## What was implemented

1. Config: `BOWLBYTE_INITIAL_KITCHEN_EMAIL`, `BOWLBYTE_INITIAL_MANAGER_EMAIL`, `BOWLBYTE_INITIAL_CASHIER_EMAIL`, optional `BOWLBYTE_INITIAL_CANTEEN_ID`.
2. Service: `backend/app/services/staff_bootstrap.py` — idempotent create/link/repair; refuses student promotion and role conflicts.
3. CLI: `python -m app.cli.bootstrap_staff --dry-run| --apply`
   - Confirmation: interactive `APPLY` or `BOWLBYTE_BOOTSTRAP_CONFIRM=APPLY`
   - Optional one-shot Auth create via `BOWLBYTE_INITIAL_STAFF_PASSWORD` (never a CLI arg, never logged)
4. Existing Admin login desk check unchanged: wrong desk still signs out and asks for the matching desk.
5. Manager invitation flow for additional kitchen/cashier accounts is unchanged.

## Verification performed

- Dry-run: three `CREATED` previews for canteen `pilot`.
- Apply: three `CREATED` with `Auth: CREATED`.
- Re-apply without password: idempotent readiness.
- Live `POST /api/v1/auth/login` for all three emails: `200` and correct `role`.
- Kitchen session denied manager staff API (cross-role).
- Isolated bootstrap tests: `tests/test_staff_bootstrap.py` (integration).

## Issues / remaining

1. **Shared password:** The operator chose one password for all three desks. P017 preferred unique passwords. Rotate to unique passwords in Supabase Auth when practical.
2. **First-login forced password change:** Not added (no migration). Recommended after unique passwords.
3. **Email delivery / invitation Path A:** Not used for these three; Path B (Admin create + link) was used. Inbox delivery remains NOT VERIFIED.
4. **Hard email allowlist:** Not enabled. Spec keeps manager invitations working for future kitchen/cashier hires. Only these three were provisioned as the initial desks.
5. **Local git commit:** Changes are local and uncommitted unless the operator asks for a commit. Not pushed.

## Operator commands

```text
# Preview
python -m app.cli.bootstrap_staff --dry-run

# Apply (trusted shell only)
# set BOWLBYTE_INITIAL_*_EMAIL
# optional: BOWLBYTE_INITIAL_STAFF_PASSWORD for missing Auth users
# BOWLBYTE_BOOTSTRAP_CONFIRM=APPLY
python -m app.cli.bootstrap_staff --apply
```

## Sign-in

Use `/login` → Admin → Kitchen / Manager / Cashier with the matching email. The selected desk must match the account role.
