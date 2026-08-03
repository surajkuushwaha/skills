---
name: cx-database-schema
description: Use when writing a database migration or Sequelize model in the cx-saas-server repo — covers column naming (camelCase FKs vs snake_case data), the standard trailing block, foreign keys, ENUMs, paranoid soft delete, associations, indexes, and registering the model. Keeps migration columns and model init() in 1:1 lockstep.
---

# DATABASE_SCHEMA_SPEC

How to write a migration + Sequelize model in this repo.

Reference implementation:

- Migration: `cx-saas-server/migrations/20250320070220-create-deep-analysis.js`
- Model: `cx-saas-server/packages/cx-datastore/src/models/DeepAnalysis.model.ts`

**Golden rule:** the migration's columns and the model's `init()` columns **must match
1:1**. Migration builds the table; model maps to it. Keep them in lockstep.

---

## Part 0 — Shared Conventions (apply to both)

### File / name conventions

| Thing                     | Convention                                | Example                                  |
| ------------------------- | ----------------------------------------- | ---------------------------------------- |
| Migration file            | `YYYYMMDDHHMMSS-create-<entity-kebab>.js` | `20250320070220-create-deep-analysis.js` |
| Migration timestamp       | UTC creation time, 14 digits              | `20250320070220`                         |
| Model file                | `<EntityPascal>.model.ts`                 | `DeepAnalysis.model.ts`                  |
| Table name                | `snake_case` (singular/domain-plural)     | `deep_analysis`                          |
| Model class / `modelName` | PascalCase singular                       | `DeepAnalysis`                           |

### Column naming (the key split)

- **FKs + `id` + `uuid`** → `camelCase` (`agencyId`, `userId`, `profileReportId`).
- **All other data columns** → `snake_case` (`full_name`, `profile_image`,
`standard_fetch_all`, `fetch_status`, `created_at`).

So: relational/key columns camelCase, attribute columns snake_case. Match exactly.

### Column ORDER (same in migration and model)

1. `id` (PK)
2. Foreign keys (`agencyId`, `userId`, ...)
3. `uuid`
4. All other data columns
5. **Standard trailing block** (see below) — always last, every table.

### Foreign key naming

`<referencedEntityCamel>Id` → `agencyId`, `userId`, `profileReportId`, `profileMonitoringId`.

### `references.model` value = **target table name** (snake_case/plural, as created by its own migration):
`agencies`, `users`, `profile_reports`, `profile_monitoring`. **Not** the PascalCase class.

### onDelete / onUpdate rule

| FK nullable?                  | onDelete     | onUpdate    |
| ----------------------------- | ------------ | ----------- |
| `allowNull: false` (required) | `"CASCADE"`  | `"CASCADE"` |
| `allowNull: true` (optional)  | `"SET NULL"` | `"CASCADE"` |

### Table options (both files)

```
charset: "utf8mb4",
collate: "utf8mb4_unicode_ci",
```

### Standard trailing columns (EVERY table, in this order, at the end)

These five columns close out every table. Copy verbatim into both migration `createTable`
and model `init()`:

```js
metadata: {
    type: DataTypes.JSON,
},
status: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
},
created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
},
updated_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
},
deleted_at: {
    allowNull: true,
    type: DataTypes.DATE,
    defaultValue: null,
},
```

- `metadata` — JSON catch-all for extra fields.
- `status` — boolean active-flag (`true` = active). Separate from soft delete.
- `created_at` / `updated_at` / `deleted_at` — timestamps. All models are **paranoid**
(soft delete via `deleted_at`); map them in model options via
`createdAt` / `updatedAt` / `deletedAt` + `paranoid: true`.

**`deleted_at` is always the last column. Never add a column after it** — in the
migration `createTable`, in the model `init()`, or when altering an existing table.
New business columns go *above* the `metadata` / `status` / `created_at` / `updated_at` /
`deleted_at` block, so the trailing block stays intact and identical across every table.

When adding a column to an existing table, place it before the trailing block explicitly
instead of letting MySQL append it at the end:

