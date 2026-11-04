# AI Army Demo

Working demo of the [ai-army](https://github.com/developerz-ai/ai-army) framework with 3 example bots.

Demonstrates message routing, tool execution (bash), and file operations -- the core capabilities of a multi-bot AI system.

## Prerequisites

- **Node.js 22+** - [Download](https://nodejs.org/)
- **Docker** - [Install](https://docs.docker.com/get-docker/)
- **Anthropic API key** - [Get one](https://console.anthropic.com/)

## Quick Start

```bash
# 1. Run the setup script (starts PostgreSQL 18, installs deps, runs migrations)
./scripts/setup.sh

# 2. Set your API key
#    Edit .env and replace "your-anthropic-api-key-here" with your real key
nano .env

# 3. Start the server
npm start

# 4. Test the bots (in another terminal)
./scripts/test.sh
```

That's it. Three bots are now running and ready to receive messages via REST API.

## Demo Bots

| Bot | Model | Tools | Purpose |
|-----|-------|-------|---------|
| **echo-bot** | claude-haiku-4-5 | none | Simplest bot -- proves message routing works |
| **calculator-bot** | claude-sonnet-4-5 | bash | Arithmetic via `bc` -- demonstrates tool execution |
| **file-assistant** | claude-sonnet-4-5 | bash, readFile, writeFile, glob | File operations in a persistent workspace |

### Echo Bot

Repeats what you say with an "Echo:" prefix. No tools, no sandbox -- the minimal viable bot.

```bash
curl -s -X POST http://localhost:3000/api/bots/echo-bot/message \
  -H 'Content-Type: application/json' \
  -d '{"message": "Hello from the demo!"}'
```

### Calculator Bot

Uses the `bash` tool to run calculations with `bc`. Demonstrates tool execution inside a Docker container.

```bash
curl -s -X POST http://localhost:3000/api/bots/calculator-bot/message \
  -H 'Content-Type: application/json' \
  -d '{"message": "What is 15 times 23?"}'
```

### File Assistant

Manages files in a persistent workspace at `/home/agent`. Demonstrates file I/O tools (readFile, writeFile, glob).

```bash
curl -s -X POST http://localhost:3000/api/bots/file-assistant/message \
  -H 'Content-Type: application/json' \
  -d '{"message": "Create a file called test.txt with content: Hello World"}'
```

## Project Structure

```
demo/
├── config.json               # Main config (providers, defaults, sandbox)
├── .env.example              # Environment variable template
├── package.json              # Demo package (depends on ai-army)
├── docker-compose.yml        # PostgreSQL 18 + ai-army services
├── bots/
│   ├── echo-bot/
│   │   ├── config.json       # Bot-specific config
│   │   └── soul.md           # Personality/instructions
│   ├── calculator-bot/
│   │   ├── config.json
│   │   └── soul.md
│   └── file-assistant/
│       ├── config.json
│       └── soul.md
├── scripts/
│   ├── setup.sh              # One-command setup
│   ├── test.sh               # Validate & test all bots
│   └── cleanup.sh            # Remove containers, volumes, data
└── data/                     # Bot workspaces (created at runtime)
```

## Scripts

### `./scripts/setup.sh`

One-command initialization:

1. Checks prerequisites (Node.js 22+, Docker)
2. Creates `.env` from `.env.example`
3. Starts PostgreSQL 18 in Docker
4. Waits for database readiness
5. Installs npm dependencies
6. Runs database migrations
7. Validates configuration

The script is idempotent -- safe to run multiple times.

### `./scripts/test.sh`

Validates configuration and sends test messages to all bots:

```bash
./scripts/test.sh                  # Full test (validate + send messages)
./scripts/test.sh --validate-only  # Offline config validation only
./scripts/test.sh --bot echo-bot   # Test a single bot
./scripts/test.sh --port 4000      # Custom API port
./scripts/test.sh --timeout 30     # Set response timeout (seconds)
./scripts/test.sh --verbose        # Show full response bodies
```

### `./scripts/cleanup.sh`

Removes all demo artifacts:

```bash
./scripts/cleanup.sh               # Default cleanup
./scripts/cleanup.sh --keep-db     # Keep PostgreSQL container
./scripts/cleanup.sh --all         # Full reset (also removes .env)
```

## npm Scripts

```bash
npm start          # Start the ai-army server
npm run dev        # Start in development mode
npm run validate   # Validate config files
npm run migrate    # Run database migrations
npm run setup      # Alias for ./scripts/setup.sh
npm run test:bots  # Alias for ./scripts/test.sh
npm run cleanup    # Alias for ./scripts/cleanup.sh
```

## Configuration

### Environment Variables

Copy `.env.example` to `.env` and set your values:

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-...

# Auto-configured by setup.sh
DATABASE_URL=postgresql://demo:demo@localhost:5432/ai_army_demo
```

Optional port overrides:

```bash
DEMO_PG_PORT=5433      # PostgreSQL port (default: 5432)
DEMO_API_PORT=4000     # API server port (default: 3000)
```

### Adding a New Bot

1. Create a directory under `bots/`:

```bash
mkdir bots/my-bot
```

2. Add `config.json`:

```json
{
  "id": "my-bot",
  "name": "My Bot",
  "description": "What this bot does",
  "soul": "./soul.md",
  "provider": "anthropic",
  "model": "claude-sonnet-4-5",
  "tools": ["bash"]
}
```

3. Add `soul.md` with the bot's personality and instructions:

```markdown
# My Bot

You are a helpful assistant that specializes in...
```

4. Restart the server (`npm start`). The new bot is available at `/api/bots/my-bot/message`.

## Docker Compose

For a fully containerized setup (PostgreSQL + ai-army in Docker):

```bash
# Copy and configure environment
cp .env.example .env
nano .env  # Set ANTHROPIC_API_KEY

# Start all services
docker compose up -d

# View logs
docker compose logs -f

# Stop everything
docker compose down

# Stop and remove all data
docker compose down -v
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/bots` | List all registered bots |
| `POST` | `/api/bots/:botId/message` | Send a message to a bot |

### Send a message

```bash
curl -s -X POST http://localhost:3000/api/bots/echo-bot/message \
  -H 'Content-Type: application/json' \
  -d '{"message": "Hello!"}' | jq .
```

### List bots

```bash
curl -s http://localhost:3000/api/bots | jq .
```

## Troubleshooting

### PostgreSQL won't start

```bash
# Check if port 5432 is already in use
lsof -i :5432

# Use a different port
DEMO_PG_PORT=5433 ./scripts/setup.sh
```

### Connection refused on port 3000

Make sure the server is running:

```bash
npm start
# Or check if another process uses port 3000:
lsof -i :3000
```

### API key errors

Verify your `.env` file has a valid `ANTHROPIC_API_KEY`:

```bash
grep ANTHROPIC_API_KEY .env
# Should show: ANTHROPIC_API_KEY=sk-ant-...
```

### Clean slate

Remove everything and start over:

```bash
./scripts/cleanup.sh --all
./scripts/setup.sh
```

## Learn More

- [AI Army Framework](https://github.com/developerz-ai/ai-army) - Full framework documentation
- [Architecture Overview](../docs/idea/00-overview.md) - High-level project vision
- [Bot Configuration](../docs/idea/03-bots.md) - Bot definitions (soul.md, Dockerfile)
- [Getting Started Guide](../docs/idea/11-getting-started.md) - Framework quick start
