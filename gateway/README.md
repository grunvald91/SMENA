# ServGo AI gateway — setup and release gates

The new text and image model integrations are **implemented in source code but not published**. Telegram Serverless has SDK outbound `fetch`, but the model provider API key must not be placed in `tgcloud/`, in Git, or in Telegram chat history.

## Architecture

`Telegram Serverless / Mini App` → `https://ai.servgo.ru/v1/analyze` → `gateway/server.mjs` bound to `127.0.0.1:8791` → OpenAI-compatible provider (e.g. OpenRouter). `ai.servgo.ru` is a planned endpoint, not an assertion that DNS, reverse proxy or TLS are configured.

On the Serverless side, each owner-authorized batch consists of up to 60 stored messages. The text is bounded and obvious telephone/email/card/username identifiers and known employee names are redacted. Telegram chat IDs, Telegram user IDs, financial records, file IDs and real source identifiers are **not** sent externally; local `m1`–`m60` references are resolved to true message IDs only after response validation. Stable internal participant aliases allow continuity between batches without sending actual Telegram IDs. Redaction does **not** guarantee full anonymity.

Only a limited, revocable gateway capability is stored in the `ai_gateway_settings` Telegram database. The upstream provider key stays on ServGo's gateway host.

## Prepare provider gateway (trusted administrator)

Use Node.js 20+ on the trusted VPS, from the repository root. Do not use GitHub Actions.

1. Set up HTTPS on `ai.servgo.ru` with a reverse proxy to localhost port `8791`. Route **only** `/v1/analyze`. Avoid direct public access to `8791`.
2. Create a high-entropy capability. Example on your **trusted local/VPS terminal**, not in a chat:
   ```sh
   node -e "const c=require('node:crypto');const s=c.randomBytes(32).toString('base64url');console.log('CAPABILITY='+s);console.log('HASH='+c.createHash('sha256').update(s).digest('hex'))"
   ```
   Put only the resulting **HASH** in `AI_GATEWAY_CAPABILITY_HASHES` on the VPS. Keep the `CAPABILITY` private; put it **only** in the owner Mini App → Settings → AI business memory form. Do not send the capability through a Telegram message. Rotate both copies if it is exposed.
3. Set gateway environment:
   ```
   AI_GATEWAY_PORT=8791
   AI_GATEWAY_CAPABILITY_HASHES=<comma-separated SHA256 hex values>
   AI_GATEWAY_DAILY_LIMIT=40
   AI_PROVIDER_URL=https://openrouter.ai/api/v1/chat/completions
   AI_PROVIDER_KEY=<secret provider API key stored only on VPS>
   AI_PROVIDER_MODEL=<exact supported provider model ID>
   ```
   These values are placeholders, not real tokens or an assertion that the selected provider/model is available. Confirm HTTPS/provider contract before use. Do not commit an actual `.env`.
4. Start the service with `node gateway/server.mjs` under the server's supervisor. Grant the process only required network access.
5. In Telegram Mini App: owner opens **Settings → ИИ-память бизнеса**, supplies the limited gateway capability and connects. This endpoint requires validated Telegram `initData` and checks ownership server-side.
6. In the bound work group, owner/admin uses `/ai_on`; confirm message/privacy/reaction webhook subscriptions. After initial setup the observer schedules processing from each eligible event without a manual run button. Open `/ai_review 14` in private chat to review findings, then confirm/correct/reject.
7. Rehearse with **fictional employee data** first. Perform `npm run check`, safe SQLite dry run, platform `tgcloud run`, webhook sync, photo/QR regression and real device tests before production.

## Gateway security

