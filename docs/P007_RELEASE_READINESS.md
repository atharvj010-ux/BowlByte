# P007 release readiness

Status for a college canteen pilot: **PASS WITH ISSUES**.

Not production-ready in the sense of a public internet launch. The local stack is the same Docker project as P006, with a pickup hold, a tighter client-IP label, and operator push counts.

## Blocks a pilot

| Severity | Issue | Action |
| --- | --- | --- |
| Medium | Roll-number ownership | Use roster mode and a college roster, or accept that an institutional email does not prove the roll number |
| High if phones are required | Push display | NOT TESTED on Android or iPhone |

## Does not block a supervised counter pilot

| Severity | Issue | Mitigation |
| --- | --- | --- |
| High, development only | GHSA-vfj7-8cjw-p6xm via ESLint | Not in `npm audit --omit=dev`. Do not force-fix |
| Low | Host browsers share one Docker address for IP limits | Per-email limits remain. Staging sets `TRUST_PROXY` |
| Medium | Open WebSocket survives logout until reconnect | Accept for a single-counter pilot |
| Info | Queue lock was not replaced | Measured. Row lock kept. ETA scan no longer reads every historical DONE task |
| Info | Cash shift close | Still not built |

Food that passes its pickup hold is not automatically wasted or refunded. The canteen decides.
