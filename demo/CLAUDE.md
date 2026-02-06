# AI Army Demo - Claude Code Instructions

This is a working demo of the [ai-army](https://github.com/developerz-ai/ai-army) framework.
Use Claude Code to explore, modify, and extend it.

## What This Demo Is

A complete multi-bot AI system with 3 example bots, PostgreSQL 18 for state, and Docker
containers for tool execution. It demonstrates the core capabilities of the ai-army framework:
message routing, tool execution, file operations, and persistent workspaces.

## Project Structure

```
demo/
├── config.json               # Main config (providers, defaults, sandbox settings)
├── .env / .env.example       # Environment variables (API keys, database URL)
├── package.json              # Demo package (depends on ai-army via file:..)
├── docker-compose.yml        # PostgreSQL 18 + ai-army containerized deployment
├── bots/                     # Bot definitions (config + personality)
│   ├── echo-bot/             # Simplest bot - no tools, just message routing
│   │   ├── config.json       # Model: claude-haiku-4-5, tools: none
│   │   └── soul.md           # Repeats input with "Echo:" prefix
│   ├── calculator-bot/       # Bash tool usage for arithmetic
│   │   ├── config.json       # Model: claude-sonnet-4-5, tools: [bash], packages: [bc]
│   │   └── soul.md           # Uses bc for calculations
│   └── file-assistant/       # File I/O operations in persistent workspace
│       ├── config.json       # Model: claude-sonnet-4-5, tools: [bash, readFile, writeFile, glob]
│       └── soul.md           # Manages files at /home/agent
├── scripts/
│   ├── setup.sh              # One-command setup (PostgreSQL, deps, migrations)
│   ├── test.sh               # Validate configs + send test messages to all bots
│   └── cleanup.sh            # Remove containers, volumes, node_modules
└── data/                     # Bot workspaces (created at runtime, gitignored)
```

## How Bots Work

Each bot is a directory under `bots/` with two files:

1. **`config.json`** - Bot settings (model, tools, sandbox, workspace)
2. **`soul.md`** - Personality and instructions (the bot's system prompt)

Bots inherit defaults from the top-level `config.json` and override what they need.
The config inheritance chain: `config.json defaults` -> `bot config.json` -> `env overrides`.

### Bot Configs at a Glance

| Bot | Model | Tools | Sandbox Packages | Workspace |
|-----|-------|-------|-------------------|-----------|
| echo-bot | claude-haiku-4-5 | none | none | none |
| calculator-bot | claude-sonnet-4-5 | bash | bc | none |
| file-assistant | claude-sonnet-4-5 | bash, readFile, writeFile, glob | none | `./data/file-assistant` |

## Key Files to Understand

- **`config.json`** - Defines the Anthropic provider, default model (claude-sonnet-4-5), Docker
  sandbox settings (node:22-slim, 512MB, 1 CPU), and message compaction thresholds
- **`bots/*/soul.md`** - Each bot's personality. Edit these to change behavior instantly
- **`bots/*/config.json`** - Each bot's model, tools, and sandbox. The `tools` array determines
  what capabilities the bot has (bash, readFile, writeFile, glob)
- **`docker-compose.yml`** - PostgreSQL 18 (postgres:18-alpine) + ai-army app service.
  Docker socket is mounted for nested container management

## Common Tasks

### Setup and Run

```bash
./scripts/setup.sh        # Start PostgreSQL 18, install deps, run migrations
nano .env                 # Set ANTHROPIC_API_KEY
npm start                 # Start the server
./scripts/test.sh         # Test all bots (in another terminal)
```

### Test a Single Bot

```bash
curl -s -X POST http://localhost:3000/api/bots/echo-bot/message \
  -H 'Content-Type: application/json' \
  -d '{"message": "Hello!"}'
```

### Validate Configuration

```bash
./scripts/test.sh --validate-only   # Offline validation (no server needed)
npm run validate                     # Framework config validation
```

### Clean Up

```bash
./scripts/cleanup.sh          # Remove containers, volumes, data (keeps .env)
./scripts/cleanup.sh --all    # Full reset including .env
```

## Example Prompts for Claude Code

### Exploring the Demo

- "How does config inheritance work between config.json and bot configs?"
- "Show me what tools the calculator-bot has access to"
- "Explain how the echo-bot soul.md affects its behavior"
- "What environment variables does this demo need?"

### Modifying Existing Bots

- "Change the calculator-bot to also support unit conversions"
- "Make the echo-bot respond in uppercase instead of with a prefix"
- "Add the glob tool to calculator-bot so it can list files"
- "Update file-assistant to organize files into subdirectories"

### Creating New Bots

- "Add a new bot called joke-bot that tells programming jokes"
- "Create a code-reviewer bot that reviews code snippets using bash tools"
- "Add a translator bot that translates text between languages"
- "Create a todo-bot that manages a task list using file operations"

### Working with Scripts

- "Add a new test case to test.sh for my custom bot"
- "Make setup.sh support a custom database name"
- "Explain what each phase of test.sh validates"

### Configuration Changes

- "Switch the default model to claude-haiku-4-5 for lower cost"
- "Add memory limits to the echo-bot sandbox"
- "Configure a custom Docker image for calculator-bot"
- "Add an OpenAI provider alongside Anthropic"

## Adding a New Bot

Create a new directory under `bots/` with `config.json` and `soul.md`:

### 1. Bot Config (`bots/my-bot/config.json`)

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

### 2. Bot Personality (`bots/my-bot/soul.md`)

```markdown
# My Bot

You are a helpful assistant that specializes in...

When asked to do X, use the bash tool to...
```

### 3. Test It

```bash
# Restart the server to pick up the new bot
npm start

# Send a test message
curl -s -X POST http://localhost:3000/api/bots/my-bot/message \
  -H 'Content-Type: application/json' \
  -d '{"message": "Hello, my-bot!"}'
```

## Available Tools for Bots

Bots can use these tools (configured in their `config.json` `tools` array):

| Tool | Purpose | Example |
|------|---------|---------|
| `bash` | Execute shell commands in Docker container | Run scripts, install packages, compute |
| `readFile` | Read file contents from workspace | Read configs, logs, data files |
| `writeFile` | Write/create files in workspace | Create reports, save data, write configs |
| `glob` | List files matching a pattern | Find all `.txt` files, list directory contents |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/bots` | List all registered bots |
| `POST` | `/api/bots/:botId/message` | Send a message to a bot |

Request body for POST:
```json
{
  "message": "Your message here",
  "sessionId": "optional-session-id-for-conversation-history"
}
```

## Technology Stack

| Component | Technology |
|-----------|-----------|
| Framework | ai-army (local `file:..` dependency) |
| Database | PostgreSQL 18 (postgres:18-alpine) |
| Runtime | Node.js 22+ with ES Modules |
| Containers | Docker (for bot sandboxes) |
| AI Provider | Anthropic (claude-sonnet-4-5 / claude-haiku-4-5) |

## Coding Conventions

This demo follows the ai-army framework conventions:

- **ES Modules** (`import`/`export`, `"type": "module"`)
- **Node.js built-in test runner** (`node:test`) for all tests
- **Single quotes**, semicolons, trailing commas
- **kebab-case** file names, **camelCase** variables, **PascalCase** classes
- **Parameterized SQL queries** (`$1`, `$2` -- never string interpolation)
- **Small, focused files** following SRP (Single Responsibility Principle)

## Relationship to Framework

This demo is a **user project** that depends on the ai-army framework as an npm package.
The framework handles orchestration, session management, Docker execution, and message routing.
The demo only defines configuration (what bots exist, their personalities, and their tools).

The parent directory (`../`) contains the ai-army framework source code. See `../CLAUDE.md`
for framework-level development instructions and architecture documentation.
