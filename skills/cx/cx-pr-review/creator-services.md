# cx-creator-services supplement

Load when §0 fingerprints **cx-creator-services** (package name `cx-creator-services`; `mongoose` + `@qdrant/js-client-rest` in `package.json`; `src/db/qdrant/` exists). Main SKILL.md still governs — §3 lenses, §6 re-review, §8 output; this file supplies the stack mechanics (saas-server.md's Sequelize/MySQL content does NOT apply here). Bold names below are this repo's §5-style traps — cite them by name.

## Stack mapping (vs cx-saas-server, for contrast)

| Concept | cx-saas-server | cx-creator-services |
|---|---|---|
| ORM / DB | Sequelize + MySQL | Mongoose + MongoDB, plus **Qdrant** for vectors |
| Schema change | `migrations/*.js` | **No migrations.** Shape lives in the model file; reads must stay back-compat with old docs (missing/renamed fields → `undefined`, not errors) |
| Indexes | migration is source of truth | `schema.index(...)` is documentation only — `autoIndex: false` on every model; indexes created **manually in Atlas** |
| Tenancy | required `agencyId` in every `where:` | **None — single-tenant internal service.** Do NOT flag missing `agencyId`. Scoping keys are `platform` + `username`/`profile_id` — check those instead |
| Auth | Firebase + RBAC middleware | **No auth middleware** — every `/api` route is open (only wide-open `cors()` + `helmet`), including `/v2/internal/creator-pool`. A new route isn't a bug per se, but check it doesn't add destructive/exfiltrating surface (deletes, raw dumps) to an open port |
| Query verification | regenerate Sequelize SQL (saas-server.md) | No SQL generator. Reason about Mongo semantics (`$ne`/`$nin` with `null`, aggregation `$match` order) and Qdrant filter semantics instead |
| Soft delete | `paranoid` + `deleted_at` | Qdrant: `setPayload { is_active: false }`; Mongo: no global convention — check per-model |
| Layer pattern | Route→Controller→Zod→Service→Repo | Same shape: `src/modules/<name>/{routes,controllers,schema(s),services,repositories}` + `index.ts` barrel; singleton services/repos; controllers `try/catch → next(error)` |

## Checks by diff signal

### Mongoose models & indexes (diff touches a model file / `schema.index`)
- **Index no-op**: `schema.index(...)` does nothing at runtime (`autoIndex: false`) — the code lies about the schema until someone creates the index in Atlas. PR must call out the manual Atlas step. Audit drift with `npx ts-node src/scripts/diff-indexes.ts` — it covers **only Post, Comment, Profile, SearchLog**; other models are unaudited.
- **`$type` partial index nobody uses**: in `partialFilterExpression`, prefer `{ $exists: true }`. `$ne` is **rejected by MongoDB**; `$type` compiles but the optimizer only picks the index when the query *echoes* `$type` — a `{ $gte: … }` query silently skips it (Usage=0 in Atlas).
- **No-migration shape break**: field renamed/made required in the model → millions of old docs lack it, reads return `undefined` or throw. Read both shapes, or backfill first — no migration gate catches this.
- `lowercase: true` on any new username-like field; `timestamps: true, versionKey: false` convention kept.
- The `{platform, platform_id}` partial-unique index is documented in the model but **NOT enabled in prod** (duplicates) — don't assume it enforces.

### Qdrant (diff touches `src/db/qdrant/`, or adds a search/filter)
- **uuidv5 namespace drift**: the `toQdrantId` namespace constant must never change — it orphans every existing point. Blocker.
- **Embedding-dims change vs live collection**: model/dims are pinned (`text-embedding-3-large`, 3072). `assertVectorSize` **`process.exit(1)`s on boot** against a mismatched existing collection → total outage. A dims change = collection recreate + full re-embed, planned as its own migration.
- Named-vector sets (posts: `caption, visual, keywords, transcript`; profiles: `identity, bio`) are fixed — `ensureCollection` creates vectors only at collection birth; adding/removing one needs recreation.
- **Qdrant filter on non-indexed payload**: server-side filters are only safe on the startup `createPayloadIndex` fields — posts: `profile_id, platform, media_type, is_active, has_brand_mentions, published_at, language`; profiles: `profile_id, platform, username, is_active, follower_count`. Anything else scans the whole collection unindexed → add the payload index in the same PR; never remove an entry from these arrays. `language` needs `toLangCode` normalization and isn't backfilled on old points — no exact-match filter on it.
- **Partial upsert leaves stale vectors**: plain upsert only overwrites named vectors *present in the point* — a re-index that writes fewer vectors leaves stale `transcript`/`visual` behind. Delete-then-upsert (the `force` path's pattern) or always write the full set.
- `[]` sentinel embeddings (empty input) must be skipped, never stored as a vector.
- Multi-vector search keeps its resilience: throw only if ALL per-vector searches fail — an outage must not masquerade as empty results.

### AI pipeline (diff touches `src/shared/ai/**`)
- Vision stays **URL-only** — never download image bytes; `toCloudFrontUrl` host-swap preserved; batched vision maps results by the model-returned `index` (1-based), not array order.
- Transcription **streams S3 → /tmp** via `pipeline` (never `transformToByteArray` — keeps audio off the V8 heap), `unlink` in `finally`, fetched via S3 SDK (private objects work).
- `estTokens`: token-billed calls pass it; transcription (duration-billed) omits it → RPM-gate only.
- `tryReserve` stays one atomic check-and-reserve — never split into can-admit? + reserve.
- Scheduler retry rules: 429 → park (honors Retry-After); transient → bounded retry; **timeouts NOT retried** (caller owns).
- The three p-limits are the **only** concurrency gates (the scheduler throttles RPM/TPM, not concurrency): `VISION_CONCURRENCY` 7000, `TRANSCRIBE_CONCURRENCY` 1000, `PROFILE_CONCURRENCY` 370. New OpenAI call sites go through the scheduler + the right limiter.
- **Limiter/heap decoupling**: `PROFILE_CONCURRENCY` 370 ↔ `--max-old-space-size=3072` (~2.6 GB peak, ~7 MB/profile working set). Raising one without the other → OOM at load, fine in dev. Change both together.
- **Egress-branch resurrection**: `OPENAI_USE_EGRESS` is false forever — the `openai-egress` Lambda branches are dead code. Don't reason about them; flag any PR that revives them as the fix for a direct-path problem (fix the direct path).
- Embedding batching keeps BOTH bounds (2048 inputs, 250k cumulative tokens); transient errors retry the **same** batch (never split); 8000-token per-input truncation kept.

### Vectorize services (diff touches `vectorize-post.service.ts` / `vectorize-profile.service.ts`)
- Profile gate: skip re-embed if `sync_status.last_vector_sync` < 5 days (`PROFILE_VECTOR_MAX_AGE_MS`) unless `force`; success writes `last_vector_sync` back.
- Post gate: `enrichment.status === "complete" && !force` → skip (still counts as saved-to-Qdrant).
- `needsVision` stays in lockstep with the enrich arm: has `thumbnail` && (`force` || no `enrichment.image_description`).
- **Force-flag drift**: `force` must still delete the Qdrant point before re-upsert (clears stale named vectors); `transcription_source === "instagram_srt"` stays authoritative — never regenerated, even under `force`.
- Enrichment persisted via the two bulk `updateManyByIds` calls (complete/failed), not per-post writes.

### Env & config (diff reads a new env var)
- **`process.env` read bypasses cx-env**: every var goes in the `packages/cx-env/src/schemas/server.ts` Zod shape (or the lambda schema) and is consumed via `env.X` — a raw `process.env.X` read yields `undefined` at runtime instead of fail-fast boot validation. Required-vs-default is deliberate: required = `process.exit(1)` on boot in every environment until Doppler is updated. Cross-field rules go in `.superRefine`; `pnpm build:env` runs before tsc.
- Pipeline knobs surface through `src/config/indexing.config.ts`.
- `OPENAI_TIER` accepts only 1/2/4/5 — no tier-3 assumption.

### Deployment / EB (diff touches build layout, deps, `.platform`, `Procfile`)
- Entrypoint must stay `dist/src/server.js` — Procfile, Dockerfile, and buildspec all assume it. `instrumentation.js` is `--require`d at startup; a crash there kills boot.
- **Native module + EB prebuild hook**: the hook wraps `npm install` → `pnpm install --prod --frozen-lockfile --ignore-scripts` and skips `rebuild` — a new native dep (sharp/bcrypt/canvas) **fails silently in prod only** unless `.platform/hooks/prebuild/01_install_pnpm.sh` is updated in the same PR. Its pnpm pin must match `package.json` `packageManager`.
- Coupled limits kept in sync: nginx `client_max_body_size 50M` ↔ `express.json({limit:"50mb"})`; nginx 300s proxy timeouts ↔ long-running routes.

### HTTP layer & data patterns (diff touches routes/controllers/repos)
- **Raw-cased username query**: usernames are lowercased at every layer — Zod `.toLowerCase()`, model `lowercase: true`, repo `.toLowerCase()` on lookups. Model-level only fixes *writes*; a raw-cased query value silently misses existing rows.
- **Non-Zod error → blanket 500**: `error.middleware.ts` hardcodes 500 for everything non-Zod. A service throwing "X not found" expecting 404 must have the controller map message → status before `next(error)` (e.g. "Profile not found" → 404).
- Bulk writes use `{ ordered: false }` (one failure doesn't sink the batch); dup-key 11000 tolerated where intended; reported counts reflect actual writes (§5 success-theater applies unchanged).
- Pagination: hard-cap pattern (`Math.min(limit, 2000)`); creator-pool's `limit+1` probe for `hasMore` is fine — flag any new unbounded skip/limit.

## Verification one-liners

```bash
# Index drift code vs Atlas (only Post/Comment/Profile/SearchLog)
npx ts-node src/scripts/diff-indexes.ts
# Raw process.env reads bypassing cx-env
grep -rn "process\.env\." src/ --include='*.ts' | grep -v "cx-env\|NODE_ENV"
# Qdrant filter fields vs payload-index lists
grep -n "createPayloadIndex\|must:\|match:" src/db/qdrant/*.ts
# Username lookups missing toLowerCase
grep -rn "username" src/modules/*/repositories/ | grep -v "toLowerCase\|lowercase"
# OpenAI call sites outside the scheduler
grep -rn "openai\.\|client\.chat\|client\.embeddings\|client\.audio" src/ | grep -v "shared/ai"
```
