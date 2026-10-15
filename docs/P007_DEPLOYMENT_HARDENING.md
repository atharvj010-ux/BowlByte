# P007 deployment hardening

## Local development

Unchanged ports: frontend 127.0.0.1:3010, API 127.0.0.1:8010, PostgreSQL 127.0.0.1:5433, Redis 127.0.0.1:6379, Mailpit 127.0.0.1:8025. `COOKIE_SECURE` stays false because the browser origin is HTTP. `TRUST_PROXY` stays unset. The Next.js 16 route handler does not expose the TCP peer, so the proxy sends `0.0.0.0` and the API rate-limits that shared label. `X-Forwarded-For` is ignored unless `TRUST_PROXY=true`, in which case only the rightmost hop is used.

Per-email login limits still apply.

## Staging overlay

```powershell
docker compose -f docker-compose.yml -f docker-compose.staging.yml up -d
```

Do not point this at the current development `.env`. Production mode refuses the dev-only pickup and push keys, and it refuses `PUSH_ALLOW_TEST_ENDPOINTS=true`.

The overlay:

- Publishes Caddy on 127.0.0.1:8443 only
- Removes published ports for PostgreSQL, Redis, Mailpit, and the Next.js container
- Sets `COOKIE_SECURE=true` and `TRUST_PROXY=true`
- Sends browser traffic to the frontend. The frontend still proxies `/api/v1` same-origin

Remaining steps before a public pilot:

1. Replace `:443` in `deploy/Caddyfile` with the college hostname and a real certificate.
2. Generate VAPID, pickup, and push keys outside the repo.
3. Set `COLLEGE_ELIGIBILITY_MODE=roster` and import a roster if roll numbers must be owned.
4. Set `PROXY_SHARED_SECRET` to a long random value.
5. Confirm Mailpit is not reachable from the campus network.

`__Host-` cookie names are not switched on in this phase. The session cookie is already HttpOnly and SameSite, and Secure is required when `COOKIE_SECURE=true`. Renaming the cookie is a separate change.

WebSocket upgrades still go through `frontend/ws-proxy.mjs` on the same host, so a TLS proxy in front of the frontend makes them `wss`.
