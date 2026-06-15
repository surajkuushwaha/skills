---
name: cx-pr-review
description: Review or re-review any PR on the current branch of cx-saas-server. Use when the user asks to "review the PR", "re-review", "audit changes", "check the diff", verify a fix, or check what's still pending before merge. Combines a first-principles review framework with a router that pulls in deeper checks based on the files changed, plus a library of CultureX-specific traps that have actually shipped (paranoid+CASCADE, MySQL partial index, agencyId scoping, MySQL↔Mongo cross-store refs, sync-LLM-in-handler, side-effect gating, prod-backfill normalization, unbatched mega-UPDATE, symmetric-fix gaps, stuck background tasks, …). Detects the repo's stack first (§0) so it works on non-Sequelize/non-MySQL CultureX repos too (Mongo-only, Prisma, Postgres, TypeORM, no-ORM) — stack-specific traps stay conditional, the universal lenses always apply. Reviews stay thorough, adapt to the diff, output a plain no-emoji findings file, and stay consistent across sessions.
---

# CultureX PR Review

## How to use this skill

**You are the reviewer. This skill is a companion, not a substitute for your own judgment.**

It gives you three things:
1. A **reasoning framework** (§3 Independent analyses) to apply to *any* PR, in any domain.
2. A **router** (§2) that maps "what the diff touches" → "which deeper checks to pull in." This is how the review adapts to the PR instead of running the same boilerplate every time.
3. A **trap library** (§5) of bugs that have actually shipped in *this* codebase, so you don't re-discover them the hard way.

Operating rules:
- **Checklists are a floor, not a ceiling.** Reason from first principles about *this specific change* first; then cross-check against the lists. The lists catch what you'd forget — they do not bound what you should look for. The highest-value findings are usually the edge case nobody has written a checklist for yet.
- **The trap library is examples, not the whole job.** Pattern-match against it, but a PR can be perfectly free of every listed trap and still be broken. Conversely, when you find a *new* recurring class of bug, add it (see §9 Keep the skill learning).
- **Adapt to the diff.** A docs-only PR doesn't need the SQL generator. A cron PR needs idempotency thinking the trap table only hints at. Spend effort where the risk is.
- Flag **real bugs, risks, and design problems**. Don't nit-pick style. See §8 (What to skip).
- **Adapt to the stack, not just the diff.** This skill was written against cx-saas-server (Express + Sequelize + MySQL, with Mongo via Creator Service). Many CultureX repos don't share that stack — cx-worker, cx-creator-services, analytics, pdf-gen, or any Mongo-only / Prisma / Postgres / TypeORM / no-ORM service. **Run §0 first, then apply only the checks that match what's actually there.** The §3 lenses are universal; the stack-specific traps (§4 Migration, §5 MySQL/Sequelize rows, the SQL generator) only apply where that stack is present. Don't flag a missing `agencyId` Sequelize pattern in a repo that has no Sequelize — find that repo's equivalent and check *that*.

## 0. Detect the stack (do this once, first)

Don't assume MySQL/Sequelize. Cheaply fingerprint the repo, then gate the stack-specific checks:

```bash
# ORM / DB driver in play
grep -iE '"(sequelize|prisma|typeorm|mongoose|mongodb|knex|drizzle|pg|mysql2?)"' package.json 2>/dev/null
ls migrations prisma 2>/dev/null; ls **/schema.prisma 2>/dev/null
# Tenancy / auth convention (what plays the role of agencyId / rbac.config)
grep -rIlE 'agencyId|tenantId|orgId|workspaceId|accountId' src 2>/dev/null | head
grep -rIl 'rbac|checkRBAC|authorize|can\(' src middleware 2>/dev/null | head
```

Map what you find to the right lens — the **principle** is constant, only the mechanism changes:

