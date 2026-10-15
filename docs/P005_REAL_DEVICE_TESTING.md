# P005 real device testing

## Status: NOT TESTED

No physical Android phone or iPhone was available when P005 was built. No real push service delivered a message to a real device. Nothing in this repository claims it did. The browser and simulator tests prove BowlByte's own behaviour. They do not prove phone behaviour.

| Platform | Result |
| --- | --- |
| Android (Chrome) | NOT TESTED |
| iPhone (Home Screen web app) | NOT TESTED |

Record results below when someone runs the checklist. Until then the status stays NOT TESTED, and P005 stays PASS WITH ISSUES.

## Before you start

1. Serve BowlByte over HTTPS with a certificate the phone trusts (a tunnel such as a staging host works). `http://192.168.x.x` does not support service workers or push.
2. Set real VAPID keys in `.env` (`python -m app.cli.generate_vapid`), set `PUSH_ALLOW_TEST_ENDPOINTS=false`, and set `PUBLIC_APP_URL` and `CORS_ORIGINS` to the HTTPS origin.
3. Start `backend`, `worker` and `beat`. Confirm `GET /api/v1/ready` is up and the beat log shows `drain-notification-outbox` being sent every 15 seconds.
4. Create a manager, a kitchen user, a cashier and a student. Publish one menu item.
5. Keep the kitchen dashboard open on a laptop.

## Android checklist

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| A1 | Open the HTTPS address in Chrome | Page loads, no certificate warning | |
| A2 | Install the app (menu, Install app) | Icon appears. Opens standalone | |
| A3 | Sign in as the student | Student home | |
| A4 | Profile, "Turn on notifications", allow the prompt | State becomes "On for this device" | |
| A5 | Place an order | Order shows PLACED, cash pending | |
| A6 | Put the app in the background and lock the screen | | |
| A7 | On the laptop, accept, start, complete and mark READY | | |
| A8 | Within about 30 seconds look at the phone | A "BowlByte — Order Ready!" notification is visible | |
| A9 | Tap it | The correct order page opens, status READY, cash pending | |
| A10 | Record `accepted` vs `displayed`: check `push_deliveries.status` in the database | `ACCEPTED` only means the push service took it. Your eyes decide "displayed" | |

## iPhone checklist

Requires iOS 16.4 or later.

| # | Step | Expected | Result |
| --- | --- | --- | --- |
| I1 | Open the HTTPS address in Safari | Page loads | |
| I2 | Profile page before installing | Message explains that Home Screen install is required | |
| I3 | Share, Add to Home Screen | Icon on the Home Screen | |
| I4 | Open BowlByte from the Home Screen icon | Standalone window | |
| I5 | Sign in as the student | Student home | |
| I6 | Profile, "Turn on notifications", allow | "On for this device" | |
| I7 | Place an order, then lock the phone | | |
| I8 | On the laptop mark it READY | | |
| I9 | Look at the lock screen and Notification Centre | The ready notification appears | |
| I10 | Tap it | Correct order page opens | |

## Extra checks worth doing

- Turn the notification off in phone settings, mark another order READY. Expect no notification and, after the push service answers 404 or 410, the subscription disabled.
- Log out on the phone, mark READY. Expect nothing delivered to that device.
- Sign in as a different student on the same phone. Expect no messages for the first student.

## Recording a result

Add a row here with date, device model, OS and browser versions, tester, and what you saw. Do not edit the status line above unless every step passed on that platform.

| Date | Platform | Device and OS | Tester | Outcome |
| --- | --- | --- | --- | --- |
| | | | | |
