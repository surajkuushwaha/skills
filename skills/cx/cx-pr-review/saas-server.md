# cx-saas-server supplement

Load when §0 fingerprints **cx-saas-server** (`sequelize` + `mysql2` in `package.json`; `packages/cx-datastore/`; `config/rbac.config.js`). Main SKILL.md still governs — §3 lenses, §6 re-review, §8 output. Stack: Express + Sequelize + MySQL, Firebase auth + RBAC middleware, **multi-tenant via `agencyId`**, Mongo data via Creator Service. Bold names below are this repo's §5-style traps — cite them by name.

## File categories (maps paths to §1 classification)

| Category | Typical paths |
|---|---|
| Migration | `migrations/*.js` |
| Model | `packages/cx-datastore/src/models/*.model.ts`, `registry.ts` |
| Repository | `packages/cx-datastore/src/repositories/**`, `src/modules/*/repositories/*` |
| Service | `src/modules/*/services/*`, legacy `helpers/` |
| Controller / Route / Schema | `src/modules/*/{controllers,routes,schemas}/*`, legacy `controllers/*.js`, `routes/*.js`, `schemas/*` |
| Auth / RBAC / Middleware | `middleware/*`, `config/rbac.config.js` |
| Cron / Background job | `cron/**`, `src/modules/cron/**` |
| Cross-repo contract | SNS publishes, SQS payloads (→ cx-worker), calls to cx-creator-services / cx-analytics-backend / cx-pdf-generation |
| Config / Infra | `config/*`, env usage, build/deploy scripts |
| Docs | `*/docs/**/*.md`, `project_overview.md` |
| Data backfill / DML | one-off `*.sql`, raw `sequelize.query` UPDATE/INSERT run against prod |
| Spec the code implements | formula/PRD/scoring doc + the aggregation/ranking code that must match it |
| Test | `test/**`, `*.test.*` |

## Router rows (extends §2)

| If the diff contains… | Then also verify |
|---|---|
| a tenant-scoped model query (`where:` without `agencyId`) | Every finder takes a **required** `agencyId` and applies it (Repository checklist). Missing = cross-tenant leak = blocker. |
| an ID from `req.body`/`req.query` used in a query | Entity belongs to caller's `agencyId` **and** the URL's `account_type`/RBAC scope (**cross-tenant validation gap** trap). |
| a new/changed migration | Migration checklist: charset, partial-index trap, FK widths, CASCADE-vs-paranoid, reversible `down`. |
| `paranoid: true` nearby | CASCADE won't fire on soft-delete → orphan cleanup wired? `bulkCreate({ ignoreDuplicates: true })` silently skips conflicts? `{ paranoid: false }` needed for a read? |
| `Op.not`, `Op.notIn`, `Op.is`, `Op.or` with NULL, or JSON-path `where` | **Regenerate the SQL** (generator below). `NOT IN (NULL, …)` / `!= NULL` on MySQL → zero rows. |
| a Mongo `_id` stored in MySQL (or vice-versa) | Cross-store ref width (`STRING(24)`/`CHAR(24)`); field name reflects what's stored. |
| a new/changed route | RBAC wired (`checkRBAC`/module variant); module name matches `config/rbac.config.js`; method→permission mapping correct. |
| a change to `config/rbac.config.js` or `middleware/` | Blast radius across **all** modules using that key; role arrays correct; `CREATOR_FIELD_VISIBILITY` consistent. |
| static `Model.update(...)` then return of a previously-fetched instance | **Static `Model.update` returns stale instance** trap — re-fetch, mutate, or assert `affectedCount`. |
| raw `.sql` / DML backfill (esp. prod / large table) | Data backfill checklist below (normalization parity, PK-range batching, `deleted_at`, EXPLAIN, collation). |

## Checklists (replace §4's stack-specific gaps)

### Migration (`migrations/*.js`)
- [ ] Charset `utf8mb4`, collate `utf8mb4_unicode_ci`
- [ ] **MySQL partial index**: `where: { deleted_at: null }` on `addIndex` is **silently dropped on MySQL** (Postgres-only). With `paranoid` + `bulkCreate({ ignoreDuplicates: true })`, re-creating a soft-deleted row silently fails (`success: true`, zero writes). Full unique index; if paranoid + uniqueness both needed, drop paranoid.
- [ ] FK widths: Mongo `_id` refs are `STRING(24)`/`CHAR(24) CHARACTER SET ascii COLLATE ascii_bin`, not `STRING(255)` (**cross-store ref oversize** trap)
- [ ] `ON DELETE CASCADE` fires only on **hard** delete — paranoid parent needs explicit cleanup (see Model)
- [ ] Table name follows its family convention (ProfileMonitoring-owned tables start `profile_*`)
- [ ] No orphaned/renamed index — `addIndex` with a new name does **not** drop the old one
- [ ] `down` actually reverses `up`, idempotent

