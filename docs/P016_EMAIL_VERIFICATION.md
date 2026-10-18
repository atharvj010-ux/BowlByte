# P016 email verification

Live mail is Brevo SMTP, and account messages for linked users go through Supabase Auth. This phase checked configuration and the SMTP login. It did not send a message, and it did not read an inbox.

## Configuration

From the local settings file, values themselves are not recorded here:

| Check | Result |
| --- | --- |
| SMTP host is a Brevo host | Yes |
| SMTP port | 587 |
| STARTTLS | Yes |
| Sender, username, and password are set | Yes |
| SMTP `LOGIN` | Accepted |
| Message submitted with `MAIL`/`DATA` | Not attempted |
| Brevo delivery report | Not available |
| Recipient inbox | Not opened |

Supabase Auth settings returned HTTP 200. `mailer_autoconfirm` is false, so a new Auth user is not confirmed by default. The project `disable_signup` flag is false. BowlByte's own registration gate is separate and is documented in the Auth acceptance note.

## Application controls, not inbox proof

- Email OTP requests `POST /auth/v1/otp` with `create_user` false. An OTP is sent only for an existing active user who already has an Auth link.
- Password recovery for a linked user calls Supabase recover and redirects to `/reset-password`.
- A wrong, expired, or reused OTP was not submitted, because no code was received.
- Resend cooldown was not exercised, because that would send another message.

## Result by stage

| Stage | Result |
| --- | --- |
| SMTP connection and authentication | Accepted |
| SMTP submission | Not attempted |
| Brevo delivery | NOT VERIFIED |
| Inbox receipt | NOT VERIFIED |
| Verification link opened | NOT VERIFIED |
| OTP code accepted | NOT VERIFIED |
| Password recovery completed | NOT VERIFIED |
| Physical Web Push on a phone | NOT VERIFIED |
