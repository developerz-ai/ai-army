# AI-first scorecard

> Written by the developerz.ai maintainer agent — established by dz-runner setup mode. Each onboarding run rewrites this file whole; the latest run wins, and the same card is stored on the platform.

- Run: `run_032da44977674ab6967fa55a2fffb14d`
- Computed: 2026-11-03T16:15:31.638Z
- Proof: **proved** — every command ran green at head.
- Score: 13 of 15 items ok

## `policy` — ok

- .dz/maintainer/maintainer.yml established
- .dz/maintainer/reviewer.md established

## `brain` — ok

- CLAUDE.md already present, left alone

## `roster` — ok

- .claude/agents/postgres-migrations.md established
- .claude/agents/channel-adapters.md established
- .claude/agents/config.md established

## `skills` — ok

- .claude/skills/verify-change/SKILL.md established
- .claude/skills/database-migrations/SKILL.md established
- .claude/skills/onboarding/SKILL.md established

## `scripts` — ok

- bin/setup established
- bin/dev established
- bin/check established
- bin/stop established
- down: ./bin/stop (bin)
- ./bin/setup exited 0 at head (26.1s)

## `wiring` — ok

- .mcp.json established

## `commands` — ok

- .claude/commands/planx.md established
- .claude/commands/feature.md established

## `access` — gap

- landed 2 of 20 asked: SENTRY_ACCESS_TOKEN, SENTRY_HOST
- still missing: DATABASE_URL, OPENROUTER_API_KEY, ADMIN_API_KEY, DANIEL_API_KEY, SEBASTIAN_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, SLACK_BOT_TOKEN, SLACK_APP_TOKEN, DISCORD_BOT_TOKEN, GITHUB_TOKEN, ZAI_API_KEY, ZAI_BASE_URL, API_TOKEN, DB_PASSWORD, API_KEY, AI_ARMY_TOKEN, VPS_1_HOST

## `layout` — gap

- migration to the house layout filed as tasks
- apps/ai-army: 20 move(s) planned as one task

## `smoke_test` — ok

- test/unit/core/Orchestrator.test.js in the repository
- run by ./bin/check exited 0 at head (175.0s)

## `env_example` — ok

- .env.example already present, left alone

## `agents_md` — ok

- AGENTS.md established

## `per_workspace_brains` — ok

- single-package repository: 0 workspaces
- CLAUDE.md already present, left alone

## `docs_readme` — ok

- docs/README.md already present, left alone

## `gate_proved` — ok

- ./bin/check exited 0 at head (175.0s)
