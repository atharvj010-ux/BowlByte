# P011 rollback

No Supabase write has been made, so the rollback is the current Docker stack.

- Leave the Compose project running.
- Do not run `docker compose down -v`.
- The verified dump is `C:\Users\athar\AppData\Local\BowlByte\p011\bowlbyte-p011.dump`.
- Restoring that dump is only for a replacement database. Do not restore it over Supabase `auth`.

If a later cutover writes orders to Supabase and then fails, do not point the application back at the local database without reconciling rows that exist only in Supabase. That situation does not exist yet.
