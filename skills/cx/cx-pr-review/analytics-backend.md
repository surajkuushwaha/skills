# cx-analytics-backend supplement

Load when §0 fingerprints **cx-analytics-backend** (package name `cx-analytics-backend`; `bottleneck` + `axios-retry` + `openai` in `package.json`, **no ORM/DB driver**; `constants/onSocial.constant.js` exists; `client/creator-service/`). Main SKILL.md still governs — §3 lenses, §6 re-review, §8 output; this file supplies the stack mechanics (saas-server.md's Sequelize/MySQL and creator-services.md's Mongo/Qdrant content do NOT apply here). Bold names below are this repo's §5-style traps — cite them by name.

**Identity:** stateless Express gateway to third-party social-analytics providers (Instagram/YouTube/TikTok/Facebook/X via RocketAPI/SocialAPI/HikerAPI/OnSocial/Modash/HypeAuditor/Ylytic), enriched with OpenAI, **owning no database** — all persistence is HTTP calls to cx-creator-services. Review it as a provider-orchestration layer, not a DB service.

## Stack mapping (vs the other repos, for contrast)

| Concept | cx-saas-server / cx-creator-services | cx-analytics-backend |
|---|---|---|
| DB / ORM | Sequelize+MySQL / Mongoose+Mongo+Qdrant | **None.** "Save"/"fetch" = axios to creator-service (`helper/storage.js`, `client/creator-service/creator-service.client.js`, 270s timeouts). A PR that "changes what's stored" → the real schema review belongs in **cx-creator-services**; here check only payload shape vs that repo's contract |
| Schema change | migrations / model files | N/A — check cross-repo payload compat instead (§2 Cross-repo contract in SKILL.md) |
| Tenancy | `agencyId` / `platform`+`username` | **None — zero tenant key in the codebase.** Do NOT flag missing `agencyId`. Scoping is social identifiers (`username`, `user_id`, platform). `userEmail`/`userName` in schemas is PostHog attribution, not authz |
| Auth | Firebase+RBAC / none | **No auth middleware at all** — every route `@access Public`; only `cors()`+`helmet()` in `index.ts`. Exception: `packages/mcp-server` has its own secret gate. New route isn't a bug per se, but flag destructive/exfiltrating/costly surface (paid provider calls, S3 writes, Lambda invokes) added to an open port |
| Language | TS / TS | **Mixed JS+TS ESM, mid-migration.** New files MUST be `.ts` (CLAUDE.md rule); ESM imports use `.js` extension even for `.ts` targets. Legacy giants stay JS (`instagram.service.js` 108KB, `provider.controller.js` 78KB) |
| Validation | Zod as middleware/schemas | Zod, but **inline in controllers** (`schema.parse(req.body)`), not route middleware. Schemas live in `schemas/` (plural). **`schema/` (singular) is provider response-shape constants — different dir, easy to misfile** |
| Async offload | SNS→cx-worker / in-process | **No SNS/SQS.** Async = in-process `Promise.allSettled` fan-out, or invoke of `cx-media-downloader` Lambda (`serverless.yml`, separate deploy) |
| Env | dotenv / cx-env | `@culturex-art/env` (`packages/cx-env`) — Zod-validated, Doppler-backed. Raw `process.env.X` in app code is a bug (undefined at runtime, bypasses boot validation) |

## Checks by diff signal

### Provider fan-out / batch endpoints (diff touches a controller with `Promise.allSettled` — 36 call sites)
- **Rejection-to-null masking**: dominant repo pattern maps `allSettled` rejections to `null` entries in the response `data[]` — caller can't tell "not found" from "provider 500". New/changed batch endpoints must surface failures distinctly (per-item status, or `succeeded`/`failed` split). §5 success-theater applies with extra force here.
- **Uncapped fan-out**: `usernames.map(fetch)` has no concurrency cap — Bottleneck limits per-provider rate, not per-request parallelism. Check the Zod array cap exists (`.max(20)` pattern) on any new batch input.
- Retry cost: each provider call is **paid**; a retry loop or double fan-out multiplies real spend, not just latency.

