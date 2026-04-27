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

## Skill Structure

Each skill should be in its own directory:

```
skill-name/
├── SKILL.md      # Frontmatter and instructions
└── scripts/      # Optional helper scripts
```

See [SKILL_TEMPLATE.md](./SKILL_TEMPLATE.md) for a starting point.
