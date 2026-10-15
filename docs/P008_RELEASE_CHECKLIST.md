# P008 release checklist

| Area | Status | Evidence |
| --- | --- | --- |
| Authentication | PASS WITH ISSUES | Argon2id, sessions, CSRF. Institutional email does not prove a roll number |
| Student eligibility | PASS WITH ISSUES | Roster mode exists. No college roster was imported |
| Menu and ordering | PASS | Playwright ordering scenarios |
| Stock consistency | PASS | Reservation and cancel tests in the integration suite |
| Kitchen queue | PASS WITH ISSUES | FIFO and capacity tests pass. Local throughput is a single-process measurement |
| ETA | PASS | Station schedule is an estimate written with the kitchen transaction |
| Cash handling | PASS | Idempotent confirm and manager reversal. No shift-close module |
| QR pickup | PASS | One-time redemption tests |
| Notifications | PASS WITH ISSUES | Outbox and in-app records. Phone display NOT TESTED |
| PWA | PASS WITH ISSUES | Manifest and service worker exist. Install on a phone NOT TESTED |
| Unclaimed orders | PASS | Integration test on PostgreSQL |
| Forecasting | PASS WITH ISSUES | Synthetic demo only. Baseline kept |
| Production and waste | PASS | Manager-recorded rows. No automatic waste from unclaimed orders |
| Manager approval | PASS | Plan approval does not create production or stock |
| HTTPS | NOT DEPLOYED | Staging file validates. No public host |
| Physical phone tests | NOT TESTED | No Android or iPhone |
| Backup and recovery | PASS | P008 dump 757 ms and restore 1728 ms into `bowlbyte_restore`, then dropped. Live database kept |
| Security | PASS WITH ISSUES | See `docs/P008_SECURITY_AND_LIMITATIONS.md` |
| Performance | PASS WITH ISSUES | 100 sequential accepts about 27–28 seconds on one laptop process |
| Documentation | PASS | P008 guides in `docs/` |
| Academic artifacts | PASS WITH ISSUES | Report DOCX, 15-slide PPTX, A1 poster PDF, and screenshots. Report PDF, slide PDF, and MP4 were NOT GENERATED |

## Readiness

| Class | Result |
| --- | --- |
| Local demo | Ready, using the running site on port 3010 |
| Supervised pilot | Ready only with a roster, a named operator, and the paper cash log. Not ready if the college requires phone push |
| Public production | Not ready |
