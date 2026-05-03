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

# Folder Structure

Group by **feature**, not layer. One module = one folder.

```
src/
└── modules/
    ├── user/
    │   ├── index.ts            # public barrel
    │   ├── user.route.ts
    │   ├── user.controller.ts
    │   ├── user.service.ts
    │   ├── user.repository.ts
    │   ├── user.schema.ts
    │   └── user.util.ts
    └── order/
        └── ... (same shape)
```

Naming:

- Pattern: `<feature>.<layer>.ts` under `src/modules/<feature>/`
- `<feature>`: kebab-case, singular (`user-profile`, not `userProfile`/`users`)
- One feature = one folder; never split across top-level layer folders

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
  // business logic
  return await userRepository.create(data);
};
```

## Repository

DB ops only. No business logic. No req/res.

```ts
export const create = async (data) => {
  return db.users.insert(data);
};
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
export * from "./user.route";
export * from "./user.controller";
export * from "./user.service";
export * from "./user.schema";
```

Rules:

- Repository + util stay internal unless another module legitimately needs them
- Cross-module imports go through `index.ts` (`import { userService } from "@/modules/user"`)
- Intra-module imports use relative paths

# Implementation Steps

1. Create `src/modules/<feature>/`
2. Schema (`<feature>.schema.ts`) — validation + types
3. Repository (`<feature>.repository.ts`) — DB functions
4. Service (`<feature>.service.ts`) — business logic (may use util)
5. Util (`<feature>.util.ts`) — pure helpers (must NOT import service)
6. Controller (`<feature>.controller.ts`) — with jsDoc
7. Route (`<feature>.route.ts`) — RESTful endpoints
8. `index.ts` — re-export public surface

# Rules (Strict)

- DB access: repository only
- No business logic in controller
- Route never calls repository directly
- Services HTTP-independent + reusable
- **Util forbidden from importing service/controller/repository/route** (one-way: service → util)
- Schema = types + validation only, no runtime logic
- Cross-module access through `index.ts` barrel only
- Code: async/await consistent, modular, readable

# Anti-patterns

- Fat controllers with embedded logic
- Services touching req/res
- Repository containing business rules
- Tight coupling between layers
- Reaching into another module's internal files (bypass `index.ts`)

# Works well with

- cx-tdd
- cx-improve-architecture
- cx-domain-model