```js
await queryInterface.addColumn("<snake_table>", "<new_col>", {
    type: DataTypes.STRING,
    allowNull: true,
    after: "<last_business_column>",   // NOT after deleted_at
});
```

Mirror the same position in the model `init()` — the new column goes above `metadata`.

---

## Part 1 — The Migration

Plain JS, CommonJS, `sequelize-cli` style.

### Skeleton

```js
"use strict";
/** @type {import('sequelize-cli').Migration} */
module.exports = {
    async up(queryInterface, DataTypes) {
        await queryInterface.createTable(
            "deep_analysis",
            { /* columns */ },
            { charset: "utf8mb4", collate: "utf8mb4_unicode_ci" }
        );
    },
    async down(queryInterface) {
        await queryInterface.dropTable("deep_analysis");
    },
};
```

### Primary key

```js
id: {
    allowNull: false,
    autoIncrement: true,
    primaryKey: true,
    type: DataTypes.INTEGER,
},
```

### Foreign key (migration shape)

Note `foreignKey: true` and `references.as` — present in migration, dropped in model.

```js
agencyId: {
    type: DataTypes.INTEGER,
    foreignKey: true,
    allowNull: false,                 // false=required, true=optional
    onUpdate: "CASCADE",
    onDelete: "CASCADE",              // SET NULL when nullable
    references: {
        model: "agencies",            // TARGET TABLE name
        key: "id",
        as: "agencyId",               // 'as' = the FK column name itself
    },
},
```

### UUID

```js
uuid: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    unique: true,
},
```

### ENUM (literal `values` array)

```js
fetch_status: {
    type: DataTypes.ENUM,
    values: ["pending", "inprogress", "completed", "failed", "other"],
    allowNull: false,                 // optional ones: defaultValue: null
},
```

### Trailing columns

End with the standard `metadata` / `status` / `created_at` / `updated_at` / `deleted_at`
block — see Part 0 → "Standard trailing columns".

---

## Part 2 — The Model

TypeScript. `export default function(sequelize)` that calls `Model.init()` and returns
the class.

### Imports

```ts
"use strict";
import {
    Model, DataTypes, InferAttributes, InferCreationAttributes,
    CreationOptional, ForeignKey, Sequelize, ModelStatic,
} from "sequelize";
import { restoreRowsByCriteria, deleteRowsByCriteria } from "../hooks/Hooks";
```

### ENUM values (hoisted, exported)

Mirror migration `values`. One `as const` array + derived type per ENUM column.

```ts
export const FETCH_STATUS = ["pending","inprogress","completed","failed","other"] as const;
export type FetchStatus = (typeof FETCH_STATUS)[number];
```

### Class + TS declarations

```ts
class DeepAnalysis extends Model<
    InferAttributes<DeepAnalysis>,
    InferCreationAttributes<DeepAnalysis>
> {
    declare id: CreationOptional<number>;
    declare uuid: CreationOptional<string>;

    declare agencyId: ForeignKey<number>;          // required FK
    declare userId: ForeignKey<number | null>;     // nullable FK

    declare full_name: string | null;              // nullable data
    declare fetch_status: FetchStatus;             // required ENUM
    declare status: CreationOptional<boolean>;     // defaulted

    declare created_at: CreationOptional<Date>;
    declare updated_at: CreationOptional<Date>;
    declare deleted_at: CreationOptional<Date | null>;

    // associations
    declare agency?: Model;
    declare worker_tasks?: Model[];
}
```

Declaration rules:

- Auto/defaulted (id, uuid, status, timestamps) → `CreationOptional<...>`.
- FKs → `ForeignKey<number>` / `ForeignKey<number | null>`.
- Nullable data → `T | null`; required → bare `T`.
- Associations → `declare <alias>?: Model;` (one) / `Model[]` (many).

### Foreign key (model `init()` shape)

Same as migration **minus** `foreignKey: true` and **minus** `references.as`:

```ts
agencyId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    onUpdate: "CASCADE",
    onDelete: "CASCADE",
    references: { model: "agencies", key: "id" },
},
```

