---
name: feature-spec
description: Write a technical spec document (architecture diagrams, request lifecycle, module breakdown, data models, implementation steps, testing plan, risks) that follows a stakeholder-facing feature plan. Use when user has a plan and wants to deepen it into a developer-ready spec, or asks to "write a spec", "create technical design", "design doc for this feature".
---

# Feature Spec

Step 2 after [feature-plan](../feature-plan/SKILL.md). The plan answers _what_ and _why_; the spec answers _how_. Output is for engineers who will implement.

## Workflow

1. **Require the plan.** Ask for the path to the PLAN.md (or read it from `docs/plans/`). The spec _must_ link back to it via the `Related Plan` field. If no plan exists, run `feature-plan` first — don't synthesise a spec without an agreed plan.

2. **Gather technical inputs:**
   - Folder structure convention (default: `src/modules/<module-name>/`).
   - Stack hints (ORM, framework, DB) — read from `package.json` / repo if unstated.
   - For each major component in the plan: file responsibilities, endpoints, auth model, edge cases.
   - Existing data models that interact with the new ones.
   - Test stack (Jest, Vitest, Supertest, etc.) — sniff from `package.json`.

3. **Draft using [TEMPLATE.md](./TEMPLATE.md).** Fill every section:
   - **Section 2 (Architecture)** — both mermaid blocks must parse and reflect this project's actual structure (route/controller/service/repository or whatever the codebase uses). If the project uses [modular-architecture](../../cx/modular-architecture/SKILL.md), keep the default layering.
   - **Section 3 (Module Breakdown)** — one subsection per component listed in the plan's Section 3. Don't drop or rename components silently.
   - **Section 4 (Data Models)** — TypeScript interfaces (or whatever the project uses). Real field names, real types. No `any`.
   - **Section 5 (Implementation Steps)** — ordered, atomic, with file paths and dependencies. Time estimates are rough; mark `~` if uncertain.

4. **Mermaid validity**: both diagrams must parse. Use `<br/>` for in-node line breaks (not `\n`). Sequence-diagram self-messages need an explicit participant (e.g. `Controller->>Controller: Validate input`). Close every subgraph and bracket.

5. **Output location**: same folder as the plan, named `<kebab-case-name>.spec.md`. Default: `docs/plans/<feature>.spec.md`. Confirm before writing.

6. **Footer**: set Author, Last Updated (today), Status = `Draft`.

## Quality checklist

- [ ] Spec links to plan via `Related Plan` field.
- [ ] Both mermaid blocks parse (no stray `\n`, all subgraphs closed, all brackets matched).
- [ ] One Section 3.x per plan component — counts match.
- [ ] Each module subsection: file table, endpoint table, logic flow, edge cases.
- [ ] Data models use real types, not placeholders.
- [ ] Implementation steps are ordered with explicit dependencies in the Notes column.
- [ ] Testing Plan covers unit + integration at minimum.
- [ ] Risks table has at least 1 row (force the question — write "(none identified)" only as last resort).
- [ ] Definition of Done checkboxes present and unchecked.

## When NOT to use this

- No prior plan → run `feature-plan` first.
- Pure refactor with no new endpoints → an ADR is lighter.
- Single-file change → just open a PR; this spec is overkill.
