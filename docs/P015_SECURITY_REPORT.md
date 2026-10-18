# P015 security

Checked on the live API without using a real student's password:

- Unauthenticated order reads return 401.
- Login still requires the site Origin. A missing Origin is rejected as CSRF.
- Roles remain on BowlByte rows. Supabase `user_metadata` is not consulted for permissions.
- The 263 Auth identities were not re-imported. Six disabled disposable rows stay unlinked from Auth.
- Audit rows were not deleted.
- Prepared statements are disabled on the pooler connection so a recycled server connection cannot revive a named statement.

Not rerun this phase: cross-student order reads, cross-canteen staff denial, JWT negative cases, and rate-limit 429. Those passed in P014 or in the unit/auth tests that ran again. JWT unit tests are part of the 95 passing unit tests.

No new P0 authorization defect was found in the code reviewed for the order response path.
