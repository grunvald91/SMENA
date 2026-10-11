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
6. In the bound work group, owner/admin uses `/ai_on`; confirm message/privacy/reaction webhook subscriptions. In owner Mini App, run **Анализировать следующую порцию**. Continue until backlog is empty. Open `/ai_review 14` in private chat to review findings, then confirm/correct/reject.
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

- No automatic scheduler yet: one explicit owner action analyzes up to 60 messages. This is an intentional bounded first connection to validate model results and API costs. At larger scale, run supervised background jobs outside Telegram Serverless with durable retry accounting.
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

The owner Mini App now has an explicit switch allowing original JPEG transfer to the selected vision provider. After authorization, the owner can review the latest 20 photos separately. The code downloads JPEG bytes from Telegram Serverless, sends up to 8MB to the fixed ServGo gateway /v1/vision, and saves source-backed tentative observations. The bot does not reveal Telegram file identifiers or API keys to the model. Add AI_PROVIDER_VISION_MODEL to the gateway environment and configure the TLS reverse proxy for both /v1/analyze and /v1/vision, allowing up to 12MB POST bodies. Photo analysis is owner-triggered, not an unattended background worker.

The first 14-day calibration digest is generated and delivered on the **first incoming message after the deadline**. Follow-up digests are due seven days later. Without a Serverless scheduler this is not an exact-clock task. The message uses available model findings and deterministic candidates, but model analysis currently requires the owner to start each batch in the Mini App. A quiet chat may delay the notification; an independent secure scheduler is needed for strict time guarantees.
