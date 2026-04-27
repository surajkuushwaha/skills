# My Pi Skills

A collection of skills for the [pi coding agent](https://github.com/mariozechner/pi-coding-agent).

## Installation

To use these skills, clone this repository and add its path to your `~/.pi/settings.json`:

```json
{
  "skills": [
    "/absolute/path/to/this/repo"
  ]
}
```

Alternatively, you can symlink individual skills into `~/.pi/agent/skills/`.

## Available Skills

*   **[caveman](./caveman/SKILL.md)**: Ultra-compressed communication mode.
*   **[design-an-interface](./design-an-interface/SKILL.md)**: Helps design clean, typesafe interfaces.
*   **[domain-model](./domain-model/SKILL.md)**: Assists in defining the domain model.
*   **[edit-article](./edit-article/SKILL.md)**: Workflows for editing articles.
*   **[github-triage](./github-triage/SKILL.md)**: Helps triage GitHub issues.
*   **[grill-me](./grill-me/SKILL.md)**: Agent asks tough questions to find logic holes.
*   **[improve-codebase-architecture](./improve-codebase-architecture/SKILL.md)**: Suggestions for codebase structure.
*   **[obsidian-vault](./obsidian-vault/SKILL.md)**: Interacting with Obsidian.
*   **[qa](./qa/SKILL.md)**: Workflows for quality assurance.
*   **[request-refactor-plan](./request-refactor-plan/SKILL.md)**: Generates a plan before refactoring.
*   **[scaffold-exercises](./scaffold-exercises/SKILL.md)**: Creates coding exercises.
*   **[setup-pre-commit](./setup-pre-commit/SKILL.md)**: Helps set up git hooks.
*   **[tdd](./tdd/SKILL.md)**: Specialized TDD workflow.
*   **[to-issues](./to-issues/SKILL.md)**: Converts context to GitHub issues.
*   **[triage-issue](./triage-issue/SKILL.md)**: Workflow for triaging single issues.
*   **[ubiquitous-language](./ubiquitous-language/SKILL.md)**: Shared vocabulary definition.
*   **[write-a-skill](./write-a-skill/SKILL.md)**: Helps you write more skills.
*   **[zoom-out](./zoom-out/SKILL.md)**: Big-picture project view.

## Skill Structure

Each skill should be in its own directory:

```
skill-name/
├── SKILL.md      # Frontmatter and instructions
└── scripts/      # Optional helper scripts
```

See [SKILL_TEMPLATE.md](./SKILL_TEMPLATE.md) for a starting point.
