# P012 email authentication

Status: blocked for Supabase Auth. The live application still uses BowlByte cookie sessions.

## Checked

- Public signup is disabled.
- Email autoconfirm is off.
- The email provider flag in Auth settings is on. Custom SMTP is not configured in BowlByte's environment, and Supabase SMTP was not changed.
- Auth admin user count: 0.
- `SUPABASE_CREDENTIALS_ROTATED` is unset. The admin secret still matches the value pasted in chat, and the database URI still contains the password fragment that reached a local tool log. Neither value is repeated here.

## Not run

- Disposable Argon2id `createUser` import.
- Password login against Supabase Auth.
- Import of the 263 BowlByte users.
- Live verification or reset mail from Supabase.

EMAIL DELIVERY NOT VERIFIED.

## Local recovery added

`POST /api/v1/auth/forgot-password` and `POST /api/v1/auth/reset-password` use the existing Mailpit SMTP path inside Compose. The response does not say whether the email is registered. The token is stored in Redis as a hash for 30 minutes, works once, and is not logged. A reset deletes that account's sessions. Pages: `/forgot-password` and `/reset-password`. The link is in the URL fragment, then removed from the address bar.

This was not sent through Mailpit in this session. Delivery of the new templates is not verified.

Roles stay on the BowlByte user row. Registration still goes through `register_student`, which checks institutional email, roster, and enrollment rules before creating an account.