- Requires a 32–256 character random bearer capability matching a SHA-256 hash stored in VPS environment. Rejected requests do not invoke provider.
- Fixed HTTPS destination on Telegram side; no user-provided arbitrary URLs.
- Maximum 60 messages, 1100 characters per text entry, bounded memory and reaction context. Gateway repeats structural validation.
- Response/proposed findings are untrusted and only evidence-bearing references are persisted as **proposed**, never confirmed automatically.
- Daily request quota per capability (default 40) and 15-minute identical-request response cache operate **in one process memory only**. They reset on restart and do not work across replicas. Introduce a durable central limiter before multi-instance production.
- No raw request bodies, upstream credentials or headers should be logged; review host access logs for inadvertent sensitive request bodies.
- No provider API calls before the owner explicitly configures an authorized gateway.
- Text and emoji-analysis integration is implemented in source. The separate photo review is now wired to a vision-capable model via /v1/vision, but is **not yet deployed or tested with a live provider**.

## Known limitations

- Incoming Telegram updates automatically trigger bounded analysis; there is no guaranteed-clock scheduler yet. For production autonomy even when groups are silent, run a supervised background worker outside Telegram Serverless with durable retry accounting.
- A revoked old active chat stops *future* collection; historical records remain until a deliberate deletion/retention workflow is built.
- Messages edited after the analysis cursor advances are not yet reprocessed automatically.
- Gateway capabilities are stored in the Telegram database (not the upstream model key). Validate platform DB residency, retention and operator access for actual Russian clients.
- A fast automatic quota works only on one process; provider spending must be controlled by external billing limits too.
- Final model availability, latency, quality and provider logging/retention terms have not been tested.
- A model can still produce wrong inferences even if every quoted message exists. The owner must verify conclusions, not just sources.

## Source references

- Telegram Serverless SDK: https://core.telegram.org/bots/serverless
- OpenRouter chat completions API: https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request

## Image analysis and calibration events

The owner Mini App now has an explicit switch allowing original JPEG transfer to the selected vision provider. After authorization, the owner can review the latest 20 photos separately. The code downloads JPEG bytes from Telegram Serverless, sends up to 8MB to the fixed ServGo gateway /v1/vision, and saves source-backed tentative observations. The bot does not reveal Telegram file identifiers or API keys to the model. Add AI_PROVIDER_VISION_MODEL to the gateway environment and configure the TLS reverse proxy for both /v1/analyze and /v1/vision, allowing up to 12MB POST bodies. Photo analysis is event-triggered without manual owner selection. Bot-originated photos can wait for the next group event before the worker wakes.

The first 14-day calibration digest is generated and delivered on the **first incoming message after the deadline**. Follow-up digests are due seven days later. Without a Serverless scheduler this is not an exact-clock task. The message uses available model findings and deterministic candidates, but model analysis currently requires the owner to start each batch in the Mini App. A quiet chat may delay the notification; an independent secure scheduler is needed for strict time guarantees.

## Autonomous mode — current implementation

The owner only connects the business chat and gateway once. The Mini App no longer has buttons to run a batch of text messages or individual photographs. On new eligible Telegram events, the bot persists text, replies, edits, emoji reactions and attachment references automatically; a rate-limited worker then advances text analysis or the oldest pending supported media item. Corrected or rejected insights become part of later model context. All model-created claims remain provisional until the owner agrees with the automatically sent cards.

The per-tenant media queue includes photo, PDF, audio/voice, video and other Telegram file events; MIME type, filename and file size are captured. JPEG images use the dedicated vision route. Supported PDF, PNG/WebP/JPEG documents, OGG/MP3/M4A/WAV audio and MP4 videos use the /v1/media route with a configured modality-capable provider model. Set AI_PROVIDER_AUDIO_MODEL and AI_PROVIDER_VIDEO_MODEL as needed, in addition to AI_PROVIDER_MODEL and AI_PROVIDER_VISION_MODEL. Unsupported archives, office files and other formats stay in awaiting_extractor, **not** analyzed. Media files exceeding the gateway limit are retried with backoff; a large-file path remains to be implemented.

