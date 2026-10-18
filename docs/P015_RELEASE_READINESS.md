# P015 release readiness

Status: PASS WITH ISSUES.

The native Supabase runtime was left running. Destructive regression used a separate PostgreSQL 17.6 server on `127.0.0.1:55432`, database `bowlbyte_e2e`, and Redis database 15. Docker was not restarted. The authoritative Supabase database was not modified.

P0 defects: none.

P1 defects: none. Integration and Playwright both executed.

P2: menu photographs are still absent. Hosted Supabase Auth was not exercised in the browser; the isolated suite uses local password accounts. A real mailbox, OTP delivery, and a physical phone push were not observed. The Supabase session-pooler disconnect is proven by fault injection, not by a disposable Supabase project.

The optional screenshot capture was skipped. Core order, kitchen, cash, and pickup flows passed on the isolated stack.
