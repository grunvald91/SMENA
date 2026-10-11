# Instructions for AI coding agents — ServGo Смена

1. Application name is ServGo Смена, repository `grunvald91/SMENA`, separate from `booking_bot` and `Ai_growth_os`.
2. All deployed JavaScript modules are in `tgcloud/`; handlers/endpoints flat; shared code in `tgcloud/lib/`, imports local relative with `.js`; use `sdk` and `sdk/db` only in deployed modules. Never add Node imports to Telegram runtime.
3. Keep all authorization inside service functions, not only UI. Ownership is verified from authenticated Telegram ID. Never trust user/employee ID or salary from a client request.
4. QR issuance must fail closed when WebCrypto or signature verification is unavailable. NEVER replace with unverified cookies, browser fingerprint, static QR or shared group password.
5. An owner account on a second device is not sufficient for kiosk access; possession of locally stored private key must be proven per QR issuance. This is a software key, NOT hardware attestation.
6. One open shift per employee enforced at DB unique index. Closed shifts immutable by default. Preserve audit log. Owner edits should be implemented as approved corrections, not overwrites.
7. Salary is preview only: integer kopeks, hourly snapshots per shift, no gross-to-net promises, no undocumented payroll deductions. Unknown shifts require human review.
8. Separate private salary responses from public group messages. Do not log photographs, full Telegram IDs, key materials or private employee information.
9. User explicitly does not want a scheduler, automatic reminders or GitHub Actions. Reports are invoked manually. Deploy only after secrets, data-localization, SDK and end-to-end testing.
10. Tests: `npm run check`, plus platform `tgcloud run`, `tgcloud migrate --dry-run` when connected. No automatic deployments.
11. AI interface: use typed commands in `tgcloud/lib/service.js`, tenant isolation and an explicit approval step for payroll and corrections. See `docs/AI_INTERFACE.md`.
12. Important: browser key stored in IndexedDB cannot prove physical location or block active QR relay. Don't claim otherwise.

13. P1: organization_memberships is additive. Never remove owner_tg_id UNIQUE without a verified migration and backup. listMyOrganizations is read-only; do not trust any orgId from a client. Existing owner-only functions must remain until fully tenant-scoped and tested (docs/BASELINE_AND_P1.md).

## P1: Tenant selection and backward compatibility

13. `organization_memberships` is additive; legacy owner (`organizations.owner_tg_id`) remains authoritative and cannot be demoted by a membership row.
14. `user_organization_selections` is a **preference only**, not proof of permissions. Every access must re-check active memberships and legacy ownership on the server. If more than one organization is available and none is explicitly selected, NEVER choose the first automatically.
15. A selected organization is NOT YET consumed by legacy owner-only commands. Do not expose an operational org switcher in Mini App or Telegram menu until the command/endpoint authorization context is migrated end to end. Managers and employees may select their own organization without receiving payroll or roles permissions.
16. `organizations.owner_tg_id UNIQUE` must NOT be removed in this PR. A separate reviewed migration with verified backup/restore is mandatory before true multi-business ownership.
17. Any new Telegram action touching an organization requires an explicit server-side organization scope and RBAC. Do not derive business access from group membership, chat titles, display name, or a client-supplied ID alone.