| Concept | cx-saas-server (default) | If the repo uses… |
|---|---|---|
| Schema change | Sequelize `migrations/*.js` | Prisma `schema.prisma` + `prisma migrate`; TypeORM migration; Mongo has none — shape lives in code, so check back-compat of reads on old docs |
| Tenant scoping | required `agencyId` in `where:` | whatever key fingerprinting found (`tenantId`/`orgId`/`workspaceId`); Mongo filter must carry it too |
| The "zero rows on MySQL" trap (§5 `Op.notIn:[null,""]`) | Sequelize+MySQL only | N/A on Mongo/Postgres — **skip it**; for Mongo check `$ne`/`$nin` with `null` semantics instead |
| `paranoid` soft-delete + CASCADE | Sequelize `paranoid` | Prisma has no soft-delete built in (check a `deletedAt` filter is applied everywhere); Mongo `isDeleted` flag consistency |
| Partial-index / charset / FK-width | MySQL DDL | Postgres supports partial indexes (so that trap *inverts* — they DO work); Mongo: index definitions in code, TTL/compound correctness |
| The SQL generator (§7) | Sequelize→MySQL SQL | Prisma: read generated SQL via `prisma` query logging; raw Mongo: reason about the aggregation pipeline / `$match` instead |

If none of the stack-specific rows apply, the review is §3 lenses + §2 generic rows (RBAC, idempotency, N+1, contract, error-handling) + whatever §5 traps are framework-agnostic (success-theater, field-shape, sync-LLM-inline, N+1, symmetric-fix gap, stuck-task). That's still a thorough review — the universal lenses carry it.

## 1. Scope the diff & understand intent

Run in parallel:

```bash
git log main..HEAD --oneline
git diff main..HEAD --stat
git status --short
gh pr view --json title,body,number 2>/dev/null || true   # PR title/description if a PR exists
```

Then, **before reading code line-by-line, answer:**
- **What is this PR trying to do?** (from title/body/commits/linked ticket) — you can't judge correctness without knowing intent.
- **What's the blast radius?** New feature in one module vs. a change to shared middleware, a model, RBAC config, or a cron — the latter can break unrelated features.
- **Which of the categories below does it touch?** Classify each changed file:

| Category | Typical paths |
|---|---|
| **Migration** | `migrations/*.js` |
| **Model** | `packages/cx-datastore/src/models/*.model.ts`, `registry.ts` |
| **Repository** | `packages/cx-datastore/src/repositories/**`, `src/modules/*/repositories/*` |
| **Service** | `src/modules/*/services/*`, legacy helpers in `helpers/` |
| **Controller / Route / Schema** | `src/modules/*/{controllers,routes,schemas}/*`, legacy `controllers/*.js`, `routes/*.js`, `schemas/*` |
| **Auth / RBAC / Middleware** | `middleware/*`, `config/rbac.config.js` |
| **Cron / Background job** | `cron/**`, `src/modules/cron/**` |
| **Cross-repo contract** | SNS publishes, SQS payloads (→ cx-worker), calls to cx-creator-services / cx-analytics-backend / cx-pdf-generation |
| **Config / Infra** | `config/*`, env usage, build/deploy scripts |
| **Docs** | `*/docs/**/*.md`, `project_overview.md` |
| **Data backfill / DML** | one-off `*.sql`, raw `sequelize.query` UPDATE/INSERT run against prod |
| **Spec the code implements** | a formula/PRD/scoring doc + the aggregation/ranking code that must match it |
| **Test** | `test/**`, `*.test.*` |

The category determines which §4 checklist and which §2 router rows apply.

## 2. Context-trigger router — pull in deeper checks by what you see

This is the "checklists based on PR context" engine. Scan the diff for these signals; when present, run the linked checks. Order is by how often these bite.