### Model (`packages/cx-datastore/src/models/*.model.ts`)
- [ ] Indexes: the **migration** is the schema source of truth, not `init()`. Missing `indexes: [...]` is **not** a bug (~18/128 models declare one; `sync()` unused in prod). If the model declares indexes, mirror new ones; don't add a lone index to a model declaring none. FK-index naming: MySQL auto-creates an FK index named after the column *only when no usable index exists* — an explicit `idx_<table>_<column>` pre-empts it, no duplicate (verify via `SHOW INDEX` before claiming one).
- [ ] Every `belongsTo` has the matching `hasMany`/`hasOne` on the parent (`Agency`, `Tags`, …)
- [ ] **Alias collisions** — check existing aliases before adding (e.g. `"post_labels"` taken)
- [ ] **Paranoid parent + CASCADE FK**: model not `paranoid` but parents are → cleanup on parent soft-delete via `Tags.relatedModels[]`, `Agency.associations[]` (`hooks: true` loop), or explicit `Model.destroy` in `deleteWithRelations` — else soft-delete leaves orphan children
- [ ] Registry export added (`registry.ts`); `tableName` matches the migration exactly
- [ ] Dead columns flagged (no read/write call sites)

### Repository (`**/repositories/*`)
- [ ] **Multi-tenant scoping:** `agencyId` on every `where:`; finders take it as a **required** param
- [ ] **Cross-tenant validation gap**: validates `agencyId` from `res.locals.user` but accepts foreign `profileMonitoringId` etc. from `req.body` → repo helper filtering by `agencyId` AND the URL's `account_type`; count-match assert
- [ ] **Paranoid + INSERT IGNORE silent skip**: re-assigning a soft-deleted row's unique combo silently fails (conflicts on the soft-deleted row) → hard-delete on unassign, `restore()`, or read back inserted ids
- [ ] Success counts reflect real writes — `bulkCreate({ ignoreDuplicates: true })` skips conflicts silently; return inserted count, not payload length
- [ ] `Promise.allSettled` rejections inspected, not stripped and reported as success
- [ ] Transactions when multiple tables change together
- [ ] `{ paranoid: false }` when soft-deleted rows must be visible
- [ ] Singleton pattern matches existing (`module.exports = new Repository()`)

### Controller / Route (RBAC specifics; generic bullets in main §4)
- [ ] RBAC on every route; module name matches `config/rbac.config.js`; method→permission mapping correct
- [ ] `type`/`agencyId`/`role` forwarded from `req.params`/`res.locals.user` into the service
- [ ] CSV/export field shapes stable regardless of upstream path; role-based column visibility honored

### Auth / RBAC / Middleware
- [ ] `rbac.config.js` changes reviewed for blast radius across **all** modules using that key
- [ ] No removal/weakening of `agencyId` enforcement or `checkRBAC`
- [ ] Role arrays correct against hierarchy (`admin`>`manager`>`executive`>`associate`; external `brand`,`creator`)
- [ ] `CREATOR_FIELD_VISIBILITY` consistent in both API and CSV paths

### Docs
- [ ] Deprecations in **both** `data-model/readme.md` and `overview.md` (entity table, ER diagram, architecture box)
- [ ] New entities documented (fields, FKs, indexes, relationships, ER snippet)
- [ ] Old→new mapping table for renamed/deprecated names

### Data backfill / one-off DML (MySQL mechanics; principles in main §4)
- [ ] **Backfill normalization drift**: app matches `LOWER(TRIM(LEADING '@' FROM TRIM(uname))) = username`; a raw `col = col` join silently misses `@`-prefixed / odd-cased / leading-space rows. Mirror the app's exact normalization on the driving side so the indexed side stays usable.
- [ ] **Unbatched mega-UPDATE on a hot table**: a single multi-million-row `UPDATE … JOIN` holds locks, bloats binlog, lags replicas → loop by PK range (`WHERE id BETWEEN …`; multi-table `UPDATE` can't `LIMIT`), `SLEEP` between batches, run off-peak
- [ ] **paranoid** — `deleted_at IS NULL` on both sides
- [ ] Idempotent / resumable — guard `WHERE target_col IS NULL` (or equivalent); re-run safe, killed run resumes
- [ ] Tenant key in the join (`agencyId`)
- [ ] **EXPLAIN first**; collation parity on join columns (else "illegal mix of collations" / full scans); lookup hits the intended unique index

## Additional traps (extends §5)

| Trap | Where it bites | Fix |
|---|---|---|
| **`Op.notIn:[null,""]` → ZERO rows on MySQL** | Emits `NOT IN (NULL, '')`; 3-valued logic excludes every row | `{ [Op.and]: [{ [Op.not]: null }, { [Op.not]: "" }] }` → `(col IS NOT NULL AND col != '')` |
| **Static `Model.update` returns stale instance** | `updateById({shared:true})` then returns previously-fetched `instance` → response shows old value | Re-fetch, mutate, or throw on `affectedCount === 0` |

(The other named traps — MySQL partial index, paranoid+INSERT IGNORE, paranoid+CASCADE, cross-store ref oversize, cross-tenant validation gap, backfill normalization drift, unbatched mega-UPDATE — are embedded in the checklists above.)

## Verification one-liners

```bash
# Renamed method/model — stragglers
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

**Rule of thumb:** SQL containing `NOT IN (NULL, …)` or `!= NULL` is almost certainly wrong (MySQL 3-valued logic → row exclusion).

**Finder contract:** every `findXBy{Slug,Uuid,Id}`: (1) signature has **required** `agencyId`, (2) body applies it in the `where`, (3) every caller passes it. A finder without it is a cross-tenant leak — **blocker even if no current caller exploits it; the finder is the contract.**
