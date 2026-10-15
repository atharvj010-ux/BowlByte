# Roles and permissions

Authorization is a server decision. A client cannot choose its role by sending a field, a header, or a hidden form value. P002 enforces the account, session, and staff rules below. Ordering and kitchen actions are implemented. P005 implements cash recording, reversal and pickup, and it is stricter than the first design: managers cannot record cash or hand over an order, only cashiers can. Unclaimed handling is still future work.

## Accounts

| Role | Created by | Self-service |
| --- | --- | --- |
| Student | The person, through registration | Yes. The account cannot place orders until the email address is verified |
| Kitchen staff | Canteen manager for that canteen | No |
| Cashier | Canteen manager for that canteen | No |
| Canteen manager | An authorized administrator | No |

The first manager is created by a deployment command or an equivalent administrative action stored in the audit log. That command is not part of P001, and there is no seeded manager account pretending the command already ran.

A person may hold more than one staff role only if each assignment is stored explicitly. A student registration never grants a staff role.

## Canteen scope

Every staff assignment names one canteen. A kitchen employee, cashier, or manager for canteen A receives `403` for canteen B. Student orders are owned by `student_user_id` and `canteen_id`. A student reads and cancels only their own orders, and only where the state machine allows cancellation.

## Permission matrix

| Action | Student | Kitchen | Cashier | Manager |
| --- | --- | --- | --- | --- |
| Register and verify email | Yes | No | No | No |
| Provision or disable staff | No | No | No | Yes, in their canteen |
| Read the published menu | Yes | Yes | Yes | Yes |
| Change menu, prices, stations, stock | No | No | No | Yes |
| Place an order | Yes, verified | No | No | No |
| Accept, queue, prepare, mark READY | No | Yes | No | Yes |
| Reject before preparation | No | Yes | No | Yes |
| Cancel within the state rules | Own order, early states only | Queued orders | No | Yes, including the manager-only cases |
| Record cash as PAID (P005: READY orders only) | No | No | Yes | No |
| Reverse a cash entry before pickup (P005) | No | No | No | Yes |
| Mark PICKED_UP (P005: also needs a one-time credential) | No | No | Yes, only if PAID and READY | No |
| Mark UNCLAIMED after the hold window | No | No | Yes | Yes |
| Read canteen analytics | No | No | No | Yes |

Kitchen status changes do not grant payment permission. Payment permission does not by itself mark an order collected.

## Session rules

- Passwords are hashed with Argon2id. Plaintext passwords are never stored or logged.
- Session identifiers are random. The database stores only a SHA-256 hash. The cookie is HttpOnly and is not placed in local storage or session storage.
- Email verification and invitation tokens are random, stored as a SHA-256 hash, and expire.
- Staff provisioning writes an audit row with the acting manager, the target, the role, and the canteen.
- Disabled staff lose existing sessions immediately. The next request is rejected.
- `/student`, `/staff`, `/cashier`, and `/admin` check the session on the server before rendering, and the API checks it again at the data boundary.

## Audit

These actions append an audit record in the same database transaction as the change:

- Staff provisioned, role changed, or access disabled
- Payment moved from PENDING to PAID
- Payment voided or otherwise corrected
- Order moved to PICKED_UP
- Order rejected, cancelled from PREPARING, or marked UNCLAIMED
- Menu price changed

The audit row stores the actor, the canteen, the target record, the action, the reason where one is required, and the time. It does not store card numbers. There are no card numbers in this product.