### Symmetric provider paths (diff touches `services/<platform>/` or `client/<platform>/providers/`)
- **Three-way symmetric-fix gap**: Instagram logic exists in triplicate — `...UsingRocketAPI` (24 sites), `...UsingSocialAPI` (35), `...UsingHikerAPI` (26), selected by a `provider` enum. A fix/field-add on one backend almost always needs the same change on the other two. Grep all three suffixes before accepting a single-path fix. Same applies to Modash/OnSocial/HypeAuditor branches in `provider.controller.js`.
- Provider response fields are upstream-cased (mixed snake/camel) — normalization must happen at one layer, not ad-hoc per path.

### Cross-service persistence (diff touches `helper/storage.js`, `client/creator-service/`, `routes/database.routes.ts`)
- Payload field names/shape must match cx-creator-services' Mongoose models and Zod schemas — verify on **both** sides (SKILL.md §4 cross-repo contract). Usernames must be lowercased before sending (creator-services' raw-cased-query trap propagates from here).
- `routes/database.routes.ts` is a **transparent reverse-proxy** to creator-service — any route added under `/api/database/*` exposes that internal surface publicly through this service.
- 270s client timeouts: a handler awaiting one of these calls holds the HTTP request up to 4.5 min — check ALB/nginx timeout alignment and whether the work should return `202` instead.

### OpenAI / brand-bot (diff touches `helper/brand-bot/`, `helper/sentiment/`)
- `OpenAIKeyManager` state (per-minute counters, `setInterval` resets) is **per-process** — EB runs multiple instances, so rate accounting is per-instance; don't accept logic assuming global limits.
- `loadIndustryVectorStoreMap()` runs at boot in `index.ts` — a change that makes it throw kills startup on OpenAI outage. New boot-time side effects need a failure story.
- LLM output mapped to enums/categories → §5 LLM-key-mismatch trap applies unchanged.

### Response shape (diff adds/changes an endpoint)
- **No standard envelope** — three coexist: `{ data }`, `{ success: true, ... }`, `{ success: false, result: err.message }`. Don't block on legacy, but a *new* endpoint should pick one deliberately and match its closest siblings; flag a fourth variant.
- Error middleware (`middleware/common.middleware.js`) maps axios/Zod/`PROFILE_ERROR`, else blanket 500 — a service throwing "not found" expecting 404 needs the message→status mapping wired. Note the middleware calls `next(err)` **after** responding (pre-existing; don't let new code depend on post-response handlers running once).

### Env & config (diff reads a new env var)
- Var goes in `packages/cx-env` Zod schema, consumed as `env.X` — raw `process.env.X` read is a bug.
- **Per-person key pools**: env names like `ROCKET_API_<NAME>`, `YOUTUBE_API_KEY_<NAME>_BACKUP` are individual-coupled rotation pools — adding/removing one must update the rotation list in the same PR or a pool member silently drops.

### Lambda (diff touches `lambdas/cx-media-downloader/`, `serverless.yml`)
- Separate package.json + esbuild + Serverless deploy (GitHub Action `deploy-lambdas.yml`) — main-service deps/build changes don't reach it and vice versa; a shared-code change needs both deploys.
- IAM statements use `Resource: '*'` — new permissions should scope down, not extend the wildcard.

### Deployment / EB (diff touches Dockerfile, `.platform/`, `Procfile`, buildspec)
- Multi-stage pnpm Docker on EB; `.platform/hooks/prebuild/01_install_pnpm.sh` pnpm pin must match `package.json` `packageManager`. nginx conf ↔ `express.json({limit:"50mb"})` limits coupled.
- `/api/long-wait` (`setTimeout 298000` in `index.ts`) is a deliberate ALB-idle-timeout probe — not dead code; don't accept its removal as "cleanup" without confirming the ALB config no longer needs it.

## Verification one-liners

```bash
# Symmetric provider paths — did the fix land on all three?
grep -rn "UsingRocketAPI\|UsingSocialAPI\|UsingHikerAPI" services controllers | grep "<changed-fn-stem>"
# Raw process.env reads bypassing cx-env
grep -rn "process\.env\." controllers services helper routes utils middleware --include='*.js' --include='*.ts'
# allSettled sites whose rejections vanish into nulls
grep -rn -A3 "allSettled" controllers | grep -B1 "null"
# New route surface (everything is public)
git diff <base>..HEAD -- routes/ index.ts
# Payload contract vs creator-services (run in THAT repo)
grep -rn "<field>" ../cx-creator-services/src/modules/*/schemas ../cx-creator-services/src/models 2>/dev/null
```
