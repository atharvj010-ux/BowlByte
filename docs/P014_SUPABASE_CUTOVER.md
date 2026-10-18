# P014 Supabase cutover

Supabase PostgreSQL is the application database. The native processes set `DATABASE_URL` from `SUPABASE_DB_URL` and refuse to start unless the connection reports `current_database() = postgres` through the session pooler on port 5432 with `sslmode=verify-full` and the configured root CA.

The IPv6-only direct host and the transaction pooler on port 6543 are not used. SQLAlchemy uses `pool_pre_ping`, pool size 5, and max overflow 10.

Supabase Auth is the identity provider when `SUPABASE_CREDENTIALS_ROTATED` is `yes` and the URL, publishable key, and secret key are set. Password login exchanges the password with Supabase, verifies the ES256 access token, and requires `sub` to match `users.supabase_auth_user_id`. Roles stay on the BowlByte user row. `user_metadata` is not a permission source. The browser still receives the HttpOnly `bowlbyte_session` cookie, the CSRF cookie, and an HttpOnly refresh cookie. Opaque local session tokens are rejected in this mode.

The 263 imported Auth users were not imported again. Public signup stays disabled. Student registration still goes through the existing eligibility rules. Staff invitations still use the BowlByte mailer. Password recovery for a linked account uses Supabase only, not the old mailer as well.

## Recovery

The Docker PostgreSQL volume was not deleted. Dumps `bowlbyte-p0141.dump` and `bowlbyte-p0142.dump` are under `%LOCALAPPDATA%\BowlByte\p011`. Do not restore an older dump over newer Supabase orders. A rollback after cloud writes requires a reviewed reconciliation of those cloud rows. The app does not automatically switch back to local PostgreSQL.
