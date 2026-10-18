# P015 release readiness

Status: PASS WITH ISSUES.

The native Supabase runtime is still the live application. The order-create 500 after a pooler disconnect now reloads the committed row instead of failing the response. Sign-in and related auth screens no longer branch on `window` during the first render.

P0 defects found in this phase: none left open in code. The original 500 is fixed and unit-tested, not reproduced with a new live order.

P1: full integration and Playwright were not rerun because there is no Docker-free disposable PostgreSQL. That is an environment limit, not a failed test.

P2: menu items have no stored photographs. OTP and recovery inbox delivery remain unverified. Physical push delivery remains unverified.

The application is usable on the native runtime. It is not ready to be described as fully retested end to end until an isolated PostgreSQL database exists and Playwright is pointed at it.