### ENUM (model `init()`)

```ts
fetch_status: { type: DataTypes.ENUM(...FETCH_STATUS), allowNull: false },
standard_status: { type: DataTypes.ENUM(...STANDARD_STATUS), defaultValue: null },
```

### Associations — `static associate(models)`

FK `name` = camelCase column; `as` = accessor alias (snake_case here); `models.X` = class.

```ts
static associate(models: Record<string, ModelStatic<Model>>) {
    this.belongsTo(models.Agency, {
        foreignKey: { name: "agencyId", allowNull: false },
        as: "agency",
    });
    this.hasMany(models.DeepAnalysisJunctions, {
        foreignKey: { name: "deepAnalysisId", allowNull: true },
        as: "deep_analysis_junctions",
    });
    this.belongsToMany(models.DeepAnalysisGroup, {
        through: models.DeepAnalysisGroupJunction,
        foreignKey: "deepAnalysisId",      // this side
        otherKey: "deepAnalysisGroupId",   // other side
        as: "deep_analysis_group",
    });
}
```

- `belongsTo` → this table holds the FK.
- `hasMany` → other table holds `<thisEntityCamel>Id`.
- `belongsToMany` → `through` junction + `foreignKey` (this) + `otherKey` (other).
- Junction FK naming: `<entityCamel>Id` each side (`deepAnalysisId`, `workerTaskId`).

### init() options

```ts
{
    sequelize,
    modelName: "DeepAnalysis",
    tableName: "deep_analysis",
    charset: "utf8mb4",
    collate: "utf8mb4_unicode_ci",
    createdAt: "created_at",     // map to snake_case migration columns
    updatedAt: "updated_at",
    deletedAt: "deleted_at",
    paranoid: true,              // soft delete
    hooks: { /* optional, see below */ },
}
```

### Export

```ts
export default function (sequelize: Sequelize) {
    DeepAnalysis.init({ /* columns */ }, { /* options */ });
    return DeepAnalysis;
}
```

### Optional: `toJSON` override (strip internal keys)

```ts
override toJSON() {
    const values = { ...this.get() } as Partial<InferAttributes<DeepAnalysis>>;
    delete values.id;
    delete values.agencyId;
    delete values.userId;
    return values;
}
```

### Optional: Indexes

