---
name: cx-pr-review
description: Use when asked to review or re-review a PR, audit changes, check the diff on the current branch, verify a fix, or check what's still pending before merge in a CultureX repo. Universal TypeScript/JavaScript review framework (lenses, router, framework-agnostic traps) plus per-repo supplements loaded by fingerprint — saas-server.md (Express+Sequelize+MySQL, RBAC, agencyId tenancy), creator-services.md (Mongoose autoIndex:false, Qdrant, AI pipeline, Elastic Beanstalk), and analytics-backend.md (stateless provider gateway, no DB, no auth, allSettled fan-out, 3-way symmetric provider paths); more repos get their own supplement over time. Trap library covers bugs that actually shipped — paranoid+CASCADE, MySQL partial index, agencyId scoping, cross-store refs, sync-LLM-in-handler, side-effect gating, backfill normalization, symmetric-fix gaps, stuck background tasks.
---

# CultureX PR Review

## How to use this skill

You are the reviewer; this skill is a companion, not a substitute for judgment. This file holds everything **universal** — process, TS/JS/Express-level lenses, router rows, and framework-agnostic traps. Repo-specific mechanics live in **per-repo supplements** (§0 dispatch): `saas-server.md`, `creator-services.md`, and future repo files following the same pattern.

Operating rules:
- **Checklists are a floor, not a ceiling.** Reason from first principles about *this* change, then cross-check the lists. The best findings are edge cases no checklist covers yet.
- **The trap library is examples, not the whole job.** A PR can dodge every listed trap and still be broken. New recurring bug class → add it (§9).
- **Adapt to the diff.** Spend effort where the risk is — a docs-only PR needs no SQL generator; a cron PR needs idempotency thinking beyond the table's hints.
- **Adapt to the repo.** Confirm the base branch (§0a), identify the repo (§0), load its supplement, and apply only checks that match. Never apply another repo's mechanics — e.g. don't flag a missing `agencyId` in a repo without tenancy; find that repo's equivalent scoping and check *that*.
- Flag **real bugs, risks, design problems** — don't nit style (§8 What to skip).

## 0a. Confirm the base branch (ASK before checking anything)

Ask the user which branch the PR merges into before any `git`/`grep` — every diff, log, and re-review delta is computed against it (stale base → reviewing already-merged commits; wrong base → missing or phantom changes). Don't assume `main`. Detect candidates, then confirm:

```bash
gh pr view --json baseRefName 2>/dev/null            # if a PR exists this IS the base — still confirm
git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null # repo default branch
git branch -r                                         # what exists (main? master? develop? release?)
```

- `baseRefName` found → state it, ask confirm/override (devs sometimes branch off a feature/release branch, not the PR base).
- No PR → ask explicitly, presenting the detected default as the suggestion.
- Record as `<base>`; use it in every command below (`<base>..HEAD`). For a re-review, also pin the last-reviewed SHA (§6).

Use AskUserQuestion (or a plain question) — don't proceed to §0/§1 until confirmed.

## 0. Identify the repo & load its supplement (once, first)

| Repo | Fingerprint | Supplement |
|---|---|---|
| cx-saas-server | `sequelize` + `mysql2` in `package.json`; `packages/cx-datastore/`; `config/rbac.config.js` | **read [`saas-server.md`](saas-server.md)** |
| cx-creator-services | `mongoose` + `@qdrant/js-client-rest` in `package.json`; `src/db/qdrant/` | **read [`creator-services.md`](creator-services.md)** |
| cx-analytics-backend | package name `cx-analytics-backend`; `bottleneck` + `axios-retry` + `openai`, **no ORM/DB driver**; `client/creator-service/` | **read [`analytics-backend.md`](analytics-backend.md)** |
| cx-worker | package name `cx-worker`; `sqs-consumer` + `@aws-sdk/client-sns` in `package.json`; `helper/main.helper.js` | no supplement yet — SQS consumer, no DB; calls back to saas-server/creator-services via axios. Review = message-contract both sides (§4 Cross-repo), idempotency on redelivery, §5 stuck-task trap |
| cx-pdf-generation | package name `cx-creator-service` (sic); `puppeteer` + `serverless-http` in `package.json` | no supplement yet — Express+Puppeteer React-SSR PDF service, no DB; universal checks only |
| cx-partners / saas-super-admin / cx-saas-dashboard | React frontends (`react` + Radix/TanStack, no server framework) | frontend — this skill's backend mechanics don't apply; §3 lenses + §5 agnostic traps only |
| any other repo | fingerprint below | no supplement yet — use the mapping table below + universal checks; propose a new supplement file (§9) |

