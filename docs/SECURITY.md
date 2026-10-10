# Security & release gates

## What this first build proves
- Per-location software keypair: ECDSA P-256, private key nonextractable in IndexedDB.
- Public key registered only by the authenticated Telegram organization owner.
- Every QR must be requested with a fresh signed 20-second one-time challenge.
- Only one active device per location: replacement requires signed revocation using the previous device key. Lost-device recovery is not implemented.
- QR valid for 30 seconds; token is random and unguessable when secure RNG is supported.
- Employee's own verified Telegram Mini App identity is used for scans.
- Group messages cannot expose salaries; management commands are limited to private chat.
- Database unique index protects from two simultaneously open shifts for one employee.

## What it DOES NOT prove
- Browser key storage is not a hardware-backed device attestation. Keys can potentially be used by an attacker controlling the browser/device. Telegram WebView and IndexedDB availability require real-device testing.
- An attacker can forward an active QR screenshot in real time; codes alone cannot guarantee presence or prevent collusion.
- Telegram photos do not prove they were taken live and do not identify person automatically.
- Salary preview is NOT compliant payroll and omits labor law rules. Never present as final payslip.

## Preproduction checklist
1. Verify Serverless runtime `crypto.subtle`, `crypto.getRandomValues`, `atob`, `btoa`, `Intl`, module import support on the actual bot with CLI `run`.
2. Verify authenticated endpoints in Telegram Mini App on real Android/iOS devices.
3. Verify Main Mini App deep-link `?startapp=scan_<token>` in Telegram and camera scan behavior.
4. Determine where SQLite/database and photographs are stored, retention, access, legal grounds, agreements, and 152-FZ localization for actual users in Russia; do not store real employee PII before resolved.
5. Integrate rate limits, anti-abuse, audit retention, encrypted backups, owner recovery and revocation UI, account takeover procedures.
6. Test simultaneous double check-ins and closings under platform concurrency.
7. Implement approved corrections for forgotten check-outs before payroll use.
8. Resolve fiscal/reporting/legal rules with accountant.
9. Keep `.tgcloud` credentials out of Git; no GitHub Actions.

## Live camera capture and Telegram-only photos (prototype)
- QR `beginPhotoShift` validates a 30-second token, binds the identity and action to a three-minute one-time intent; `completePhotoShift` must receive a JPEG frame captured using `getUserMedia`.
- Employees have **no file/gallery picker** in the Mini App. This is an interface restriction, NOT a cryptographic guarantee that the camera stream is physically authentic. Virtual cameras, modified clients and relay attacks remain possible.
- The bot sends transient image bytes directly to the location's Telegram group using `InputFile`; SQLite only stores `file_id` and the Telegram message reference. Telegram history is not guaranteed immutable or free of storage/access constraints.
- Photo must reach Telegram before shift completion. If message upload succeeds but DB recording fails, recovery can result in duplicate group photos; test and harden compensating actions before production.
- Photos and face images may constitute biometric personal data when used for identification. Confirm relevant consents, purpose, retention and RF localization rules before allowing actual employees to use this system.

## Shift end comments and scheduling

- Employee comments may contain personal details. Store them only as required, and show them only in owner-authorized reporting surfaces, not Telegram group photo captions.
- Validate comments on the server **before photo upload**; never allow clients to bypass the check by modifying the Mini App form.
- Freeze planned end and grace at the beginning of a shift to prevent schedule manipulation after check-in. Attendance timestamps come from the server at QR validation, not client clocks or the time the photo upload finishes.
- The first version uses **per-location hours** and optional tolerance. Employee-specific rota, public holidays, breaks, DST ambiguity resolution, and retroactive corrections need separate policy/design work.
