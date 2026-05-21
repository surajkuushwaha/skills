---
name: feature-plan
description: Write a stakeholder-friendly feature/project plan document covering problem, solution, components, phased implementation, scope boundaries, and open questions. Use when user wants to draft a plan, PRD-lite, project brief, or feature plan; or asks to "write a plan", "plan this feature", "create a project plan".
---

# Feature Plan

Produce a plan document anyone (engineer, PM, designer, non-technical stakeholder) can read top-to-bottom and understand. Plain language, no jargon, no implementation detail.

## Workflow

1. **Gather the inputs.** Ask the user — or read from conversation context — for:
   - Feature or project name.
   - The problem (who is hurting, how, why now).
   - The intended approach at a story level (not code).
   - Known major components.
   - Phasing intuition (what must come first, what can run in parallel).
   - Anything explicitly out of scope.
   - Decisions not yet made (open questions + likely owners).

   Don't proceed until you have at least: name, problem, solution sketch, and one or more components.

2. **Draft using [TEMPLATE.md](./TEMPLATE.md).** Fill every section. If a section genuinely has nothing yet, write a one-line note like _"To be decided in Phase 1."_ — don't delete the heading.

3. **Tone rules**:
   - Section 1 (Problem) and 2 (Solution): plain English, no technical terms. Imagine reading it to a customer.
   - Section 3+ (Components onward): may name modules/services but still avoid code or signatures.
   - Use the **`> blockquote`** intro under each heading exactly as in the template — it tells the reader what the section answers.

4. **Mermaid diagram (Section 4)**: must be syntactically valid. Phases on the main flow, components branching off each phase. Style every node — don't leave the diagram half-coloured.

5. **Output location**:
   - Default: write to `docs/plans/<kebab-case-name>.md` in the current repo.
   - If `docs/plans/` doesn't exist, ask the user where to put it (or fall back to repo root).
   - Confirm path before writing.

6. **Set the footer** (`Document Owner: …` / `Last Updated: …`) with the user's name (ask if unknown) and today's date.

## Quality checklist

Before handing off, verify:

- [ ] Problem section readable by a non-engineer.
- [ ] Solution section says _what_, not _how_.
- [ ] At least 2 components in the table, each with a one-line "why".
- [ ] Mermaid block parses (no syntax bugs — check `fill:` and `style` lines).
- [ ] At least 2 phases, each with a 1–2 sentence outcome statement.
- [ ] Out-of-scope list is non-empty (force a decision — write "(none identified)" only as last resort).
- [ ] Open questions table has owners (or "TBD").
- [ ] Footer dated.

## When NOT to use this

- Need a deep technical design → use an ADR / RFC instead.
- Need to break a plan into trackable issues → use `to-issues` after this.
- Need a one-pager for executive review → trim to Sections 1, 2, 5 only.
