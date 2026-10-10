# AI-first action contract (MVP)

## Principle

Telegram commands, Mini App endpoints and future AI tools call **the same domain functions**. AI never writes directly to the database or fabricates actor IDs. The gateway authenticates the user and invokes a specific function. Every write validates ownership and appends `audit_log`.

| Suggested agent action | Domain function | Access | State |
| --- | --- | --- | --- |
| `organizations.create` | `setup(actorId,name)` | Authenticated Telegram user | Implemented |
| `locations.bind` | `bindChat(actorId,groupId,name)` | Owner + group admin (group check in handler) | Implemented |
| `employees.create` | `addEmployee(actorId,tgId,name,hourlyKopeks)` | Owner | Implemented |
| `employees.list` | `listEmployees(actorId)` | Owner | Implemented |
| `employees.set_rate` | `changeRate(actorId,tgId,hourlyKopeks)` | Owner + future confirmation | Implemented, confirmation not yet added |
| `employees.set_shift_bonus` | `setShiftBonus(actorId,tgId,amountKopeks)` | Owner + future confirmation | Implemented, confirmation not yet added |
| `bonuses.create` | `createBonus(actorId,tgId,amountKopeks,reason)` | Owner + future confirmation | Implemented, confirmation not yet added |
| `shifts.scan` | `scanShift(authenticatedActorId,opaqueQrToken,action)` | Employee + valid on-site QR | Implemented |
| `reports.preview` | `makeReport(actorId,dateArgs)` | Owner | Implemented |
| `issues.list` | `findProblems(actorId)` | Owner | Implemented |
| `shifts.request_correction` | separate approval model | Employee/Owner | Not implemented |
| `payroll.approve` | immutable approved snapshot | Owner/Accountant | Not implemented |

## Important AI tool API expectations

- Input and output must be versioned, named, validated and include stable IDs.
- A gateway may expose these actions through MCP or a service endpoint, but **must not** expose sensitive `ownerReport` or employee records publicly. Telegram Serverless endpoints already require verified Mini App initData and are not public AI APIs.
- Financial writes and change of working hours require human confirmation at a separate authorization boundary.
- Enforce organization ID from authenticated session, never from a model-generated argument.
- Prevent duplicate inserts via idempotency keys and unique indexes. QR scan concurrency is protected by unique open-shift index / compare-and-set on close.
- Capture request provenance, actor, action, timestamp, before/after for impactful writes.
- Limit lists and add pagination for large organizations before integrating mass AI operations.

## Planned shift end and closing notes

- `locations.set_hours` → `setLocationHours(actorId,locationId,startTime,endTime,graceMinutes)`: owner only. Validates 24-hour HH:MM times and a 0–180-minute allowance. No AI agent may set or change a schedule without owner authorization.
- The planned end is **snapshotted at shift opening** into `shifts.planned_end_at` and the grace period into `shifts.close_grace_minutes`; changing point hours doesn't silently rewrite open/historical shifts.
- `shifts.close` through QR → photo intent → selfie **requires a human-entered reason** (5–500 characters) when the departure timestamp is outside the saved grace window. `completePhotoShift` checks it before sending an image to Telegram and the shift domain rechecks it before closing.
- `shifts.close_comment` and `shift_events.note` record the explanation. Future agent reports can read these via the owner-authenticated `reports.preview` result in `exceptions`; don't expose them in public group chats or to unrelated employees.
- If no schedule is configured on the point, deviations cannot be computed and the system must not invent a planned end. Require an owner to configure `/hours` for meaningful control.

## Attendance comments and point names

- `completePhotoShift` accepts optional `comment` for both arrival and departure; legacy `closeComment` remains accepted when `comment` is absent. Text is trimmed and limited to 500 characters. Required departure reasons are still enforced server-side. Comments are public in the work group with the attendance photo (explicitly requested by the user).
- Arrival comments are stored in `shift_events.note` and the existing photo intent field; departure comments also remain in `shifts.close_comment`. Owner dashboard history includes `startComment` and `closeComment`; employee context and group captions exclude comments.
- `ownerLocationName` is owner-authorized, checks the point belongs to the same organization, accepts 2–100 characters and audits the rename. No group/device rebinding or schema change is needed.

## Control endpoints

- `controlContext`: signed-in owner gets own requests and active recipient selectors; an employee gets only assigned tasks. No salary data.
- `createControl`: owner-only; client requestId is a 32-character idempotency key, locationId, employeeId (`all` snapshots active open shifts on the selected location), instruction 3–300 characters, deadline `YYYY-MM-DDTHH:mm` in organization timezone (future, within 31 days). Sends the task to that location's bound group.
- `notifyControl`: owner-only retry after a definitive Telegram rejection; unknown delivery cannot be re-sent automatically.
- `beginControl`: assigned active employee and valid 30-second workplace QR; returns a 20-minute session.
- `completeControl`: session owner only; 1–10 JPEGs, total decoded payload ≤1 MB, comment ≤500 characters. Publishes one photo or one album with public comment, deadline and server submission time; late responses remain allowed and labelled. Completed retries are idempotent; uncertain delivery is blocked to avoid duplicate publication.
- No scheduling, automatic reminders, payroll effects, gallery upload or new Telegram permissions.