| If the diff contains… | Then also verify (and read §4/§5 entries) |
|---|---|
| a tenant-scoped model query (`where:` without `agencyId`) | Multi-tenant scoping (§4 Repository); every finder takes a **required** `agencyId` and applies it. A finder without it is a cross-tenant leak — treat as a blocker. |
| an ID coming from `req.body`/`req.query` used in a query | Cross-tenant + cross-scope validation: the entity belongs to caller's `agencyId` **and** the URL's `account_type`/RBAC scope (§5 cross-tenant gap). |
| a new/changed migration | §4 Migration: charset, partial-index trap, FK widths, CASCADE-vs-paranoid, reversible `down`. |
| `paranoid: true` anywhere near it | CASCADE won't fire on soft-delete → orphan cleanup wired? `bulkCreate({ ignoreDuplicates: true })` silently skips conflicts? `{ paranoid: false }` needed for a read? (§5 paranoid traps) |
| `Op.not`, `Op.notIn`, `Op.is`, `Op.or` with NULL, or a JSON-path `where` | **Regenerate the SQL** (§6/§7 SQL generator). `NOT IN (NULL, …)` / `!= NULL` on MySQL → zero rows. |
| a Mongo `_id` stored in MySQL (or vice-versa) | Cross-store ref width (`STRING(24)`/`CHAR(24)`), and field name reflects what's stored (not `postUUID` for an `_id`). (§5) |
| `bulkCreate` / `bulkUpdate` / `Promise.allSettled` / batch loops | Returned success counts reflect **actual writes**; rejections surfaced not swallowed; field shape consistent across paths. (§5 success-theater, field-shape) |
| an `await` to OpenAI/LLM/HTTP/heavy Mongo inside an HTTP handler | Move to SNS→cx-worker or respond `202` + background; check idempotency on retry. (§5 sync-job) |
| a new/changed route | RBAC wired (`checkRBAC`/module-specific variant), module name matches `config/rbac.config.js`, Zod on body/query/params, standardized response shape, public route intentional. (§4 Controller) |
| a change to `config/rbac.config.js` or `middleware/` | Blast radius across **all** modules using that key; role arrays still correct; field-level visibility (`CREATOR_FIELD_VISIBILITY`) consistent. |
| a static `Model.update(...)` then a return of a previously-fetched instance | Stale in-memory instance — re-fetch or mutate or assert `affectedCount`. (§5) |
| a controller→service refactor / extraction | Side-effect gating drift: were Mixpanel/audit/analytics events gated behind the same early-return the old code had? (§5) |
| a `.ts` file with `eslint-disable @typescript-eslint/no-explicit-any` | JSON-key typos hidden by `any` (`advancedData` vs `advanceData`); audit `?? d?.foo_typo` fallbacks. (§5) |
| file upload / Multer | DB payload column actually written (not the Multer field object); Zod schema includes the column. (§5) |
| money / credits / payments / webhooks | Idempotency keys, transaction boundaries, no double-charge on retry, amounts in the right unit, webhook signature verified. Reason hard here — the trap table only hints. |
| a new external API call (creator-services / analytics / 3rd-party) | Rate limits, timeouts, error handling, caching strategy, N+1 (one call per item in a list endpoint → batch it). (§5) |
| LLM prompt + a mapping/enum of its output | Prompt category strings exactly match the mapping keys; accept both defensively. (§5) |
| a date/time, timezone, or cron schedule | TZ assumptions, DST, cron overlap/re-entrancy, "today" computed server-side vs. tenant-side. |
| a spec/PRD/formula/scoring doc the code must implement (aggregation, weighted average, ranking) | Reproduce the doc's own worked examples against the code; check the **denominator per segment** and that distributions **sum to ~100%**; confirm a fix landed on **every** parallel branch, not one. (§5 symmetric-fix gap) |
| a raw `.sql` / DML backfill or data migration (esp. run on prod / a large table) | §4 Data backfill: normalization parity with the app's matching logic, batch large UPDATEs by PK range, `deleted_at` filter, idempotent/resumable, EXPLAIN + collation. (§5 backfill traps) |

If a signal isn't in this table, that's expected — fall through to §3 and reason it out yourself.

## 3. Independent analysis lenses (apply to EVERY PR)

The checklists are memory aids for known traps. **These lenses are how you find the unknown ones.** For each meaningful change, trace it through these — out loud in your notes, not silently:

1. **Correctness / intent** — does the code actually do what the PR says? Walk the happy path, then the empty/zero/null/one/many cases. What's the off-by-one, the empty array, the `undefined` key?
2. **Data integrity** — can this leave the DB inconsistent? Partial writes without a transaction? Orphans? Lost updates? Wrong counts reported to the user?
3. **Multi-tenancy** — is every query scoped to `agencyId`? Can caller A read/write caller B's data via a guessed/known ID, slug, or UUID?
4. **AuthZ / security** — RBAC on the route? Can a lower-privileged role reach a higher-privilege path? Input validated (Zod)? Injection (SQL via raw, NoSQL, path, SSRF on a URL param)? Secrets/PII in logs or responses?
5. **Concurrency / idempotency** — what if this runs twice (retry, double-click, redelivered SQS)? Race between read-modify-write? Does a unique constraint or transaction protect it?
6. **Performance / scale** — N+1 queries or N+1 service calls? Unbounded list in a request body or response? Missing index for a new `where`/`order`? Sync work that should be async?
7. **API / contract & backward-compat** — response shape changed for existing clients (dashboard/partners)? Field renamed without migration of callers? Nullable became required?
8. **Error handling / observability** — failures swallowed (`catch {}`, `.filter('fulfilled')`)? Does success get reported when work silently didn't happen? Are errors actionable?
9. **Blast radius** — shared model/middleware/config/cron change: what *else* consumes this? Did the fix to path A regress symmetric path B?

