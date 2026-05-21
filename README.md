# Skills

A Claude Code plugin bundling personal agent skills.

## Layout

```text
.claude-plugin/
└── plugin.json          # manifest — declares every skill path
skills/
├── cx/                  # CX backend conventions
├── engineering/         # coding workflows
├── misc/                # standalone utilities
└── productivity/        # general workflow tools
```

`plugin.json` lists every skill explicitly. Folder nesting is for organization only — Claude Code reads paths from the manifest.

## Available Skills

### cx

- **[modular-architecture](./skills/cx/modular-architecture/SKILL.md)** — Layered architecture (route → controller → service → repository) for backend features.

### engineering

- **[feature-plan](./skills/engineering/feature-plan/SKILL.md)** — Draft a stakeholder-friendly feature/project plan (problem, solution, components, phases, scope, open questions).
- **[feature-spec](./skills/engineering/feature-spec/SKILL.md)** — Turn an approved plan into a developer-ready technical spec (architecture diagrams, module breakdown, data models, implementation steps).
- **[grill-me](./skills/engineering/grill-me/SKILL.md)** — Agent asks tough questions to find logic holes.
- **[grill-with-docs](./skills/engineering/grill-with-docs/SKILL.md)** — Stress-test a plan against the project's domain language and ADRs, updating docs inline.

### misc

- **[git-guardrails-claude-code](./skills/misc/git-guardrails-claude-code/SKILL.md)** — Hooks to block dangerous git commands.
- **[setup-pre-commit](./skills/misc/setup-pre-commit/SKILL.md)** — Husky + lint-staged pre-commit hooks (Prettier, typecheck, tests).

### productivity

- **[caveman](./skills/productivity/caveman/SKILL.md)** — Ultra-compressed communication mode.
- **[handoff](./skills/productivity/handoff/SKILL.md)** — Compact current conversation into a handoff document for another agent.
- **[write-a-skill](./skills/productivity/write-a-skill/SKILL.md)** — Create new skills with proper structure and progressive disclosure.

## Adding a Skill

1. Create folder: `skills/<category>/<skill-name>/SKILL.md`
2. Fill frontmatter (`name`, `description`) — see [SKILL_TEMPLATE.md](./SKILL_TEMPLATE.md).
3. Append the path to the `skills` array in `.claude-plugin/plugin.json`.
4. Add a bullet under the matching category in this README.

Side files (e.g. `route.md`, `service.md`) can sit next to `SKILL.md` and be referenced from it — they load on demand, keeping trigger context small.

## Installing

Place this repo (or symlink) into `~/.claude/plugins/<plugin-name>/`, or distribute via a marketplace entry.
