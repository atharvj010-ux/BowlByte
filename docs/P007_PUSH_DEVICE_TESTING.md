# P007 push and device testing

## Operator metrics

`GET /api/v1/admin/push/metrics` now includes pending events, retryable delivery rows, permanent failures, expired subscriptions, the oldest pending age, a backlog warning flag, and `last_push_service_acceptance_at`. The payload has no push endpoint and no key. The acceptance timestamp means the push service returned 2xx. It does not mean a phone displayed the notification.

Warning thresholds: `PUSH_BACKLOG_WARN_EVENTS` (25) and `PUSH_OLDEST_PENDING_WARN_SECONDS` (300).

## HTTPS staging

`docker-compose.staging.yml` and `deploy/Caddyfile` are in the repo. `docker compose -f docker-compose.yml -f docker-compose.staging.yml config --quiet` succeeded. The overlay was not started. It would require production secrets and would change the running local stack. Caddy is bound to 127.0.0.1:8443 with `tls internal`. That is not a public deployment.

## Devices

| Device | Result |
| --- | --- |
| Android | NOT TESTED. No physical device was used |
| iPhone | NOT TESTED. No physical device was used |

Playwright stubs of `Notification` and `PushManager` are not device results.