End each lens by explicitly asking: **"What's the worst input or timing that breaks this, and is it handled?"** That question, not the checklist, is where the critical bugs come from.

## 4. Per-category checklists (the floor)

Run the ones matching §1 classification. These are generalized — they apply across modules, not just the feature they were first written for. **The Migration, Model, and Repository checklists below assume Sequelize+MySQL** (per §0) — on a different stack, keep the *intent* (schema back-compat, tenant scoping, success-counts-reflect-writes) and drop the Sequelize/MySQL mechanics. Service, Controller/Route, Auth/RBAC, Cron, Cross-repo, Docs, and Data-backfill are largely stack-agnostic.

### Migration (`migrations/*.js`) — Sequelize+MySQL; on Prisma/TypeORM/Mongo check the equivalent (§0)
- [ ] Charset `utf8mb4`, collate `utf8mb4_unicode_ci`
- [ ] **Partial-index trap:** `where: { deleted_at: null }` on `addIndex` is **silently dropped on MySQL** (Postgres-only). Combined with `paranoid` + `bulkCreate({ ignoreDuplicates: true })`, re-creating a soft-deleted row silently fails (caller gets `success: true`, zero writes).
- [ ] FK column widths: Mongo `_id` refs are `STRING(24)`/`CHAR(24) CHARACTER SET ascii COLLATE ascii_bin`, not `STRING(255)`
- [ ] `ON DELETE CASCADE` only fires on **hard** delete — if parent is `paranoid`, cleanup must be wired explicitly (see Model)
- [ ] Table name follows its family convention (e.g. ProfileMonitoring-owned tables start with `profile_*`)
- [ ] No orphaned/renamed index — `addIndex` with a new name does **not** drop the old one
- [ ] `down` actually reverses `up` and is idempotent

