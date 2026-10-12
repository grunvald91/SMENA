# ServGo Business Memory — implementation plan (2026-10-11)

## Goal and hard boundaries

Existing attendance/QR/photo control must remain fully functional if the AI subsystem is disabled or its provider is unavailable. The system watches allowed work chats and offers a 7–14 day calibration review: owner confirms/rejects/corrects provisional findings before they become trusted business memory. No AI-initiated wage or hours changes.

All collection is **opt in** per bound chat, and ownership is checked in backend. This is a code-development branch, NOT deployed.

## Phases

| Phase | Deliverables | State |
| --- | --- | --- |
| A. Evidence collection | chat opt-in, group messages (including media file IDs), edited messages, user/anonymous reactions, bot-created photo references; dedupe | Implemented in branch; platform tests pending |
| B. Owner calibration | topic candidates, emoji meanings, 7/14 day review in private chat, confirm/reject/correct, provenance | Initial deterministic implementation in branch; not LLM-generated |
| C. Provider bridge | private gateway, upstream provider API, secure limited capability, grounded hypotheses, retry/idempotency and owner configuration | Implemented in source; gateway not deployed and upstream API not tested |
| D. Photo understanding | getFileContent, gateway multimodal provider, owner-permitted original JPEG fallback, source-backed observations | Implemented on demand in branch; not platform tested or deployed |
| E. Operational assistant | read-only tools for shifts, payroll previews, follow-up tasks, source links, permissions | Existing shift domain functions available; AI tools not connected |
| F. Reliability and release | tests, data protection decision, migrations, webhook sync, real Android/iOS validation, measured API cost | Pending |

## New components

- `tgcloud/lib/ai-rules.js`: pure Telegram evidence normalization, tentative topic grouping, redaction of obvious identifiers.
- `tgcloud/lib/ai-memory.js`: owner-only chat opt-in, event upsert, reaction state, review records and owner decisions.
- `tgcloud/lib/ai-media.js`: store references to bot-published photos which do **not** reappear as incoming message updates.
- `tgcloud/lib/ai-provider-contract.js`: limited external context, evidence validation, permitted image fallback; **does not send requests**.
- `tgcloud/handlers/{edited_message,message_reaction,message_reaction_count,callback_query}.js`: explicit Telegram updates.
- Five additive tables: `ai_chat_settings`, `ai_messages`, `ai_reactions`, `ai_reaction_totals`, `ai_findings`.

### First-stage operation

1. Add bot as an admin of an already-bound work group for reactions. Disable privacy mode if the business wants full ordinary message visibility; otherwise availability is incomplete.
2. Owner and group admin sends `/ai_on` **inside that bound group**. No other organization can opt in for this group.
3. Incoming eligible group messages and edits are deduplicated by (chat_id,message_id). Per-actor reaction state and anonymous reaction counts are stored separately. Existing messages before opt-in are not imported.
4. Owner sends `/ai_status` or `/ai_review 14` in a **private chat**. Review currently supplies keyword-topic and emoji-usage *candidates*, explicitly NOT neural analysis. Sampling caps and incomplete periods are disclosed.
5. Owner taps Confirm/Reject or sends `/ai_correct ID statement`. Confirmation changes review state, not attendance/payroll.
6. `/ai_off` inside group stops new ingestion; historical evidence remains retained for the owner. Deletion/retention controls are a later necessary phase.

## Security and correctness

- Data is tenant-scoped by the authenticated owner and chat-to-location binding. No employee access to reviews.
- Untrusted chat text never controls DB writes or provider instructions.
- Photo bytes are not stored by this phase; only Telegram file identifiers and message references.
- `chooseVisionImage` uses an original image if preprocessing fails **provided transfer is authorized**; technical preprocessing failure alone must not stop analysis.
- Model outputs will require actual referenced source IDs. It is NOT safe to infer payroll changes from chat discussion or from emoji.
- Basic redaction is only defense in depth; it does not make a text anonymous. Provider integration requires a vetted key/secret mechanism, endpoint access checks and a clear policy for full-image transfer.
- Telegram events have delivery and permission limitations. Monitor webhook and alert on missing group capture.
- Reaction IDs may represent real users; aggregated semantics need owner calibration.
- SDK `fetch` supports outbound HTTP but no deployed external provider key storage is established here.

## Release checklist

1. Run `npm run check`, `bash scripts/tgcloud_preflight.sh`, `npm run build`.
2. Review safe migration via `npx tgcloud migrate --dry-run --local`. Check indexes, table isolation, SQLite storage capacity and retention.
3. Run platform `tgcloud run` on synthetic group messages, edited events, per-user and anonymous reaction handlers, and reviews. Confirm no unexpected PII in logs.
4. Confirm Telegram BotFather privacy and admin permissions; run `tgcloud webhook sync` only after push to include `message`, `edited_message`, `message_reaction`, `message_reaction_count`, `callback_query`. Do not drop pending updates.
5. Test actual delivery on a phone, duplicate updates, media-group albums, queue loss and permissions.
6. Deploy via GitHub Codespaces + safe migration only after release gate; **do not run GitHub Actions**.

## Known gaps before calling this a complete AI assistant

The current review is a deterministic topic discovery prototype, not genuine model-driven business analysis. No external model invocation, automated 14-day schedule, image interpretation, evidence hyperlink UI, full chat search, retroactive edited/reaction reconciliation, voice transcription, model-cost tracking, incident tracking, dashboard cards, granular management roles, or payroll correction workflow is implemented yet. There is a 2000-message sampling cap in on-demand reviews, not a cap on event ingestion. These remain explicit follow-up tasks, not claimed functionality.