Declare in `init()` options via `indexes: [...]`. Common case is a unique composite
(e.g. a junction's two FKs). Give every index an explicit short `name`.

```ts
indexes: [
    {
        unique: true,
        fields: ["agencyId", "audienceOverlapId"],
        name: "agency_aud_overlap_junc_agency_overlap_uniq",
        where: { deleted_at: null },   // paranoid: only enforce uniqueness on live rows
    },
],
```

- **Paranoid + unique:** add `where: { deleted_at: null }` so soft-deleted rows don't
block re-inserting the same pair. Omit it and `.restore()`/re-create will hit the
unique constraint.
- `name` is required by convention (keep it short — DB identifier limits).
- Sequelize creates these on `sync`; in this repo schema comes from migrations, so for an
existing table add the index via `queryInterface.addIndex(...)` in a migration too.

---

## Part 3 — Soft Delete

Two layers. Layer 1 is mandatory; Layer 2 only when children must follow the parent.

### Layer 1 — paranoid (every table, automatic)

Soft delete is on by default for all models. Requirements:

1. Migration has a nullable `deleted_at` column (part of the standard trailing block).
2. Model options set:
   ```ts
   paranoid: true,
   deletedAt: "deleted_at",
   createdAt: "created_at",
   updatedAt: "updated_at",
   ```

Effect: `.destroy()` sets `deleted_at` instead of deleting the row; default queries
exclude soft-deleted rows; `.restore()` clears `deleted_at`. To include deleted rows in
a query pass `paranoid: false`. **Use `.restore()` — never recreate a soft-deleted row.**

### Layer 2 — cascade soft delete/restore to children (optional)

When a parent is soft-deleted, its junction/child rows should follow. Wire `afterDestroy`
/ `afterRestore` hooks to the shared helpers in `../hooks/Hooks`
(`deleteRowsByCriteria` / `restoreRowsByCriteria`).

```ts
import { deleteRowsByCriteria, restoreRowsByCriteria } from "../hooks/Hooks";

// declared at module scope — every child table + its FK column back to this entity
const relatedModels = [
    { column: "deepAnalysisId", model: "DeepAnalysisJunctions" },
    { column: "deepAnalysisId", model: "DeepAnalysisGroupJunction" },
];

// inside init() options:
hooks: {
    async afterDestroy(instance) {
        const current = relatedModels.map((m) => ({
            ...m,
            value: instance.id,
            model: sequelize.models[m.model],
        }));
        await deleteRowsByCriteria(current);
    },
    async afterRestore(instance) {
        const current = relatedModels.map((m) => ({
            ...m,
            value: instance.id,
            model: sequelize.models[m.model],
        }));
        await restoreRowsByCriteria(current);
    },
},
```

Notes:

- `column` is the FK on the **child** table pointing back here (`deepAnalysisId`).
- `model` is the child's registry name (string); resolved via `sequelize.models[...]`.
- The helpers call `destroy`/`restore` with `individualHooks: true`, so a child's own
`afterDestroy` runs too → cascade chains down multiple levels.
- For multi-table writes, pass a transaction as the 2nd arg to the helpers.

---

## Part 4 — Register the Model (REQUIRED — easy to forget)

A new model file does nothing until it's exported from the registry. Without this the
model is never initialized by `initModels()` and its `associate()` never runs.

Add one line to `packages/cx-datastore/src/models/registry.ts` (kept alphabetical):

```ts
export { default as DeepAnalysis } from "./DeepAnalysis.model";
```

How it wires up (no extra work needed):

- `models/index.ts` re-exports `registry` as `models`.
- `initModels(sequelize)` (in `src/index.ts`) loops `models`, calls each factory, then
calls every model's `associate()`. The export name becomes the key in `models.X` used
by `belongsTo(models.Agency, ...)` etc.

So association references (`models.DeepAnalysisGroup`, `models.WorkerTask`, ...) only
resolve if **those models are also registered** under those exact names.

---

## Checklist (new entity)

**Migration**

1. File `migrations/<ts>-create-<kebab>.js`.
2. `up`: `createTable("<snake>", {...}, {charset,collate})`; `down`: `dropTable("<snake>")`.
3. PK `id` (autoIncrement). FKs `<entity>Id` camel with `foreignKey:true`,
   `references.model`=target table, `references.as`=column name, onDelete per rule.
4. Data cols snake_case; ENUMs as `values` arrays.
5. `metadata`, `status`, `created_at`, `updated_at`, `deleted_at` — last five, in that
   order. `deleted_at` is the final column; nothing goes after it (new columns on
   existing tables use `after: "<last_business_column>"`).

**Model**
6. File `<Entity>.model.ts`; class + `modelName` PascalCase, `tableName` snake_case.
7. Exported ENUM `as const` arrays + derived types.
8. Class `declare`s (CreationOptional / ForeignKey / nullable) + association decls.
9. `init()` columns mirror migration (drop `foreignKey:true` + `references.as`).
10. `associate()` with belongsTo/hasMany/belongsToMany; FK `name` camel + `as` alias.
11. Options: tableName, charset/collate, timestamp mapping, `paranoid:true`.
    Optional: `indexes` (unique composites → add `where:{deleted_at:null}` for paranoid).

**Soft delete**
12. `deleted_at` column + `paranoid:true` + `deletedAt:"deleted_at"` (Layer 1, always).
13. If children must follow parent: `relatedModels` + `afterDestroy`/`afterRestore` hooks (Layer 2).

**Register**
14. Add `export { default as <Entity> } from "./<Entity>.model";` to `models/registry.ts`.
    (Without this the model is never initialized and `associate()` never runs.)

**Both**
15. Migration columns ≡ model `init()` columns.
