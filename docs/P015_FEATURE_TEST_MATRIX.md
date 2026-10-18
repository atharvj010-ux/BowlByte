# P015 feature matrix

Status values are for this phase. P014 evidence is labeled when it was not rerun.

| Feature | Entry | Role | This phase | Evidence |
| --- | --- | --- | --- | --- |
| Landing and sign-in pages | `/`, `/student/login` | public | PASS | HTTP 200, 0.14s and 0.19s |
| Student password login | `POST /api/v1/auth/login` | student | NOT RERUN | P014 disposable login returned 200 |
| Kitchen, cashier, manager login | same | staff | NOT RERUN | P014 returned 200 for each role |
| Expired-session note | `LoginForm` | student | PASS | Moved to an effect; unit of behavior is render-safe |
| Email verify and invite pages | `token-confirm.tsx` | student, staff | PASS | First paint no longer depends on `window` |
| Password recovery form | `recovery-forms.tsx` | public | PASS | Hash token is read in an effect |
| OTP request and inbox | `/auth/email-otp` | student | BLOCKED | No authorized inbox was read |
| Recovery mail inbox | `/auth/recover` | public | BLOCKED | No inbox was read |
| Anonymous orders | `GET /api/v1/orders` | public | PASS | HTTP 401 on the live API |
| Place order | `POST /api/v1/orders` | student | PASS for the 500 path | Unit test reloads after a dropped connection. No new live order |
| Idempotent retry | same key | student | NOT RERUN | P014 retry returned the saved order |
| Menu list | `GET /api/v1/menu/items` | student | NOT RERUN | P014 returned 8 items |
| Menu images | image bytes | student | CONTENT GAP | 0 stored images. Placeholder copy already exists |
| Kitchen accept through ready | `/staff/orders`, tasks | kitchen | NOT RERUN | P014 order reached READY |
| Cash and pickup | `/cashier/...` | cashier | NOT RERUN | P014 paid once and rejected a replay |
| WebSocket upgrade | `/api/v1/ws/orders/{id}` | student | NOT RERUN | P014 authorized upgrade was HTTP 101 |
| Manager overview | `/admin/kitchen/overview` | manager | NOT RERUN | P014 returned 200 in 3.4s after the station query fix |
| Forecast training | `/admin/forecasting/train` | manager | NOT RERUN | P014 worker logged SUCCEEDED in 5.5s |
| Rate limit | login email bucket | public | NOT RERUN | P014 returned 429 with Retry-After |
| Backend unit suite | pytest, not integration | n/a | PASS | 95 passed |
| Backend integration | pytest `-m integration` | n/a | BLOCKED | No disposable PostgreSQL without Docker |
| Playwright | `npm run test:e2e` | all | BLOCKED | Fixtures still require that disposable database |
| Vitest, ESLint, production build | frontend | n/a | NOT RERUN | Unchanged from P014 except auth forms. Typecheck passed |
| Live health | `/api/v1/health`, `/ready` | n/a | PASS | 200 after the API reload |

Frontend pages accounted for: `/`, `/status`, student login, register, verify-email, forgot-password, reset-password, student home, menu, cart, orders, order detail, notifications, profile, staff login and queue, cashier and history, admin login, menu, stock, stations, kitchen, cash, orders, staff, production, waste, intelligence, forecasts, planning, and history.
