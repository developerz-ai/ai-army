# AI Army Project

Use Claude Code to build and deploy your bot army.

## Quick Start

```bash
npm install
npx ai-army validate
docker-compose up -d
npx ai-army migrate
npx ai-army start
```

## Project Structure

```
my-ai-army/
├── config.json          # Main configuration (providers, defaults, channels)
├── docker-compose.yml   # PostgreSQL and services
├── .env                 # Secrets (never commit)
├── .env.example         # Template for .env
├── bots/                # Bot definitions
│   └── assistant/       # Default bot
│       ├── config.json  # Bot settings (model, tools)
│       └── soul.md      # Bot personality
├── migrations/          # SQL migration files
├── data/                # Persistent bot data
└── skills/              # Shared skill definitions
```

## Create New Bot

Ask Claude: "Create a new bot called 'my-bot' that helps with..."

Claude will:
1. Create `bots/my-bot/` directory
2. Write `config.json` with model, tools, and provider
3. Write `soul.md` personality and instructions
4. Update `config.json` to include the new bot
5. Validate and reload

### Bot Config Example

```json
{
  "id": "my-bot",
  "soul": "./soul.md",
  "provider": "anthropic",
  "model": "claude-sonnet-4-5",
  "tools": ["bash", "readFile", "writeFile"]
}
```

### Soul.md Example

```markdown
# My Bot

You are a specialized assistant for...

## Core Values
- Be accurate and helpful
- Ask for clarification when needed

## Capabilities
- Describe what this bot can do
```

## Common Tasks

- "Add a new tool to support-bot"
- "Update the personality of work-bot"
- "Add a Slack channel for customer-bot"
- "Fix the error in bot-manager"
- "Show me the status of all bots"

## CLI Commands

```bash
npx ai-army validate    # Validate all configuration
npx ai-army migrate     # Run database migrations
npx ai-army start       # Start in production mode
npx ai-army dev         # Start with hot reload
npx ai-army status      # Show system status
npx ai-army reload      # Reload config without restart
```

## Configuration

### Adding a Provider

Edit `config.json` providers section:

```json
{
  "providers": {
    "anthropic": {
      "type": "anthropic",
      "apiKey": "${ANTHROPIC_API_KEY}"
    }
  }
}
```

### Adding a Channel

```json
{
  "channels": {
    "slack-main": {
      "type": "slack",
      "botToken": "${SLACK_BOT_TOKEN}",
      "appToken": "${SLACK_APP_TOKEN}"
    }
  }
}
```

### Environment Variables

All secrets use `${VAR}` interpolation in config files. Add actual values to `.env`:

```bash
cp .env.example .env
# Edit .env with your API keys
```

## Conventions

- One bot = one directory in `bots/`
- Each bot has `config.json` + `soul.md`
- All configs use `${ENV_VAR}` for secrets (never hardcode)
- Sessions are stored in PostgreSQL
- Use `npx ai-army validate` after any config change