```bash
# ORM / DB driver — the fleet only uses sequelize+mysql2 (saas-server) and mongoose (creator-services); anything else is a red flag to investigate, not a stack to accommodate
grep -iE '"(sequelize|mongoose|mongodb|mysql2?)"' package.json 2>/dev/null
ls migrations 2>/dev/null
# Tenancy / auth convention (what plays the role of a tenant key / rbac config)
grep -rIlE 'agencyId|tenantId|orgId|workspaceId|accountId' src 2>/dev/null | head
grep -rIl 'rbac|checkRBAC|authorize|can\(' src middleware 2>/dev/null | head
```

For a repo with no supplement, map what fingerprinting finds — the **principle** is constant, only the mechanism changes. The fleet has exactly two DB stacks:

| Concept | Sequelize + MySQL (saas-server) | Mongoose + Mongo (creator-services) | No DB (analytics-backend, cx-worker, cx-pdf-generation) |
|---|---|---|---|
| Schema change | `migrations/*.js` | none — shape lives in the model file; check back-compat of reads on old docs | N/A — check payload contract vs the owning repo |
| Tenant scoping | `agencyId` in every `where:` | `platform`+`username`/`profile_id` | social identifiers / message fields — never `agencyId` |
| Negation + NULL | `NOT IN (NULL,…)` → zero rows (saas-server.md) | `$ne`/`$nin` with `null` semantics | N/A |
| Soft delete | `paranoid` + `deleted_at` | no global convention — check per-model | N/A |
| Partial indexes | MySQL silently drops them | `partialFilterExpression` quirks (creator-services.md) | N/A |
| Query verification | regenerate SQL (saas-server.md) | reason about aggregation pipeline / `$match` | read the outbound HTTP payload vs the consumer's schema |

With no supplement, the review is §3 lenses + §2 universal rows + §5 agnostic traps. Still thorough — the universal lenses carry it.

## 1. Scope the diff & understand intent

Run in parallel (`<base>` = branch confirmed in §0a):

```bash
git log <base>..HEAD --oneline
git diff <base>..HEAD --stat
git status --short
gh pr view --json title,body,number 2>/dev/null || true
```

Before reading code line-by-line, answer:
- **What is this PR trying to do?** (title/body/commits/ticket) — you can't judge correctness without intent.
- **Blast radius?** One-module feature vs. shared middleware/model/config/cron — the latter breaks unrelated features.
- **Which categories does it touch?** Classify each changed file: Migration/Schema · Model · Repository · Service/Helper · Controller/Route/Validation · Auth/Middleware · Cron/Background job · Cross-repo contract (SNS/SQS, service-to-service calls) · Config/Infra · Docs · Data backfill/DML · Spec-implementing code (formula/PRD → aggregation/ranking) · Test. The repo supplement maps concrete paths to these categories; the category determines which checklists and §2 rows apply.

## 2. Universal router — deeper checks by what you see

Scan the diff for these signals; when present, run the linked checks. The repo supplement adds its own rows. Ordered by how often they bite.

