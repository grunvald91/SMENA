# Production vs GitHub — audit 2026-10-18 (ServGo Смена)

Read-only audit of `155.212.162.47` (workflow `server-sync-audit` in `booking_bot`, run 39147676931).

## QR screen `smena.servgo.ru` (`/var/www/smena-servgo/current`)

The kiosk build is reproducible (`npm run build:kiosk`), so the served bundle was matched by rebuilding
branches and comparing hashes:

| served file | built from |
|---|---|
| `assets/index-DRBLflUW.js` (referenced by `index.html`) | `feat/org-access-foundation-20261011` @ `3f44867` (draft PR #8) |
| `assets/index-g_x2CkD6.js` (left over, not referenced) | `main`, `fix/mobile-miniapp-overflow-20261014`, `feature/ai-business-memory-20261011` |
| `assets/index-QhTWRkSg.css` | all of the above |

**Production serves the QR screen from draft PR #8**, which is marked "do not merge or deploy" until its
release gates pass. `main` does not contain that code. Nothing was merged or changed here; this file only
records the state. Either finish PR #8's gates and merge it, or redeploy the kiosk from `main`.

`nginx/smena-servgo.conf` is the enabled site (static files, strict CSP, no proxying).

## Telegram Mini App and bot

They run on Telegram Serverless (tgcloud), not on this server, and were not audited (no tgcloud access from
the audit). Compare with `npx tgcloud status` / `diff` before the next deploy.
