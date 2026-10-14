# P002 security tests

These cases are implemented in `backend/tests/test_auth_integration.py`, `backend/tests/test_passwords.py`, and `frontend/e2e/auth.spec.ts`. They use the real database, Redis, and Mailpit. They do not stub a successful login.

| # | Case | Where it is enforced |
| --- | --- | --- |
| 1 | Student cannot access manager endpoints | `GET /api/v1/admin/staff` and `GET /api/v1/admin/session` return 403 |
| 2 | Kitchen staff cannot access cashier-only endpoints | `GET /api/v1/cashier/session` returns 403 |
| 3 | Cashier cannot modify staff permissions | `PATCH /api/v1/admin/staff/{id}/status` returns 403 |
| 4 | Student cannot register as manager | A `role` field is rejected with 422 and no manager row is created |
| 5 | Manager cannot grant manager privileges | Invitation role `CANTEEN_MANAGER` is rejected with 422 |
| 6 | Unverified students cannot sign in | Login returns 401 and sets no session cookie |
| 7 | Invalid passwords do not establish sessions | Same generic 401, including an unknown email |
| 8 | Expired verification tokens are rejected | Token expiry is moved into the past and verify returns 400 |
| 9 | Used invitation tokens are rejected | A second accept returns 400 |
| 10 | Logout invalidates the session | `GET /api/v1/auth/me` returns 401 after logout |
| 11 | Expired sessions cannot access protected data | Absolute expiry in the past returns 401 |
| 12 | Disabled accounts cannot continue using existing sessions | Status `DISABLED` makes the existing cookie return 401, and manager deactivation deletes kitchen sessions |
| 13 | Direct URL navigation does not bypass authorization | Playwright opens `/admin` as a student and `/cashier` as kitchen staff and sees the denial |
| 14 | Unauthorized API requests return 401 or 403 | Missing session is 401. Wrong role is 403 |
| 15 | CSRF requests without required protection are rejected | Missing `Origin` on login is 403. Logout without `X-CSRF-Token` is 403 |
| 16 | Login abuse triggers rate limiting | The sixth failed attempt for one email returns 429 |
| 17 | Sessions cannot be reused after explicit invalidation | The previous cookie is rejected after a new login and again after logout |
| 18 | Staff access is restricted to the assigned canteen | A manager of another canteen receives 403 when changing that staff member |
| 19 | Secret values never appear in application logs | The failed-login log capture does not contain the submitted password. The bootstrap command rejects a password argument and does not print it |
| 20 | Registration enforces college eligibility | A non-college domain is 403. Roster mode rejects a missing, short, or wrong enrollment code |

Password hashing is checked separately: stored values start with `$argon2id$` and are not the plaintext password. An untrusted `X-BowlByte-Client` header is ignored unless it is paired with the proxy secret.
