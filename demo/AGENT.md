# AI Army Demo - Agent Instructions

This is a working demo of the ai-army framework. It contains 3 example bots
that demonstrate message routing, tool execution, and file operations.

## How It Works

1. `config.json` defines global defaults (model, sandbox, compaction)
2. Each bot in `bots/` has `config.json` (settings) + `soul.md` (personality)
3. Bots inherit defaults from the top-level config and override what they need
4. Tools execute in isolated Docker containers (node:22-slim, 512MB, 1 CPU)
5. Sessions and state are stored in PostgreSQL 18
6. Messages arrive via REST API and route to the correct bot

### Config Inheritance

```
config.json (defaults)  -->  bots/*/config.json (overrides)  -->  env vars
```

The top-level `config.json` sets the default model (`claude-sonnet-4-5`), sandbox
settings, and provider configuration. Each bot config overrides only what it needs
(e.g., echo-bot overrides the model to `claude-haiku-4-5`).

## Project Structure

```
demo/
├── config.json               # Global defaults (model, sandbox, providers)
├── .env / .env.example       # Environment variables (ANTHROPIC_API_KEY, DATABASE_URL)
├── package.json              # Demo package (depends on ai-army via file:..)
├── docker-compose.yml        # PostgreSQL 18 + ai-army containerized deployment
├── bots/
│   ├── echo-bot/             # Simplest bot - no tools, just echoes messages
│   │   ├── config.json       # Model: claude-haiku-4-5, tools: []
│   │   └── soul.md           # Repeats input with "Echo:" prefix
│   ├── calculator-bot/       # Bash tool usage for arithmetic
│   │   ├── config.json       # Model: claude-sonnet-4-5, tools: [bash], packages: [bc]
│   │   └── soul.md           # Uses bc for integer and decimal calculations
│   └── file-assistant/       # File I/O with persistent workspace
│       ├── config.json       # Model: claude-sonnet-4-5, tools: [bash, readFile, writeFile, glob]
│       └── soul.md           # Manages files at /home/agent
├── scripts/
│   ├── setup.sh              # One-command setup (PostgreSQL, npm install, migrations)
│   ├── test.sh               # Validate configs + send test messages to all bots
│   └── cleanup.sh            # Remove containers, volumes, data
└── data/                     # Bot workspaces (created at runtime, gitignored)
```

## Bots

| Bot | Model | Tools | Purpose |
|-----|-------|-------|---------|
| echo-bot | claude-haiku-4-5 | none | Simplest bot - proves message routing works |
| calculator-bot | claude-sonnet-4-5 | bash | Arithmetic using `bc` in Docker sandbox |
| file-assistant | claude-sonnet-4-5 | bash, readFile, writeFile, glob | File operations in persistent workspace |

### Bot Config Structure

Each bot `config.json` requires:

```json
{
  "id": "bot-id",
  "name": "Display Name",
  "description": "What this bot does",
  "soul": "./soul.md",
  "provider": "anthropic",
  "model": "claude-sonnet-4-5",
  "tools": ["bash"]
}
```

Optional fields: `sandbox` (packages, image, memory), `workspace` (root directory).

### Soul.md Structure

The `soul.md` file defines the bot personality (system prompt):

- Top-level heading with bot name
- Core behavior description
- Capabilities and tool usage instructions
- Example interactions (optional)

## Available Tools

| Tool | Purpose |
|------|---------|
| `bash` | Execute shell commands in Docker container |
| `readFile` | Read file contents from workspace |
| `writeFile` | Write/create files in workspace |
| `glob` | List files matching a pattern |

## Setup and Testing

```bash
# One-command setup
./scripts/setup.sh

# Set API key
cp .env.example .env
# Edit .env to add ANTHROPIC_API_KEY

# Start the server
npm start

# Test all bots
./scripts/test.sh

# Test a single bot via CLI
echo '{"message": "Hello!"}' | npx ai-army message echo-bot

# Test via REST API
curl -s -X POST http://localhost:3000/api/bots/echo-bot/message \
  -H 'Content-Type: application/json' \
  -d '{"message": "Hello!"}'

# Validate configuration (offline, no server needed)
npx ai-army validate

# Clean up containers and data
./scripts/cleanup.sh
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/bots` | List all registered bots |
| `POST` | `/api/bots/:botId/message` | Send a message to a bot |

POST request body:

```json
{
  "message": "Your message here",
  "sessionId": "optional-session-id-for-conversation-history"
}
```

## Adding a New Bot

1. Create a directory: `bots/my-bot/`
2. Add `config.json` with id, soul, provider, model, and tools
3. Add `soul.md` with personality and instructions
4. Validate: `npx ai-army validate`
5. Reload without restart: `npx ai-army reload`

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for AI models |
| `DATABASE_URL` | No | PostgreSQL connection string (default from setup.sh) |
| `DEMO_PG_PORT` | No | PostgreSQL port (default: 5432) |
| `DEMO_API_PORT` | No | API server port (default: 3000) |

## Conventions

- One bot = one directory in `bots/`
- Each bot has exactly two files: `config.json` + `soul.md`
- All secrets use `${ENV_VAR}` interpolation in config files (never hardcode)
- Sessions stored in PostgreSQL 18
- ES Modules (`import`/`export`, `"type": "module"`)
- Parameterized SQL queries (`$1`, `$2` -- never string interpolation)
- Validate after every config change: `npx ai-army validate`

## Technology Stack

| Component | Technology |
|-----------|-----------|
| Framework | ai-army (local `file:..` dependency) |
| Database | PostgreSQL 18 (postgres:18-alpine) |
| Runtime | Node.js 22+ with ES Modules |
| Containers | Docker (node:22-slim sandboxes) |
| AI Provider | Anthropic (claude-sonnet-4-5 / claude-haiku-4-5) |

## Relationship to Framework

This demo is a **user project** that depends on the ai-army framework as an npm package.
The framework (parent directory `../`) handles orchestration, session management, Docker
execution, and message routing. This demo only defines configuration: what bots exist,
their personalities, and their tools.

For framework development, see `../AGENT.md`.
