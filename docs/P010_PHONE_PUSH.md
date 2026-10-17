# P010 phone push

## What was actually wrong

The delivery pipeline from P005 was already in place: service worker, VAPID keys, encrypted subscriptions, a PostgreSQL outbox, and a Celery worker that can sign pushes. Checked on the running development stack without printing secrets:

- The API has a VAPID public key and no private key. That split is intentional.
- The worker has both keys and can sign.
- `bowlbyte-worker-1` and `bowlbyte-beat-1` were running.
- READY already inserts one in-app notification and one outbox row in the same transaction. A push failure does not undo READY.

From the student's side, two things made notifications look unavailable:

1. After the P009 redesign, the only enable control was on `/student/profile`, and nothing on the student home, dock, or notifications page linked to it.
2. The screen could say notifications were on from browser permission and local storage alone, before BowlByte had saved the subscription.

`http://127.0.0.1:3010` is a secure context on the development machine, so desktop Chromium can subscribe there. A separate phone cannot open that address as its own localhost, and a self-signed certificate is not treated as trusted HTTPS.

## What changed

- Phone notifications are on `/student`, `/student/profile`, and `/student/notifications`.
- Status is one of: NOT ENABLED, PERMISSION REQUIRED, ENABLED, BLOCKED BY BROWSER, UNSUPPORTED, NEEDS HOME SCREEN INSTALLATION, SUBSCRIPTION ERROR.
- ENABLED is shown only when this browser has a push subscription and the API confirms that endpoint is saved for the signed-in student.
- Permission is requested only from the Enable Phone Notifications click. A denied permission is not prompted again.
- Disable removes the browser subscription and the server row. Logout still releases the device.
- iPhone Safari outside the installed Home Screen app gets the Home Screen instructions and is not marked enabled.
- Android guidance says installation is optional when the browser already supports push.
- Send Test Notification queues a real outbox event for the signed-in student only, rate limited, and then reports whether the push service accepted it. Acceptance is not the same as the phone displaying it.
- READY copy is now “BowlByte — Your Food Is Ready!” and “Order #… is ready. Please pay cash at the canteen counter and collect your food.” The click opens `/student/orders/{id}`.
- The manifest theme matches the charcoal app. `display` stays `standalone`.

## HTTPS for a real phone

Physical delivery needs a publicly trusted certificate on a hostname the phone can reach. `deploy/Caddyfile` uses `tls internal`, which is not that certificate. `deploy/Caddyfile.public` is the file to mount when a real hostname exists.

Do not start the staging stack until these are set outside git:

- `PUBLIC_APP_URL` (https hostname)
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (the existing pair; do not regenerate unless every phone must subscribe again), `VAPID_SUBJECT`
- `PUSH_ENCRYPTION_KEY`, `PICKUP_HASH_KEY`, database password, `PROXY_SHARED_SECRET`
- DNS pointing at the host, ports 80 and 443 reachable

Then:

```powershell
docker compose --env-file deploy/staging.env.example -f docker-compose.staging.yml config
```

Review the config. Start it only when those secrets and the hostname are authorized. Do not publish Postgres, Redis, or Mailpit. Do not use `curl -k` as proof.

## Device results

| Device | Result |
| --- | --- |
| Android | NOT TESTED. No physical device and no trusted public HTTPS host were available. |
| iPhone | NOT TESTED. Same limit. Web Push on iPhone also requires iOS 16.4 or later and the Home Screen app. |

Playwright uses a local push simulator. That is not a phone result.

## Verification on this machine

- API liveness and readiness both returned 200. PostgreSQL and Redis were up. The worker and beat containers were up. The worker can sign with the existing VAPID pair. The API process does not hold the private key.
- Backend unit tests: 67 passed.
- PostgreSQL integration tests: 87 passed, 2 skipped.
- Playwright (auth, cash and pickup, intelligence, kitchen, ordering, P009 experience, smoke): 43 passed, 1 skipped. The skip is the optional P009 frame capture. Notification enablement, the READY copy, and kitchen flow are in the passing set.
- A signed-in browser session showed the phone-notification panel on `/student`, `/student/notifications`, and `/student/profile`. With permission already granted and no subscription, the status stayed NOT ENABLED. Tapping Enable Phone Notifications tried a real `PushManager.subscribe`. This embedded browser answered that its push service is not available, and the screen did not change to ENABLED.
- The student page had no horizontal overflow at 360, 390, 768, 1280, or 1440 pixels.
