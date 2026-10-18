# P015 student acceptance

This phase rechecked the public pages and the anonymous order boundary on the native runtime.

- `/` and `/student/login` returned HTTP 200.
- `GET /api/v1/orders` without a session returned 401.
- The expired-session message is applied after hydration.
- Email confirmation copy no longer differs between server and client on the first paint.

Ordering, cart animation, tracking, and QR display were proven on this runtime in P014 with a disposable account. They were not repeated, so this phase did not add another live order. The post-commit 500 is covered by a unit test rather than a new live checkout.

OTP inbox delivery remains NOT VERIFIED.