### Model (`packages/cx-datastore/src/models/*.model.ts`)
- [ ] Indexes: the **migration** is the schema source of truth, not `init()`. A missing `indexes: [...]` array is **not** a bug (only ~18/128 models declare one; `sync()` isn't used in prod). If the model already declares indexes, mirror new ones there; don't add a lone index to a model that declares none (it implies it's the only one). FK-index naming: MySQL auto-creates an FK index named after the column *only when no usable index exists* — an explicit `idx_<table>_<column>` pre-empts it, so there's no duplicate (don't claim one without checking `SHOW INDEX`).
- [ ] Every `belongsTo` has the matching `hasMany`/`hasOne` on the parent (`Agency`, `Tags`, etc.)
- [ ] **Alias collisions** — check existing aliases before adding `hasMany`/`hasOne` (e.g. `"post_labels"` taken)
- [ ] If model is **not** `paranoid` but parents are, confirm cleanup on parent soft-delete: `Tags.relatedModels[]`, `Agency.associations[]` (`hooks: true` loop), or explicit `Model.destroy` in the parent's `deleteWithRelations`
- [ ] Registry export added (`registry.ts`); `tableName` matches the migration exactly
- [ ] Dead columns flagged (no read/write call sites)

### Repository (`**/repositories/*`)
- [ ] **Multi-tenant scoping:** `agencyId` on every `where:` for tenant-scoped models; finders take it as a **required** param
- [ ] **Cross-tenant input validation:** IDs from `req.body` verified against `agencyId` *and* the URL's `account_type`/scope
- [ ] **Success counts reflect real writes** — `bulkCreate({ ignoreDuplicates: true })` skips conflicts silently; return the inserted count, not payload length
- [ ] `Promise.allSettled` rejections inspected, not stripped and reported as success
- [ ] Transactions when multiple tables change together
- [ ] `{ paranoid: false }` passed when soft-deleted rows must be visible
- [ ] Repository singleton pattern matches existing (`module.exports = new Repository()`)

### Service (`src/modules/*/services/*`, `helpers/`)
- [ ] **Field-shape consistency** across code paths — path A pushes strings, path B pushes objects → downstream `.map(x => x.name)` yields `undefined`s
- [ ] **No sync LLM/external/heavy calls** in the request path — SNS→cx-worker or `202` + background
- [ ] **Idempotency** on retry-prone work (LLM, payments, webhooks, SQS consumers)
- [ ] Side-effect gating preserved across controller→service refactors (events fire under the same condition as before)
- [ ] Static `Model.update` followed by returning a stale instance → re-fetch / mutate / assert `affectedCount`
- [ ] Services accept specific params (`agencyId`, `userId`, `role`), not whole `req`/user objects

### Controller / Route / Schema
- [ ] Zod validation on `req.body`, `req.query`, `req.params`
- [ ] Field names match what they store (`postUUID` shouldn't hold a Mongo `_id`)
- [ ] `type`/`agencyId`/`role` forwarded from `req.params`/`res.locals.user` into the service for downstream checks
- [ ] RBAC wired on every route; module name matches `config/rbac.config.js`; method→permission mapping correct
- [ ] CSV/export field shapes stable regardless of upstream path; role-based column visibility honored
- [ ] Standardized response `{ success, message?, result? }`
- [ ] Public routes (declared before `router.use(authUser, …)`) are intentionally public

### Auth / RBAC / Middleware
- [ ] Changes to `rbac.config.js` reviewed for blast radius across **all** modules using that key
- [ ] No removal/weakening of `agencyId` enforcement or `checkRBAC`
- [ ] Role arrays correct against the hierarchy (`admin`>`manager`>`executive`>`associate`; external `brand`,`creator`)
- [ ] Field-level visibility (`CREATOR_FIELD_VISIBILITY`) consistent in both API and CSV paths

### Cron / Background job
- [ ] Re-entrancy / overlap — what if the previous run hasn't finished?
- [ ] Tenant iteration scoped correctly; one tenant's failure doesn't abort the rest
- [ ] Idempotent; time/timezone assumptions explicit
- [ ] Heavy work batched/chunked; no unbounded in-memory accumulation

### Cross-repo contract (SNS/SQS, creator-services, analytics, pdf-gen)
- [ ] Payload shape matches the consumer (cx-worker message types, etc.) on **both** sides
- [ ] Field names/types align with the other store's schema (MySQL Creator ↔ Mongo)
- [ ] Timeouts, retries, rate limits, and error handling present; N+1 batched
- [ ] Versioning/back-compat if the message or API shape changed

### Docs
- [ ] Deprecations reflected in **both** `data-model/readme.md` and `overview.md` (entity table, ER diagram, architecture box)
- [ ] New entities documented (fields, FKs, indexes, relationships, ER snippet)
- [ ] Old→new mapping table for renamed/deprecated names

### Data backfill / one-off DML (`*.sql`, raw `sequelize.query` UPDATE/INSERT)
- [ ] **Normalization parity** — the match/join mirrors how the app matches. The app reports rows on `LOWER(TRIM(LEADING '@' FROM TRIM(uname))) = username`; a raw `col = col` join silently misses `@`-prefixed / odd-cased / leading-space rows. Normalize on the driving side so the indexed side stays usable.
- [ ] **Batch large writes** — a single multi-million-row `UPDATE … JOIN` on a hot table holds locks, bloats the binlog, and lags replicas. Loop by PK range (`WHERE id BETWEEN …`; a multi-table `UPDATE` can't take `LIMIT`), `SLEEP` between batches, run off-peak.
- [ ] **paranoid** — filter `deleted_at IS NULL` on both sides to match app behavior and skip soft-deleted rows.
- [ ] **Idempotent / resumable** — guard with `WHERE target_col IS NULL` (or equivalent) so a re-run is safe and a killed run resumes where it stopped.
- [ ] **Tenant key in the join** (`agencyId`) — no cross-tenant mismatch.
- [ ] **EXPLAIN first**; confirm collation parity on the join columns (else "illegal mix of collations" / full scans) and that the lookup hits the intended unique index.

## 5. CultureX traps (learned the hard way — examples, not exhaustive)

Reach for these by name when the pattern matches. This is encoded experience; it grows (see §9). **Some are stack-specific** — the rows about partial index, INSERT IGNORE, `paranoid`+CASCADE, cross-store ref width, `Op.notIn:[null,""]`, static `Model.update`, and unbatched mega-UPDATE only bite on Sequelize+MySQL (see §0). The rest — success-theater, field-shape inconsistency, sync-LLM-inline, N+1 to a service, unbounded ids in body, LLM-key mismatch, side-effect gating drift, JSON-key typo under `any`, symmetric-fix gap, stuck background task — are framework-agnostic and apply on any stack.

| Trap | Where it bites | Fix |
|---|---|---|
| **MySQL partial index** | `addIndex({ where: ... })` only works on Postgres; MySQL drops the `where` silently | Full unique index; if you needed paranoid + uniqueness, drop paranoid |
| **Paranoid + INSERT IGNORE silent skip** | Re-assigning a soft-deleted row's unique combo silently fails (conflicts on the soft-deleted row) | Hard-delete on unassign, `restore()`, or read back inserted ids |
| **Paranoid parent + CASCADE FK** | `ON DELETE CASCADE` only fires on hard delete; parent soft-delete leaves orphan children | Wire cleanup via `Tags.relatedModels[]`, `Agency.associations[]` (`hooks: true`), or explicit `Model.destroy` in `deleteWithRelations` |
| **Cross-store ref oversize** | Mongo `_id` (24 hex) stored as `VARCHAR(255)` | `STRING(24)` / `CHAR(24) CHARACTER SET ascii COLLATE ascii_bin` |
| **Cross-tenant validation gap** | Validates `agencyId` from `res.locals.user` but accepts foreign `profileMonitoringId` etc. from `req.body` | Repo helper filtering by `agencyId` AND the URL's `account_type`; count-match assert |
| **Sync LLM / external job inline** | HTTP handler `await`s OpenAI / Mongo bulk → request timeout + retry-cost amplification | SNS→cx-worker, or `202` + background |
| **`Promise.allSettled` success theater** | Logs `console.error` on rejection but still reports `stats.success = N` | Split `succeeded`/`failed`; surface failures |
| **Field-shape inconsistency between paths** | Field built as `[string]` in one path, `[{uuid,name}]` in another → `.map(x=>x.name)` gives `[undefined]` | Normalize at source; one shape across all paths |
| **Misleading field name** | `postUUID` actually holds a Mongo `_id` | Rename to match what's stored |
| **N+1 to Creator Service** | One `getPosts` per profile in a list endpoint to compute a flag | Batch endpoint, or precompute/cache the flag |
| **Unbounded `mongo_ids` in HTTP body** | Filter-by-label sends all matching mongo ids in the POST body | Chunk, or push the join into Creator Service |
| **LLM key mismatch with mapping** | Prompt says "Educational Content" but mapping only has "Educational Content & How-To Guides" → silent drop | Align prompt + JSON output; accept both keys defensively |
| **`Op.notIn:[null,""]` → ZERO rows on MySQL** | Emits `NOT IN (NULL, '')`; MySQL 3-valued logic excludes every row | `{ [Op.and]: [{ [Op.not]: null }, { [Op.not]: "" }] }` → `(col IS NOT NULL AND col != '')` |
| **Static `Model.update` returns stale instance** | `updateById({shared:true})` then returns previously-fetched `instance` → response shows old value | Re-fetch, or mutate the instance, or throw on `affectedCount === 0` |
| **Multer field vs DB column mismatch** | `params.profileImage = imageRes.Location` thinking it persists, but that's the Multer.File input field; DB payload never gets `profile_image` | Write to the DB payload; ensure Zod schema includes the column |
| **Side-effect gating drift on extraction** | Old controller returned early before firing Mixpanel/audit; new one fires unconditionally after `service()` → double-count | Re-gate with the old early-return condition (e.g. `if (creatorList?.length)`) |
| **JSON-key typo hidden by `any`** | `eslint-disable no-explicit-any` lets `d?.advancedData?.x` (canonical: `advanceData`) silently be `undefined` everywhere | Audit every `?? d?.foo_typo` fallback; narrow types / remove the disable |
| **Backfill normalization drift** | A prod backfill joins/matches with raw `col = col`, but the app matches normalized (`LOWER(TRIM(LEADING '@' …))`) → silent under-population of `@`-prefixed / odd-cased rows | Mirror the app's exact normalization in the backfill, on the driving side so the indexed side stays usable |
| **Unbatched mega-UPDATE on a hot table** | One multi-million-row `UPDATE … JOIN` → long locks, binlog bloat, replication lag, lock-wait timeouts | Batch by PK range (`WHERE id BETWEEN …`; a multi-table `UPDATE` can't `LIMIT`), idempotent `WHERE col IS NULL`, run off-peak |
| **Symmetric-fix gap (parallel branches)** | A fix lands on one case but not its siblings — e.g. city/country denominator fixed to `totalFollowers` but `age_split` left on a per-bucket denominator → age summed to **155%** | After fixing one branch, apply + re-verify ALL parallel branches; for distributions assert they sum to ~100% |
| **Stuck background task with no recovery** | A worker chunk that never calls back (crash/DLQ/lost SQS) leaves the task `pending` forever; an in-progress guard then permanently blocks retrying — and the `findStuckWorkerTasks` recovery cron was written but never wired | Wire a stuck-task sweep (terminal-state it / re-publish), and fail the message if the SNS publish itself throws |

## 6. Re-review protocol

When the user says "the dev fixed X, re-review" — **re-read the actual files** (`Read`/`grep`). Never trust commit messages or prior memory — **and don't trust your *own* prior findings either.** Re-verify each one against resolved source; a prior pass can have been wrong (see §8 Evidence gate). If new commits double down on something you flagged, that's a cue to re-check *your* claim, not proof you were right.
- Is the previously flagged issue actually resolved *in code*?
- Did the fix regress the symmetric/other path? (fixing one path often breaks its mirror)
- **Did the fix itself introduce a new bug?** A "fix" can be worse — e.g. `[Op.not]: ""` → `[Op.notIn]: [null, ""]` turned a partial filter into "returns zero rows on MySQL."
- New files/commits since last review?
- **For any SQL fix, regenerate and read the actual SQL** (§7) — don't reason about Sequelize from memory.

**Pin the delta — don't re-review from scratch and don't trust the session snapshot.** Record the last-reviewed commit SHA; a re-review is `git diff <last-sha>..HEAD` + `git log <last-sha>..HEAD`, not a fresh `main..HEAD`. The start-of-session `gitStatus` snapshot and commit-message claims are *not* ground truth — reconcile your view with the PR's remote head (`gh pr view <n> --json headRefOid`): the dev may have committed locally (your local HEAD already advanced) or pushed to the remote (your checkout is stale). Establish the real delta first, then verify each prior finding against it.

**The most common re-review miss is a fix applied to one of several parallel branches.** When a fix touches one case (one segment's denominator, one platform, one code path), confirm it was applied to *every* sibling case — and that any invariant still holds (e.g. a distribution still sums to ~100%). See §5 symmetric-fix gap.

## 7. Verification one-liners

```bash
# Renamed method/model — find stragglers
grep -rn "OldName\b" src/ packages/ | grep -v "NewName\|comment"
# Inverse associations exist?
grep -B2 -A5 "hasMany.*<NewModel>\|belongsTo.*<NewModel>" packages/cx-datastore/src/models/
# Sync external calls in handlers
grep -B2 -A3 "await.*\(generateAndSave\|openai\|llm\|getPosts\)" src/modules/*/controllers/ controllers/
# Paranoid models
grep -rn "paranoid: true" packages/cx-datastore/src/models/
# Optional agencyId in repo signatures (cross-tenant leak risk)
grep -B1 -A6 "agencyId?:" packages/cx-datastore/src/repositories/
# Tenant-leaky finders
grep -B1 -A12 "async find\w*BySlug\b" packages/cx-datastore/src/repositories/
```

**Verify Sequelize-generated SQL for any non-trivial `where`** (Op.not/notIn/is, NULL in or/and, JSON paths, paranoid interplay):

```bash
node -e "
const { Sequelize, Op, Model, DataTypes } = require('./node_modules/sequelize');
const sq = new Sequelize('test','','',{ dialect:'mysql', logging:false });
class M extends Model {}
M.init({ col: DataTypes.STRING }, { sequelize: sq, modelName: 'm' });
console.log(sq.dialect.queryGenerator.selectQuery('ms', {
  attributes: ['id'],
  where: { col: { [Op.and]: [{ [Op.not]: null }, { [Op.not]: '' }] } },  // paste the where under review
}, M));
"
```

**Rule of thumb:** if the SQL contains `NOT IN (NULL, …)` or `!= NULL`, it's almost certainly wrong (MySQL 3-valued logic → row exclusion).

For every `findXBy{Slug,Uuid,Id}` in a repo: (1) signature has **required** `agencyId`, (2) body applies it in the `where`, (3) every caller passes it. A finder without `agencyId` is a cross-tenant leak waiting to be exploited via a guessed slug/UUID — **treat it as a blocker even if no current caller exploits it; the finder is the contract.**

## 8. Categorize findings & output

Severity (use these plain words as the section labels — no emoji, no severity icons in the output file):
- Blocker — data loss, RBAC/tenant bypass, security hole, production timeout, silent data corruption
- High — perf regression, edge-case correctness, broken UX path, back-compat break
- Lower priority — naming, structure, minor inconsistency
- Verified OK — call out what you checked and confirmed (gives the dev confidence in the rest of the diff)

### Evidence gate — clear this before writing ANY Blocker/High finding
A **false blocker is worse than a missed bug**: it burns the dev's trust and time, and it can launch a regression. So every finding that rests on an **absolute claim** — *"always null/undefined", "never called", "dead/unused", "field doesn't exist", "returns zero rows", "this regresses X"* — must clear this gate first:

- **Never infer a structure's full shape, or a symbol's whole call graph, from a diff hunk.** Diffs are windowed — a returned object's other keys, an `exports` line, or another caller routinely sit *just outside* the shown context. A `return {`-block in a hunk that ends before the closing `}` is **not** the full object. (This is exactly how a real review mislabeled `cxScore.attributes` as "always undefined" — the `attributes: payload` key was three lines below the hunk, and present on `main` all along.)
- **Verify against resolved source, cheaply:** `grep` for where the symbol is *assigned / returned / exported* (not just read), then `Read` the full enclosing block. For "X doesn't exist", grep the **producer** side; for "never called", grep callers across `src/ packages/ helpers/ controllers/`; for "returns zero rows", regenerate the SQL (§7).
- **A finding that contradicts shipped `main` behavior is a flag against your own premise first.** If the diff (or `main`) already reads a field/path and it shipped, your "it's broken/empty" hypothesis is the more likely error — disprove yourself before writing it. When the dev "doubles down" on the very thing you flagged, re-verify *your* claim, don't escalate.
- **If you can't verify, you can't assert.** Downgrade to Lower-priority, phrased as a question — *"suspected X; verify by `<exact grep/read>`"* — never a Blocker/High stated as fact. Confidence must match evidence.

Write findings to `<TOPIC>_REVIEW.md` at repo root.

**Output style — keep it plain, tight, and scannable.** No emoji. No bold/`**` or decorative headers — plain section labels only (the severity words above). No TL;DR padding, no restating the obvious, no section that just says "none" — omit empty sections. One finding per line. Write only what the dev needs to act. This style applies to your chat summary, not just the file.

For a **re-review**, make the file append-only: add a new section at the top stamped with the delta range (`<last-sha>..HEAD`) listing what's now fixed and what's still open — don't rewrite the earlier rounds.

```markdown
# <PR topic> — review (<base>..<head>)

Verdict: <one line — good to merge, or not yet and the one thing blocking it>.

Blockers (must fix before merge)
- [ ] <headline>. `file:line` (`identifier`) — symptom → root cause → fix.

High
- [ ] …

Lower priority
- [ ] …

Verified OK
- <what you checked and confirmed>

Deferred (per author)
- <anything the user told you to ignore>
```

Each line:
- A `- [ ]` checkbox (GitHub-pasteable), one finding per line.
- A `file:line` ref with the offending identifier in backticks, so the dev can grep.
- Symptom first, then cause, then fix. State confidence honestly — if suspected-not-verified, say so and give the exact check.

### What to skip
- Style/formatting, comment typos (unless they change semantics), LSP-safe renames
- "Pre-existing in `main`" issues — note them, don't block the PR
- Anything the user explicitly deferred (track under "Deferred per author")

## 9. Keep the skill learning

This skill improves by accumulating real traps, not by getting longer with theory.
- When a review surfaces a **new recurring bug class** specific to this codebase (something you'd want future-you to check automatically), propose adding it: a one-line row in §5, and if it's file-type-triggered, a row in §2. Keep entries terse: *trap name → where it bites → fix.*
- When a trap stops applying (pattern removed from the codebase, framework upgraded), prune it so the library stays trustworthy.
- Don't encode one-off bugs that won't recur, or anything already enforced by lint/types/tests. The library is for traps the tooling can't catch.
