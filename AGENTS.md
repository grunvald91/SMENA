# Instructions for AI coding agents — ServGo Смена

1. Application name is ServGo Смена, repository `grunvald91/servgo-shifts`, separate from `booking_bot` and `Ai_growth_os`.
2. All deployed JavaScript modules are in `tgcloud/`; handlers/endpoints flat; shared code in `tgcloud/lib/`, imports local relative with `.js`; use `sdk` and `sdk/db` only in deployed modules. Never add Node imports to Telegram runtime.
3. Keep all authorization inside service functions, not only UI. Ownership is verified from authenticated Telegram ID. Never trust user/employee ID or salary from a client request.
4. QR issuance must fail closed when WebCrypto or signature verification is unavailable. NEVER replace with unverified cookies, browser fingerprint, static QR or shared group password.
5. An owner account on a second device is not sufficient for kiosk access; possession of locally stored private key must be proven per QR issuance. This is a software key, NOT hardware attestation.
6. One open shift per employee enforced at DB unique index. Closed shifts immutable by default. Preserve audit log. Owner edits should be implemented as approved corrections, not overwrites.
7. Salary is preview only: integer kopeks, hourly snapshots per shift, no gross-to-net promises, no undocumented payroll deductions. Unknown shifts require human review.
8. Separate private salary responses from public group messages. Do not log photographs, full Telegram IDs, key materials or private employee information.
9. User explicitly does not want a scheduler or automatic reminders. Reports are invoked manually. Deploy only after secrets, data-localization, SDK and end-to-end testing.
   GitHub Actions are allowed: the repository is public, so standard-runner minutes are free and unlimited (checks, builds, manual `workflow_dispatch` jobs). Logs are public: never print secrets, `TGCLOUD_TOKEN`, Telegram IDs, salaries, photographs or other employee data, and run workflows that use secrets only for the owner (never from fork pull requests).
10. Tests: `npm run check`, plus platform `tgcloud run`, `tgcloud migrate --dry-run` when connected. No automatic deployments.
11. AI interface: use typed commands in `tgcloud/lib/service.js`, tenant isolation and an explicit approval step for payroll and corrections. See `docs/AI_INTERFACE.md`.
12. Important: browser key stored in IndexedDB cannot prove physical location or block active QR relay. Don't claim otherwise.
