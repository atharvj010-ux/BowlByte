# P005 PWA setup

BowlByte is installable and can receive Web Push. It is not an offline app. Ordering, payment status and pickup all need the network.

## Files

| File | Purpose |
| --- | --- |
| `frontend/public/manifest.webmanifest` | Name, `standalone` display, theme colour, icons |
| `frontend/public/sw.js` | Service worker: push, notification click, offline fallback |
| `frontend/public/offline.html` | Shown when a page cannot be fetched |
| `frontend/public/icons/*.png` | 192, 512, maskable 512, Apple touch 180, badge 96 (`scripts/generate-icons.py`) |
| `frontend/src/components/pwa/pwa-runtime.tsx` | Registers the worker, resyncs an existing opt-in silently |
| `frontend/src/lib/push.ts` | Support detection, subscribe, unsubscribe, logout cleanup |

`next.config.ts` serves `/sw.js` with `Cache-Control: no-store` and `Service-Worker-Allowed: /`, and the manifest with its own content type.

## What the service worker does

- Caches only `/offline.html` and one icon. It never caches API responses, order pages or anything with a credential.
- For page navigations it fetches from the network and falls back to the offline page.
- On `push` it shows a notification from the payload (title, body, order link). It does not change any data.
- On click it focuses an open BowlByte window and navigates it, or opens a new one. The target must be a same-origin path under `/student`, `/cashier`, `/staff` or `/admin` made of letters, digits, `-`, `_` and `/`. Anything else opens `/student`. The "ready" notification stays on screen until the student interacts with it (`requireInteraction`).
- On `pushsubscriptionchange` it tells open pages to re-register.

## Permission flow

1. The student opens Profile and presses "Turn on notifications". The browser prompt appears only after that click.
2. If permitted, the page subscribes with the server's public VAPID key and posts the subscription. The choice is remembered per user in `localStorage` (`bowlbyte.push.optin.{userId}`).
3. Turning it off unsubscribes in the browser first, then asks the server to delete the row.
4. The page states the real status: not supported, not set up on the server, blocked, off, or on. After "Send a test notification" it says the push service accepting a message does not prove the device showed it.

## Platform requirements

- **HTTPS is required** for service workers and push, except on `localhost` and `127.0.0.1` for development. Staging and the pilot need a real certificate.
- **Android (Chrome)**: works in the browser tab or as an installed app. Use Install app or Add to Home screen.
- **iPhone**: Web Push works only for a site added to the Home Screen, on iOS 16.4 or later, opened from that icon. In plain Safari the page explains this instead of offering a button that cannot work.
- Battery savers, Do Not Disturb and notification settings on the phone can still hide a message.

## Local test without a phone

Chromium headless reports notifications as blocked and cannot reach a real push service. The Playwright suite replaces the browser's push manager with a stand-in that creates real P-256 keys and a reserved test endpoint, and the backend simulator accepts it. That checks BowlByte's code path only. See `P005_REAL_DEVICE_TESTING.md` for the manual steps that prove a phone.

## Known gaps

- No precache and no background sync. An order placed while offline is not queued.
- Icons are generated placeholders, not final artwork.
- No iOS "Add to Home Screen" prompt is shown automatically. The profile page only describes the steps.
