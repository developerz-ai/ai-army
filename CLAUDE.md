# AI Army Project

Use Claude Code to build and deploy your bot army.

## Quick Start

```bash
npm install
npx ai-army validate
docker-compose up -d
```

## Layout

The application lives in `apps/ai-army/` — `src/`, `test/`, `bots/`, `scripts/`, `migrations/`, `templates/`, `demo/`, `mcp-servers/`, `skills/`, `config.json` and `docker-compose.yml`. Run `npm`/`npx`/`docker compose` commands from `apps/ai-army/`; the root `package.json` scripts delegate there. `bin/` and `.github/` stay at the repo root, and `bin/check` remains the gate, run from the repo root.

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