## Phase C update — model integration source (2026-10-11)

Added `tgcloud/lib/ai-batch.js`, `ai-gateway.js`, `ai-analyzer.js`, `tgcloud/endpoints/ownerAiAnalysis.js`, `gateway/server.mjs`, and Mini App owner settings. Actual OpenAI-compatible chat-completion requests are implemented by the separately deployed gateway. Gateway runs with model API keys in VPS environment; Telegram DB stores only a limited revocable capability. `https://ai.servgo.ru/v1/analyze` is the intended HTTPS endpoint, not verified live. See `gateway/README.md`.

A batch is at most 60 messages with stable, pseudonymous participant aliases, bounded/filtered text, existing confirmed/corrected memory, reply links and emoji reactions. The model returns hypothetical claims citing opaque `m1`–`m60` references. Actual source IDs are restored exclusively inside ServGo, reviewed by the owner in private chat. Tenant-scoped analysis progress is leased and retriable; deterministic batch keys avoid most duplicate findings. Model errors must not affect QR, photographs or payroll.

**Important deployment gate:** No real provider credentials, TLS for the planned gateway, safe migrations or end-to-end platform checks were available in this coding turn; no production deployment is claimed. The gateway must be provisioned and tested on synthetic data in Codespaces/VPS before publishing any of these changes. No Actions.

## Phase D update — vision and first calibration (2026-10-11)

New: per-owner photo permission, recent photo review UI, JPEG download through Telegram Serverless SDK, bounded original-file multimodal requests via /v1/vision and source-backed provisional AI findings. No actual provider has been contacted. First 14-day digest and weekly follow-ups are created in code: a due notification is dispatched on the next incoming message in an observed group, not on a guaranteed wall-clock schedule. Group conversations must have relevant webhook access. Code changes are not deployed and no production data was processed.

**Remaining before production:** run full Node test suite, CLI safe migration dry-run and Serverless run; set up real HTTPS on ai.servgo.ru and supply operator-held provider credentials to the VPS; confirm photos reach the gateway, inspect provider data retention, protect the original-photo option. Automated AI batch processing still requires a separate reliable background worker; currently the owner runs model batches from Mini App. Do not advertise this as completely unattended monitoring yet.

## Revised product contract — autonomous by default (2026-10-11)

The owner must **not** press "analyze messages", select photos, or manually initiate routine AI learning. These controls and public owner actions have been removed. After initial connection and explicit consent for original attachment transfer, the bot records incoming messages, edits, reactions and media references. Each observed event can invoke a bounded, rate-limited analysis worker automatically. A persistent media queue separates supported PDF, image, audio/voice and MP4 files from unknown formats. Unsupported types remain in awaiting_extractor; storing a file reference must not be represented as reading its content.

Changes to existing messages and reactions are queued for repeated analysis, including when the normal message cursor has advanced. The provider receives pseudonymous context plus previously confirmed, corrected and rejected owner conclusions. Model hypotheses always require known evidence. The 14-day review and weekly follow-ups proactively message the owner with inline confirm/reject controls and correction instructions. Owner confirmation, not owner initiation of processing, is the intentional interaction.

**Critical distinction:** Telegram Serverless handlers only wake on updates. A provider call started while processing a Telegram event is not a durable continuously running worker. Bot-originated photos can remain queued until the next observed update. The first 14-day digest may also be delayed when all chats are silent. Before calling this production-complete or guaranteeing strict delivery deadlines, provision a dedicated secure scheduler/worker on ServGo VPS (with controlled access to tenant jobs), a queue health dashboard, retries, alerts, and tests against real incoming Telegram events. Integration with the real provider, safe database migration and full Node tests are still pending.

## Agreed hybrid mode: threshold + Moscow-nightly + owner freshness (2026-10-12)

**Business behavior:** Telegram events are persisted as soon as they arrive, independently of LLM completion. Deep learning processes the queue when >=30 events/changes have accumulated. If fewer than 30 have accumulated during the day, it must still run once at night (default 03:00 Europe/Moscow), examining any remaining new messages. Empty nights should record a check without wasting model tokens. `lastNightlyDate` is written only when the entire deep queue has drained. The owner does not initiate the deep queue.

**Foreground questions:** the owner asks a normal question in the private Telegram conversation or uses `/ai <question>`. The bot snapshots current captured records and calls a dedicated `/v1/answer` gateway/model path using the newest 60 persisted messages, existing feedback and current backlog state. This is independent of `aiAnalysisProgress.cursorId` and DOES NOT advance that cursor. Actual source IDs stay in ServGo; the owner receives links. Unread attachments, incomplete deep analysis and a truncated recent sample are visible limitations, not hidden assumptions.

**Critical scheduler gap:** Telegram Serverless itself only runs handlers when an update arrives and Mini App endpoints when invoked by a user. The 03:00 clock rule is implemented in source code, but it currently executes **on the next eligible incoming event at or after the nightly deadline**. This DOES NOT satisfy a guaranteed wall-clock 03:00 nightly run or finish all backlog without incoming events. For production-level daily guarantees, build an authenticated VPS scheduled worker backed by a durable event mirror/shared datastore (see gateway README). Do NOT try to impersonate a Telegram Mini App user to call the protected endpoints; do not rely on Telegram sending bot-generated messages to the bot itself.

**Remaining verification:** test Node modules, gateway answer contract with real model, serverless callback timeouts, privacy and consent, migration and recurrence under silent chat. The branch remains DRAFT, not deployed.