| If the diff contains… | Then also verify |
|---|---|
| an ID from `req.body`/`req.query` used in a query | The entity belongs to the caller's tenant/scope (supplement defines the key — `agencyId`, `platform`+`username`, …). Guessed/foreign IDs must not cross that boundary. |
| `bulkCreate`/`bulkWrite`/`insertMany`/`Promise.allSettled`/batch loops | Success counts reflect **actual writes** (dedupe/ignore options skip silently); rejections surfaced not swallowed; field shape consistent across paths. (§5) |
| an `await` to OpenAI/LLM/HTTP/heavy DB work inside an HTTP handler | Move to a queue (SNS→cx-worker) or respond `202` + background; idempotency on retry. (§5 sync-job) |
| a new/changed route | Input validation (Zod) on body/query/params; authZ wired per the repo's convention; standard response shape (`{ success, message?, result? }`); public route intentional. |
| a change to shared middleware/config | Blast radius across **all** consumers of that key/module. |
| an update call followed by returning a previously-fetched object | Stale in-memory data — re-fetch, mutate, or assert the affected count. (§5) |
| a controller→service refactor / extraction | Side-effect gating drift: analytics/audit events still gated behind the old early-return? (§5) |
| `eslint-disable @typescript-eslint/no-explicit-any` | JSON-key typos hidden by `any` (`advancedData` vs `advanceData`); audit `?? d?.foo_typo` fallbacks. (§5) |
| file upload / Multer | DB payload column actually written (not the Multer field object); validation schema includes the column. (§5) |
| money / credits / payments / webhooks | Idempotency keys, transaction boundaries, no double-charge on retry, correct unit, webhook signature verified. Reason hard — the trap table only hints. |
| a new external API call (another CultureX service / 3rd-party) | Rate limits, timeouts, error handling, caching, N+1 (one call per item in a list endpoint → batch). (§5) |
| LLM prompt + a mapping/enum of its output | Prompt category strings exactly match mapping keys; accept both defensively. (§5) |
| date/time, timezone, or cron schedule | TZ assumptions, DST, cron overlap/re-entrancy, "today" server-side vs. tenant-side. |
| a spec/formula/scoring doc the code must implement | Reproduce the doc's worked examples against the code; check **denominator per segment** and distributions **sum to ~100%**; fix landed on **every** parallel branch. (§5 symmetric-fix gap) |
| a raw DML backfill / data migration (esp. prod / large table) | Normalization parity with the app's matching logic, batching, soft-delete filter, idempotent/resumable, tenant key in the join, query plan checked. Mechanics per supplement. |

