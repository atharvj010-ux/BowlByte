# P014 authentication acceptance

The running native API uses Supabase Auth. A disposable student was created, linked to a BowlByte row, and signed in with an email and password. `POST /api/v1/auth/login` returned 200 and `GET /api/v1/auth/me` returned the student role. The same check was repeated for kitchen staff, a cashier, a manager, and a second student.

Anonymous `GET /api/v1/orders` returned 401. After logout, the same cookie was rejected with 401. A second student received 404 for the first student's order and did not see it in order history.

Wrong passwords on the disposable email reached HTTP 429 with a `Retry-After` header. The limit is per email, so it does not lock every account on this machine.

The disposable Auth users were deleted. The BowlByte rows remain with status `DISABLED` because login wrote append-only audit rows that reference them. They cannot sign in.

OTP inbox delivery was not verified. No bulk mail was sent. Password recovery delivery was not observed in an inbox. Public signup remains disabled.

The browser at http://127.0.0.1:3010/ shows the landing scene, and http://127.0.0.1:3010/student/login shows the email, password, and one-time-code form. A real student's password was not used.
