# Building Your AI Army

This project uses the ai-army framework. Each bot is independent with its own:
- Personality (soul.md)
- Workspace (persistent directory)
- Tools (bash, files, web search)
- Channel (Slack, Discord, REST)

## Architecture

- `src/core/` - Orchestration engine and session management
- `src/adapters/` - Channels, secrets, storage adapters
- `src/execution/` - Docker container management
- `bots/*/` - Your bot definitions

### How It Works

1. The orchestrator loads bot configs from `bots/`
2. Each bot runs in an isolated Docker container
3. Messages arrive via channels (Slack, Discord, REST)
4. The orchestrator routes messages to the correct bot
5. Bots respond using their configured AI provider

## Project Structure

```
my-ai-army/
├── config.json          # Main config (providers, defaults, channels)
├── docker-compose.yml   # PostgreSQL and services
├── .env                 # Secrets (never commit)
├── bots/                # Bot definitions
│   └── assistant/       # Default bot
│       ├── config.json  # Bot settings (model, tools, provider)
│       └── soul.md      # Bot personality and instructions
├── migrations/          # SQL migration files
└── data/                # Persistent bot workspaces
```

## Conventions

- One bot = one directory in `bots/`
- Each bot has `config.json` + `soul.md`
- All configs use `${ENV_VAR}` for secrets (never hardcode)
- Sessions stored in PostgreSQL
- Validate config after every change with `npx ai-army validate`

### Bot Config Structure

Each bot `config.json` requires:
- `id` - unique bot identifier (kebab-case)
- `soul` - path to the soul.md file
- `provider` - which AI provider to use
- `model` - which model to use
- `tools` - array of enabled tools

### Soul.md Structure

The `soul.md` file defines the bot personality:
- Top-level heading with bot name
- Core values and behavior guidelines
- Capabilities and limitations
- Domain-specific instructions

## Configuration

### Providers

Configure AI providers in the root `config.json`:

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

### Channels

Add communication channels:

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

All secrets use `${VAR_NAME}` interpolation in config files.
Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

## Testing

```bash
npm run test:unit        # Fast unit tests
npm run test:integration # With Docker/DB
npm test                 # All tests
```

## Common Operations

### Adding a New Bot

1. Create a directory under `bots/` (e.g., `bots/my-bot/`)
2. Add `config.json` with model, tools, and provider
3. Add `soul.md` with personality and instructions
4. Run `npx ai-army validate` to verify
5. Run `npx ai-army reload` to load without restart

### Modifying a Bot

1. Edit `bots/<bot>/soul.md` for personality changes
2. Edit `bots/<bot>/config.json` for tools or model changes
3. Run `npx ai-army validate` then `npx ai-army reload`

### Troubleshooting

- Check logs: `docker-compose logs -f`
- Verify config: `npx ai-army validate`
- Check status: `npx ai-army status`
- Restart: `npx ai-army start`
