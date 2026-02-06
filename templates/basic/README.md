# My AI Army

A multi-bot AI system built with the [ai-army](https://github.com/developerz-ai/ai-army) framework.

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment file and add API keys
cp .env.example .env
# Edit .env with your API keys (ANTHROPIC_API_KEY, etc.)

# Start PostgreSQL and other services
docker-compose up -d

# Validate configuration
npx ai-army validate

# Run migrations
npx ai-army migrate

# Start the bots
npx ai-army start
```

## What's Included

- **PostgreSQL 18** - Message history and session storage
- **Default Bot** - A basic assistant bot in `bots/assistant/`
- **Ready to Extend** - Add new bots, tools, and channels

## Creating Your First Bot

Each bot needs two files: a config and a personality.

**Step 1:** Create a directory in `bots/`:
```bash
mkdir bots/my-bot
```

**Step 2:** Create `bots/my-bot/config.json`:
```json
{
  "id": "my-bot",
  "soul": "./soul.md",
  "provider": "anthropic",
  "model": "claude-3-5-sonnet",
  "tools": ["bash", "readFile", "writeFile"],
  "sandbox": {
    "cpuLimit": "2",
    "memoryLimit": "2g",
    "timeout": 30
  }
}
```

**Step 3:** Create `bots/my-bot/soul.md`:
```markdown
# My Bot

You are a specialized assistant that helps with...

## Core Values
- Be helpful and accurate
- Ask clarifying questions when needed

## Capabilities
- Describe what your bot can do
```

**Step 4:** Update `config.json` to include your bot:
```json
{
  "bots": ["assistant", "my-bot"]
}
```

**Step 5:** Validate and reload:
```bash
npx ai-army validate
npx ai-army reload
```

## CLI Commands

```bash
npx ai-army validate      # Check configuration
npx ai-army migrate       # Run database migrations
npx ai-army start         # Start in production mode
npx ai-army dev           # Start with hot reload
npx ai-army status        # Show bot and channel status
npx ai-army reload        # Reload without restart
```

## Adding Channels

Add Slack or Discord to `config.json`:

### Slack
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

### Discord
```json
{
  "channels": {
    "discord-main": {
      "type": "discord",
      "token": "${DISCORD_BOT_TOKEN}"
    }
  }
}
```

Get tokens from:
- **Slack**: [api.slack.com/apps](https://api.slack.com/apps)
- **Discord**: [discord.com/developers/applications](https://discord.com/developers/applications)

## Configuration Structure

### `config.json` - Main configuration file
- `providers` - API credentials (Anthropic, OpenAI, etc.)
- `defaults` - Default model, temperature, max_tokens
- `channels` - Slack, Discord, REST connections
- `bots` - List of bot IDs to load

### `bots/*/config.json` - Individual bot settings
- `id` - Unique identifier (kebab-case)
- `soul` - Path to personality file
- `provider` - Which API provider (anthropic, openai, etc.)
- `model` - Model to use
- `tools` - Tools available (bash, readFile, writeFile, glob, grep)
- `sandbox` - Container limits

### `.env` - Secrets (never commit)
```bash
ANTHROPIC_API_KEY=sk-ant-...
SLACK_BOT_TOKEN=xoxb-...
DISCORD_BOT_TOKEN=...
```

Use `${VARIABLE_NAME}` in configs to reference `.env` values.

## Docker Sandbox

Bots run in isolated Docker containers. Configure resource limits in bot config:

```json
{
  "sandbox": {
    "image": "node:22-alpine",
    "cpuLimit": "2",
    "memoryLimit": "2g",
    "timeout": 30,
    "workdir": "/bot-workspace",
    "environment": {
      "NODE_ENV": "production"
    }
  }
}
```

## Persistent Storage

- **Sessions** - Stored in PostgreSQL (automatic)
- **Bot Data** - Each bot has a workspace directory at `data/bot-{id}/`
- **Tools** - File operations (`readFile`, `writeFile`, `glob`, `grep`)

## Security

- Never commit `.env` (use `.env.example`)
- API keys are redacted in logs
- All bot code runs in sandboxed Docker containers
- SQL queries use parameterized statements

## Troubleshooting

### Bots not starting?
```bash
npx ai-army validate    # Check for config errors
docker-compose logs     # See container logs
npm test                # Run test suite
```

### Database issues?
```bash
docker-compose ps       # Check if PostgreSQL is running
docker-compose down
docker-compose up -d
npx ai-army migrate     # Re-run migrations
```

### Permission errors?
```bash
chmod +x scripts/*.sh   # Make scripts executable
```

## Documentation

- **[ai-army Framework](https://github.com/developerz-ai/ai-army)** - Main docs
- **CLAUDE.md** - Development instructions
- **AGENT.md** - AI agent guidelines

## Common Tasks

```bash
# See what bots are running
npx ai-army status

# Add a new tool to a bot
# Edit bots/my-bot/config.json and add tool name

# View recent sessions
# Query PostgreSQL sessions table directly

# Stop all bots
docker-compose down

# Clear all data and restart
npx ai-army reset  # (if available)
rm -rf data/
npx ai-army migrate
```

## File Structure

```
.
├── README.md                 # This file
├── config.json               # Main configuration
├── docker-compose.yml        # PostgreSQL service
├── .env.example              # Environment variables template
├── .env                       # (Ignore) Actual secrets
├── .gitignore                # (Ignore) Git ignore rules
├── bots/                      # Bot definitions
│   └── assistant/             # Default bot
│       ├── config.json        # Bot settings
│       └── soul.md            # Bot personality
├── migrations/                # Database migrations (auto-created)
├── data/                      # Bot workspaces (auto-created)
└── node_modules/              # Dependencies (auto-created)
```

## Next Steps

1. ✅ Copy `.env.example` to `.env` and add API keys
2. ✅ Start services: `docker-compose up -d`
3. ✅ Validate: `npx ai-army validate`
4. ✅ Run migrations: `npx ai-army migrate`
5. ✅ Start bots: `npx ai-army start`
6. ✅ Create your first custom bot (see "Creating Your First Bot" above)
7. ✅ Connect a channel (Slack or Discord)
8. ✅ Test by messaging your bot

---

Built with [ai-army](https://github.com/developerz-ai/ai-army) - An open-source framework for multi-bot AI systems.
