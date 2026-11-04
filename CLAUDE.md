# AI Army Project

Use Claude Code to build and deploy your bot army.

## Quick Start

```bash
./bin/setup   # install dependencies, create .env, start PostgreSQL, create the test database
./bin/dev     # run the app (orchestrator + REST API)
./bin/check   # prove it: lint + test suite
```

`./bin/setup` is idempotent — it never overwrites an existing `.env`, and it
starts PostgreSQL 18 with its data volume (`pgdata`) mounted at
`/var/lib/postgresql`, the path PostgreSQL 18 expects. The legacy
`/var/lib/postgresql/data` path makes the container refuse to start.

Secrets live in `.env` (gitignored); `config.json` references them as
`${ENV_VAR}`. `.env.example` ships development placeholders — replace them
with real keys before using a provider.

## Create New Bot

Ask Claude: "Create a new bot called 'my-bot' that helps with..."

Claude will:
1. Create bots/my-bot/ directory
2. Write config.json
3. Write soul.md personality
4. Update config.json to include it
5. Validate and reload

## Common Tasks

- "Add a new tool to support-bot"
- "Update the personality of work-bot"
- "Fix the error in bot-manager"
- "Add tests for SessionManager"