Analysis runs because Telegram has delivered an update; this is not a durable wall-clock scheduler. Bot-published photos are queued immediately but may wait for the next incoming update before processing. If no messages arrive, queued data and the 14-day review may remain pending. The next production phase must provide a separately authenticated server-side scheduled worker with retries and monitoring. Do not describe event-triggered work as guaranteed continuous background processing until that worker is deployed and verified.

Owner reviews are now pushed proactively with confirm/reject buttons; opening /ai_review manually is optional. No owner intervention is required to select individual photos or launch routine model requests. Ongoing model costs, provider retention, consent to external transmission and actual Serverless timeouts have not yet been verified. This is source code only, NOT DEPLOYED.

PDF, voice/audio, images and video analysis now uses /v1/media as well as /v1/vision. Configure AI_PROVIDER_AUDIO_MODEL and AI_PROVIDER_VIDEO_MODEL to enable the corresponding provider modalities; no model support is assumed without a live integration test. Unsupported formats are queued for future extractors. Actual content understanding has not been verified in production.

## Fresh answers vs nightly learning (October 2026 architecture)

Two AI paths intentionally coexist:

- **Foreground:** in the owner's private bot chat, any plain-language question or `/ai <question>` reads the latest captured raw events in Telegram Serverless, confirmed/rejected learning context and unread-media status. It sends a bounded 60-item source-mapped context to `POST /v1/answer`. The model returns a grounded answer immediately after that query completes; this does not advance or depend on the background cursor. When the context is truncated or files remain unread, the answer explicitly discloses this. The provided owner question is not stored as a workplace event.
- **Background:** event-driven deep memory processes a batch after at least 30 new events/changes. At/after 03:00 Europe/Moscow, even a smaller nonempty backlog qualifies for the nightly pass. Once the whole queue drains, `lastNightlyDate` marks the completed Moscow calendar day. An empty queue needs no billable provider call.

**Operational limitation:** `/v1/answer` is coded but not deployed. The event-driven nightly rule only wakes on Telegram updates. To GUARANTEE daily analysis in a silent group, the VPS must run a 03:00 Moscow scheduled worker with durable access to a mirrored ingestion/event queue and sync its results to authoritative ServGo memory. The Serverless database is NOT remotely readable by the VPS in the current architecture, and Mini App endpoints validate Telegram user identity, so the gateway currently cannot invoke a scheduled database job directly. Do not claim unattended wall-clock daily analysis until that bridge and scheduler are built, tested and deployed. Queue and downstream provider calls must be individually retried and idempotent.

A suitable operational cron expression is `0 3 * * *` with the process timezone set to `Europe/Moscow`; by itself it does not provide the authenticated data bridge. Do not place API credentials in the crontab line or commit them. Verify the real VPS timezone, Telegram event-lag, and monthly model billing caps before enabling the schedule.


## One-time historical context recovery (Serverless-only phase)

Do **not** add a VPS scheduler or background cron in this phase. Telegram Serverless is the sole event trigger; the model gateway only proxies credential-protected provider calls. A "nightly" analysis after 03:00 Europe/Moscow requires a subsequent Telegram event; no clock-time guarantee is offered while all observed chats are silent.

The model is now asked to return `needs_previous_context` when the present 30–60 events do not explain the business situation. The ServGo handler then loads **one** prior page (maximum 30 previous events in total across active work chats, no cross-tenant reads) and sends a **single** follow-up model request with `previousContext: [{ref:'c1',...},...]`. Primary events remain `m1..m60`. The model response is always final after that: no recursive history queries, no extra model passes. For fully unresolved questions, the owner sees a statement of uncertainty, not a confident diagnosis. Unresolved deep batches are persisted separately as `status='unresolved'` and excluded from confirmed business knowledge.

**Scope:** previous-message recovery applies to deep chat analysis and owner free-text questions, rather than causing every individual media upload to be analyzed twice. The old messages are explanatory context; newly proposed deep findings must also cite a primary source. These extra model calls count toward the gateway's existing provider quota.

Full Node suite, Serverless SDK migration, model contract and live provider checks remain release gates. This branch is still not deployed.