Signal not in the table (or the supplement's) → expected; fall through to §3 and reason it out.

## 3. Independent analysis lenses (EVERY PR)

Checklists are memory aids for known traps; **these lenses find the unknown ones.** Trace each meaningful change through them — out loud in your notes:

1. **Correctness / intent** — does it do what the PR says? Happy path, then empty/zero/null/one/many. Off-by-one, empty array, `undefined` key?
2. **Data integrity** — inconsistent DB possible? Partial writes without a transaction? Orphans? Lost updates? Wrong counts reported?
3. **Multi-tenancy / scoping** — every query scoped to the repo's tenant/scope key? Can caller A reach caller B's data via a guessed ID/slug/UUID?
4. **AuthZ / security** — authZ on the route? Privilege escalation path? Input validated (Zod)? Injection (raw SQL, NoSQL, path, SSRF on a URL param)? Secrets/PII in logs or responses?
5. **Concurrency / idempotency** — run twice (retry, double-click, redelivered SQS)? Read-modify-write race? Unique constraint or transaction protecting it?
6. **Performance / scale** — N+1 queries or service calls? Unbounded list in request/response? Missing index for a new filter/sort? Sync work that should be async?
7. **API contract / back-compat** — response shape changed for existing clients? Field renamed without migrating callers? Nullable became required?
8. **Error handling / observability** — failures swallowed (`catch {}`, `.filter('fulfilled')`)? Success reported when work silently didn't happen? Errors actionable?
9. **Blast radius** — shared model/middleware/config/cron: what else consumes it? Did fixing path A regress symmetric path B?

End each lens with: **"What's the worst input or timing that breaks this, and is it handled?"** That question, not the checklist, is where critical bugs come from.

## 4. Universal checklists (the floor)

Run the ones matching §1. The repo supplement replaces/extends these with stack mechanics (migrations, models, repositories, auth).

### Service / Helper
- [ ] **Field-shape consistency** across paths — path A pushes strings, path B objects → downstream `.map(x => x.name)` yields `undefined`s
- [ ] **No sync LLM/external/heavy calls** in the request path — queue (SNS→cx-worker) or `202` + background
- [ ] **Idempotency** on retry-prone work (LLM, payments, webhooks, SQS consumers)
- [ ] Side-effect gating preserved across controller→service refactors
- [ ] Services take specific params (`agencyId`/`userId`/`role` or the repo's equivalents), not whole `req`/user objects

### Controller / Route / Validation
- [ ] Zod on `req.body`, `req.query`, `req.params`
- [ ] Field names match what they store (`postUUID` shouldn't hold a Mongo `_id`)
- [ ] Caller identity/scope (`type`/tenant key/role) forwarded from `req.params`/`res.locals` into the service
- [ ] AuthZ wired per repo convention (supplement has specifics)
- [ ] Standard response `{ success, message?, result? }`
- [ ] Public routes (declared before the auth middleware) intentionally public

### Cron / Background job
- [ ] Re-entrancy/overlap — previous run not finished?
- [ ] Tenant iteration scoped; one tenant's failure doesn't abort the rest
- [ ] Idempotent; time/timezone assumptions explicit
- [ ] Heavy work batched/chunked; no unbounded in-memory accumulation

### Cross-repo contract (SNS/SQS, service-to-service)
- [ ] Payload shape matches the consumer (cx-worker message types, …) on **both** sides
- [ ] Field names/types align with the other store's schema (e.g. MySQL Creator ↔ Mongo)
- [ ] Timeouts, retries, rate limits, error handling; N+1 batched
- [ ] Versioning/back-compat if the message or API shape changed

### Data backfill / one-off DML (principles; DB mechanics per supplement)
- [ ] **Normalization parity** — the backfill's match/join mirrors exactly how the app matches (case, trimming, prefixes), normalized on the driving side so the indexed side stays usable
- [ ] **Batched** — no single unbounded write on a hot table
- [ ] Soft-delete filter applied to match app behavior
- [ ] **Idempotent / resumable** — re-run safe, killed run resumes
- [ ] Tenant key in the join/filter
- [ ] Query plan checked before running

## 5. Framework-agnostic traps (learned the hard way — examples, not exhaustive)

Reach for these by name when the pattern matches; the library grows (§9). Stack-specific traps live in the repo supplements.

| Trap | Where it bites | Fix |
|---|---|---|
| **Sync LLM / external job inline** | Handler `await`s OpenAI / heavy bulk work → timeout + retry-cost amplification | Queue (SNS→cx-worker), or `202` + background |
| **`Promise.allSettled` success theater** | Logs rejection but still reports `stats.success = N` | Split `succeeded`/`failed`; surface failures |
| **Field-shape inconsistency between paths** | `[string]` in one path, `[{uuid,name}]` in another → `.map(x=>x.name)` gives `[undefined]` | Normalize at source; one shape everywhere |
| **Misleading field name** | `postUUID` holds a Mongo `_id` | Rename to match what's stored |
| **N+1 to another service** | One `getPosts` call per profile in a list endpoint | Batch endpoint, or precompute/cache the flag |
| **Unbounded id list in HTTP body** | Filter-by-label sends all matching mongo ids in the POST body | Chunk, or push the join into the owning service |
| **LLM key mismatch with mapping** | Prompt says "Educational Content", mapping has "Educational Content & How-To Guides" → silent drop | Align prompt + JSON output; accept both keys defensively |
| **Side-effect gating drift on extraction** | Old controller returned early before Mixpanel/audit; new one fires unconditionally → double-count | Re-gate with the old early-return condition (e.g. `if (creatorList?.length)`) |
| **JSON-key typo hidden by `any`** | `eslint-disable no-explicit-any` lets `d?.advancedData?.x` (canonical: `advanceData`) silently be `undefined` | Audit every `?? d?.foo_typo` fallback; narrow types / remove the disable |
| **Multer field vs DB column mismatch** | `params.profileImage = imageRes.Location` writes the Multer.File input field; DB payload never gets `profile_image` | Write to the DB payload; validation schema includes the column |
| **Symmetric-fix gap (parallel branches)** | Fix lands on one sibling only — city/country denominator fixed to `totalFollowers`, `age_split` left per-bucket → age summed to **155%** | Apply + re-verify ALL parallel branches; distributions must sum to ~100% |
| **Stuck background task with no recovery** | Worker chunk never calls back (crash/DLQ/lost SQS) → task `pending` forever; in-progress guard blocks retry — and the `findStuckWorkerTasks` recovery cron was written but never wired | Wire a stuck-task sweep (terminal-state / re-publish); fail the message if the SNS publish throws |

## 6. Re-review protocol

"The dev fixed X, re-review" → **re-read the actual files** (`Read`/`grep`). Never trust commit messages, prior memory, **or your own prior findings** — re-verify each against resolved source (§8 evidence gate); a prior pass can be wrong. If new commits double down on something you flagged, re-check *your* claim, not escalate.
- Previously flagged issue actually resolved *in code*?
- Fix regress the symmetric/other path?
- **Fix itself introduce a new bug?** e.g. `[Op.not]: ""` → `[Op.notIn]: [null, ""]` turned a partial filter into "zero rows on MySQL".
- New files/commits since last review?
- Any query fix → regenerate and read the actual query (supplement's generator/one-liners).

**Pin the delta.** Record the last-reviewed SHA; re-review = `git diff <last-sha>..HEAD` + `git log <last-sha>..HEAD`, not a fresh `<base>..HEAD`. The start-of-session `gitStatus` snapshot and commit-message claims are not ground truth — reconcile with the PR's remote head (`gh pr view <n> --json headRefOid`): the dev may have committed locally (your HEAD advanced) or pushed (your checkout stale). Establish the real delta, then verify each prior finding against it.

**Most common re-review miss: a fix applied to one of several parallel branches.** Confirm every sibling case got it, and invariants still hold (distribution sums to ~100%). See §5 symmetric-fix gap.

## 7. Verification

Don't reason about generated queries or call graphs from memory — verify cheaply with greps and query generators. Each repo supplement carries its stack's one-liners (saas-server.md: Sequelize→SQL generator, tenancy greps; creator-services.md: index-drift script, payload-index greps).

## 8. Categorize findings & output

Severity labels (plain words, no emoji/icons):
- Blocker — data loss, authZ/tenant bypass, security hole, production timeout, silent data corruption
- High — perf regression, edge-case correctness, broken UX path, back-compat break
- Lower priority — naming, structure, minor inconsistency
- Verified OK — what you checked and confirmed (gives the dev confidence in the rest)

### Evidence gate — clear before writing ANY Blocker/High
A **false blocker is worse than a missed bug** — it burns trust and can launch a regression. Any **absolute claim** (*"always null", "never called", "dead/unused", "field doesn't exist", "returns zero rows", "this regresses X"*) must clear:

- **Never infer a structure's full shape or a symbol's call graph from a diff hunk.** Diffs are windowed — other keys, an `exports` line, another caller routinely sit just outside the shown context. A `return {` block cut off before `}` is not the full object. (Real case: `cxScore.attributes` mislabeled "always undefined" — `attributes: payload` sat three lines below the hunk, on `main` all along.)
- **Verify against resolved source, cheaply:** grep where the symbol is *assigned/returned/exported* (not just read), then Read the full enclosing block. "X doesn't exist" → grep the **producer** side; "never called" → grep callers repo-wide; "zero rows" → regenerate the query (§7).
- **A finding that contradicts shipped `main` behavior flags your own premise first.** If `main` already reads that field and shipped, disprove yourself before writing it. Dev "doubling down" → re-verify your claim.
- **Can't verify → can't assert.** Downgrade to Lower-priority phrased as a question — *"suspected X; verify by `<exact grep/read>`"*. Confidence must match evidence.

Write findings to `<TOPIC>_REVIEW.md` at repo root.

**Output style:** plain, tight, scannable. No emoji, no bold/decorative headers — plain severity labels only. No TL;DR padding, no empty "none" sections. One finding per line; write only what the dev needs to act. Applies to the chat summary too.

**Re-review:** append-only file — new section on top stamped with the delta range (`<last-sha>..HEAD`), fixed vs. still-open; don't rewrite earlier rounds.

```markdown
# <PR topic> — review (<base>..<head>)

Verdict: <one line — good to merge, or the one thing blocking it>.

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

Each line: `- [ ]` checkbox (GitHub-pasteable) · `file:line` + offending identifier in backticks · symptom → cause → fix. State confidence honestly; if suspected-not-verified, say so with the exact check.

### What to skip
- Style/formatting, comment typos (unless semantic), LSP-safe renames
- "Pre-existing in `main`" issues — note, don't block
- Anything explicitly deferred (track under "Deferred per author")

## 9. Keep the skill learning

The skill improves by accumulating real traps, not theory.
- New recurring bug class → one-line trap row (+ a router row if file-type-triggered): *trap → where it bites → fix.* Framework-agnostic → this file's §5; stack-specific → the repo's supplement.
- Reviewing a repo with no supplement and finding repo-specific conventions worth encoding → propose a new `<repo>.md` supplement (fingerprint + stack mapping + checks by diff signal + one-liners, like the existing two) and add its row to the §0 dispatch table.
- Trap stops applying (pattern removed, framework upgraded) → prune it.
- Don't encode one-offs or anything lint/types/tests already enforce.
