# P012 rate-limit policy

Redis keys are `bowlbyte:rl:{bucket}:{sha256}`. `X-Forwarded-For` is not read. A client IP is used only when `PROXY_SHARED_SECRET` matches `x-bowlbyte-proxy` and `x-bowlbyte-client` is an IP. Otherwise the TCP peer is used. On this Compose stack that peer is the Next.js proxy, so account and email buckets are the real limits.

A denied call returns 429 and `Retry-After` seconds. If Redis cannot be reached, login, registration, recovery, ordering, cash, pickup completion, invitations, training, and push tests return 503. WebSocket connect closes `4429` when limited and `1013` when Redis is down. An open socket reloads the session about every 5 seconds and closes `4401` when the session is gone.

| Bucket | Limit | Window |
| --- | --- | --- |
| login-email | 5 | 15 min |
| login-ip | 50 | 15 min |
| register-ip | 30 | 1 hour |
| resend-email / resend-ip | 3 | 15 min |
| forgot-email | 3 | 15 min |
| forgot-ip | 5 | 15 min |
| reset-ip | 10 | 15 min |
| order-user | 20 | 10 min |
| cash-user | 40 | 10 min |
| pickup-complete | 30 | 10 min |
| pickup verify | existing cashier and ticket failure limits | existing window |
| pickup issue | existing per-order issue limit | existing window |
| push-test | 3 | 1 hour |
| invite-user | 20 | 1 hour |
| forecast-train | 4 | 1 hour |
| ws-user | 30 | 1 min |

Login and pickup verification still count failures, not successful reads. The new order, cash, pickup completion, invitation, training, and push buckets count every call, including an idempotent replay.

Supabase Auth has its own limits. These FastAPI limits do not cover a direct call to Supabase Auth. No direct Auth traffic exists yet.

A unit test checks that the second atomic consume returns 429 with `Retry-After`. The 429 paths were not exercised through HTTP against Redis in this session.
