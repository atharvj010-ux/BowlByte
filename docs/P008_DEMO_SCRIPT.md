# P008 demonstration script

Duration about 4 to 5 minutes. Narration is written below. An MP4 was **NOT GENERATED**. No screen-recording or video-assembly tool was run. Do not describe this script as a finished video.

Use demo accounts on the local site `http://127.0.0.1:3010`. Do not use a real student roster in the recording.

## Accounts

Create a manager, a kitchen account, a cashier, and one student through the existing invite and registration screens, or reuse the Playwright helpers' pattern: a verified student and staff invited by the manager. Eligibility for a local demo can stay `institutional_domain` with the project domain. Say on camera that a college pilot should use roster mode.

## Storyboard

| Time | Scene | Narration |
| --- | --- | --- |
| 0:00–0:25 | Landing page | BowlByte is a college canteen system. Students order ahead, the kitchen prepares by station, and payment is cash at the counter. There is no online payment. |
| 0:25–0:50 | Student menu and cart | The student signs in, chooses items, and places an order. The database stores the order as cash pending and reserves stock. |
| 0:50–1:30 | Kitchen queue | The kitchen accepts the ticket. Each portion is a task on a station. The estimate is a queue calculation, not a promise. The student sees the status change. |
| 1:30–2:10 | Ready and notification | The kitchen finishes the tasks and confirms the order is packed. The status becomes READY. An in-app notification is stored in the same database transaction. A phone notification was not demonstrated, because no physical device was tested. |
| 2:10–3:00 | Cash and QR | The cashier checks the amount, records the cash received, and scans the student's QR. The order becomes picked up. The same QR cannot be used again. |
| 3:00–3:40 | Manager cash | The manager sees the receipt. A correction, if shown, is a reversal with a reason, not a deleted row. |
| 3:40–4:20 | Intelligence | Show production, waste, and the forecast page. Say that the chart uses the seeded demo series. Seasonal naive had validation MAE 2.143 and was kept. Gradient boosting was 3.000. These are not real canteen results, and no waste reduction is claimed. |
| 4:20–4:40 | Close | Unclaimed food stays an operational decision. The pickup hold does not invent a refund. The project is ready for a supervised demonstration on this machine. A public site and phone push are still open. |

## Recording checklist

- Browser at 1280 pixels, then one phone-width pass at 390 pixels.
- Hide bookmarks and other accounts.
- Do not show `.env`, Mailpit messages with real addresses, or another project's windows.
- If the notification panel is opened, use the demo student only.
