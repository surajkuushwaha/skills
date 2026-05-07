---
name: cx-modular-architecture
description: Scaffold backend features using a modular layered architecture (route → controller → service → repository) where each feature is a self-contained module. Use when creating a new API/backend feature, refactoring into a clean structure, or enforcing separation of concerns.
---

# When to use

- New API/backend feature
- Refactor into clean layered structure
- Enforce separation of concerns

# Architecture

Flow: `route → controller → service → repository`. Layers strict, no overlap.
Side files per feature: `schema` (types/validation), `util` (pure helpers), `index.ts` (barrel).

All repositories live in `packages/cx-datastore/src/repositories/`. Never inside `src/modules/`.

# Folder Structure

Group by **feature**, not layer. One module = one folder.

```
src/
└── modules/
    ├── user/
    │   ├── index.ts                    # public barrel
    │   ├── controller/
    │   │   └── user.controller.ts
    │   ├── service/
    │   │   └── user.service.ts
    │   ├── schema/
    │   │   └── user.schema.ts
    │   └── util/
    │       └── user.util.ts
    └── order/
        └── ... (same shape)

packages/
└── cx-datastore/
    └── src/
        └── repositories/
            ├── index.ts                # aggregates all domain repos
            ├── user/
            │   ├── index.ts            # exports domain repo classes
            │   └── user.repository.ts
            └── campaign_report/
                ├── index.ts
                └── campaign_report.repository.ts

src/shared/db/
    ├── index.ts                        # initializes models via initModels()
    ├── sequelize.ts                    # sequelize connection
    └── repositories.ts                 # instantiates all repo classes with models
```

Naming:

- Repository: `packages/cx-datastore/src/repositories/<domain>/<feature>.repository.ts`
- `<feature>`: snake_case, singular (`user_profile`, not `userProfile`/`user-profile`/`users`)
- `<domain>`: snake_case folder grouping related repos (`campaign_report`, `analytics`)
- Folder names: snake_case always (`campaign_report/`, `user_profile/`)
- File names: snake_case always (`user_profile.repository.ts`, `user_profile.service.ts`)
- Exception — model files only: PascalCase (`UserProfile.model.ts`, `CampaignReport.model.ts`)

# Layer Responsibilities

## Route

Define RESTful endpoints. No logic. Delegate to controller only.

```ts
router.post("/users", createUserController);
```

## Controller

Handle req/res. Validate input. jsDoc with route(s) + description. Delegate logic to service. Multi-route → document all.

```ts
/**
 * @route POST /users
 * @description Create a new user
 */
export const createUserController = async (req, res) => {
  const result = await createUserService(req.body);
  res.json(result);
};
```

## Service

Business logic. No HTTP. Calls repository for data. May use util.

```ts
export const createUserService = async (data) => {
  return await userRepository.create(data);
};
```

## Repository

DB ops only. No business logic. No req/res. All repos live in `packages/cx-datastore/src/repositories/<domain>/`.

- Class exported (NOT instance) — `export default FooRepository`
- Constructor accepts `models: ModelsType` (and optionally `sequelize: Sequelize`)
- `ModelsType = Pick<InitializedModels, "Model1" | "Model2">` — only models this repo needs
- Never instantiated in the repo file itself
- Instantiated once in `src/shared/db/repositories.ts`

**Step 1 — Write the repository class:**

```ts
// packages/cx-datastore/src/repositories/user/user.repository.ts
import { Model, Transaction } from "sequelize";
import type { InitializedModels } from "../../index";

type ModelsType = Pick<InitializedModels, "User">;

class UserRepository {
  private models: ModelsType;

  constructor(models: ModelsType) {
    this.models = models;
  }

  async create(
    data: Record<string, unknown>,
    transaction?: Transaction,
  ): Promise<Model> {
    return this.models.User.create(data, {
      ...(transaction ? { transaction } : {}),
    });
  }

  async findById(id: number): Promise<Model | null> {
    return this.models.User.findByPk(id);
  }
}

export default UserRepository;
```

**Step 2 — Add to domain index.ts:**

