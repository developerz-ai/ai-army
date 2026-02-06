# AI Army Project

Use Claude Code to build and deploy your bot army.

## Quick Start

```bash
npm install
npx ai-army validate
docker-compose up -d
```

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