```ts
// packages/cx-datastore/src/repositories/user/index.ts
import UserRepository from "./user.repository";

const userRepositories = {
  UserRepository,
};

export default userRepositories;
```

**Step 3 — Register in root repositories/index.ts:**

```ts
// packages/cx-datastore/src/repositories/index.ts
import { default as campaignReportRepositories } from "./campaign_report";

const repositories = {
  campaignReport: campaignReportRepositories,
};

export default repositories;
```

**Step 4 — Instantiate in src/shared/db/repositories.ts:**

```ts
// src/shared/db/repositories.ts
import { repositories } from "@culturex-art/datastore";
import { models } from "./index";
import { sequelize } from "./sequelize";

export const userRepository = new repositories.user.UserRepository({
  User: models.User,
});

// Pass sequelize as 2nd arg when repo needs raw queries or transactions:
export const campaignReportRepository =
  new repositories.campaignReport.CampaignReportRepository(
    { Campaign: models.Campaign, CampaignReport: models.CampaignReport },
    sequelize,
  );
```

**Step 5 — Import in service:**

```ts
import { userRepository } from "../../../shared/db/repositories";
```

## Schema

Validation schemas, DTOs, shared types. No runtime logic, no I/O, no side effects. Imported by controller (validate), service (types), repository (entity shape).

```ts
import { z } from "zod";

export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
```

## Util (Helper)

Pure, stateless, feature-scoped. No HTTP, no DB, no business decisions.
**Service → Util OK. Util → Service/Controller/Repository/Route FORBIDDEN.**
Helper need logic or I/O? Move to service.

```ts
export const formatUserDisplayName = (firstName: string, lastName: string) => {
  return `${firstName} ${lastName}`.trim();
};
```

# Module Exports (`index.ts`)

Every module folder has `index.ts` re-exporting public surface. Other modules import only from barrel — never reach internals.

```ts
// src/modules/user/index.ts
export * from "./routes/user.routes";
export * from "./controller/user.controller";
export * from "./service/user.service";
export * from "./schema/user.schema";
```

Rules:

- Util stays internal unless another module legitimately needs it
- Cross-module imports go through `index.ts` (`import { userService } from "@/modules/user"`)
- Intra-module imports use relative paths

# Implementation Steps

1. Create `src/modules/<feature>/`
2. `schema/<feature>.schema.ts` — validation + types
3. `packages/cx-datastore/src/repositories/<domain>/<feature>.repository.ts` — class, constructor injection, `export default ClassName`
4. `packages/cx-datastore/src/repositories/<domain>/index.ts` — add to domain object
5. `packages/cx-datastore/src/repositories/index.ts` — add domain if new
6. `src/shared/db/repositories.ts` — instantiate with `new repositories.<domain>.FooRepository({ ...models })`
7. `service/<feature>.service.ts` — imports named instance from `shared/db/repositories`
8. `util/<feature>.util.ts` — pure helpers (if needed)
9. `controller/<feature>.controller.ts` — jsDoc
10. `routes/<feature>.routes.ts` — RESTful endpoints
11. `index.ts` — re-export public surface

# Rules (Strict)

- DB access: repository only, always in `packages/cx-datastore/src/repositories/`
- Never put a repository inside `src/modules/`
- Repository: constructor-injected models, exports class (not instance), instantiated only in `src/shared/db/repositories.ts`
- No business logic in controller
- Route never calls repository directly
- Services HTTP-independent + reusable
- **Util forbidden from importing service/controller/repository/routes** (one-way: service → util)
- Schema = types + validation only, no runtime logic
- Cross-module access through `index.ts` barrel only
- Code: async/await consistent, modular, readable

# Anti-patterns

- Fat controllers with embedded logic
- Services touching req/res
- Repository containing business rules
- Tight coupling between layers
- Reaching into another module's internal files (bypass `index.ts`)
- `export default new FooRepository()` in repo file — never instantiate there
- Repository living in `src/modules/` — always belongs in cx-datastore

# Works well with

- cx-tdd
- cx-improve-architecture
- cx-domain-model
