# AI Assistants Army - Project Overview

## Vision

A **framework for building multi-bot AI systems**. Users create their own repository where they define bots (JSON + Markdown + Dockerfiles) and deploy with familiar tools (Docker Compose, Kubernetes, etc.).

Think of each assistant as a **person** with their own personality (soul), workspace (home directory), tools, and communication channels.

**Start simple with 1 VPS, scale to many.** Deploy everything on one server, then add more VPS machines as workers when you need capacity. PostgreSQL handles all orchestration, messaging, and logging.

**No UI.** One config file = your entire system. Edit JSON, run the program, bots come alive.

## Core Principles

1. **Framework, Not Application**: npm package users install in their own projects
2. **Configuration-First**: Everything defined in JSON + Markdown + Dockerfiles
3. **Each Bot is a Person**: Own directory, own workspace, own personality
4. **PostgreSQL for Everything**: Orchestration, messaging, logging, state
5. **Adapter Pattern**: Easy to add channels (Discord, Telegram), secrets (1Password), models
6. **Start Simple, Scale Later**: 1 VPS → many VPS workers when needed
7. **No UI**: Just config files and deployment tools

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         MASTER SERVER                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────────┐  │
│  │   config/   │  │   Secrets   │  │      Orchestrator           │  │
│  │  config.json│  │  (Bitwarden)│  │  - Bot lifecycle            │  │
│  │  bots/*.json│  │             │  │  - Session management       │  │
│  │  souls/*.md │  │             │  │  - Channel routing          │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
              ▼               ▼               ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  WORKER (local) │ │ WORKER (remote) │ │ WORKER (remote) │
│  ┌───────────┐  │ │  ┌───────────┐  │ │  ┌───────────┐  │
│  │  Docker   │  │ │  │  Docker   │  │ │  │  Docker   │  │
│  │ Container │  │ │  │ Container │  │ │  │ Container │  │
│  │  (Bot A)  │  │ │  │  (Bot B)  │  │ │  │  (Bot C)  │  │
│  └───────────┘  │ │  └───────────┘  │ │  └───────────┘  │
│  /data/bot-a/   │ │  /data/bot-b/   │ │  /data/bot-c/   │
└─────────────────┘ └─────────────────┘ └─────────────────┘
      (local)          (SSH tunnel)        (SSH tunnel)
```

## Key Features

### Multi-Provider Model Support
- **Anthropic**: Claude Sonnet, Opus, Haiku
- **OpenRouter**: Access to 100+ models with single API
- **OpenAI**: GPT-4, GPT-5
- **Google**: Gemini models
- **Local**: Ollama, LMStudio, vLLM

### Channel Integrations
- Slack (via Bolt SDK)
- Discord (via Discord.js)
- Telegram (planned)
- WhatsApp (planned)
- CLI (for testing)

### Execution Environment
- Real bash execution via Docker containers
- Persistent workspaces that survive restarts
- Per-bot filesystem isolation
- Network access control per bot
- Resource limits (CPU, memory)

### MCP (Model Context Protocol)
- Define MCP servers globally, attach per-bot
- GitHub, Notion, Filesystem, and custom servers
- Shared MCP processes across bots

### Skills System
- Portable skill folders (SKILL.md + scripts)
- Follows AgentSkills spec
- Per-bot skill attachment

## Technology Stack (JavaScript/TypeScript)

| Component | Technology |
|-----------|------------|
| Model Abstraction | Vercel AI SDK 6 |
| Tool Execution | Custom Docker wrapper |
| Slack | @slack/bolt |
| Discord | discord.js |
| Docker Management | dockerode |
| MCP | @modelcontextprotocol/sdk |
| Secrets | bitwarden-cli |
| SSH Tunneling | ssh2 |

## Project Structure

```
ai-assistants-army/
├── config.json               # Main configuration (providers, MCP servers, defaults)
├── workers.json              # Worker server definitions (optional, for scaling)
│
├── bots/                     # Each bot has their own directory
│   ├── work-assistant/
│   │   ├── config.json       # Bot-specific config
│   │   ├── soul.md           # Personality and instructions
│   │   └── Dockerfile        # Custom container (optional)
│   │
│   ├── family-bot/
│   │   ├── config.json
│   │   ├── soul.md
│   │   └── Dockerfile
│   │
│   └── devops-bot/
│       ├── config.json
│       ├── soul.md
│       └── Dockerfile
│
├── data/                     # Persistent bot workspaces (each bot's "home")
│   ├── work-assistant/
│   │   ├── memory/           # Long-term memory files
│   │   ├── sessions/         # Per-user conversation histories
│   │   ├── scratch/          # Working directory
│   │   └── projects/         # Cloned repos, created projects
│   │
│   ├── family-bot/
│   │   └── ...
│   │
│   └── devops-bot/
│       └── ...
│
├── skills/                   # Shared skills (attachable to any bot)
│   ├── code-review/
│   │   └── SKILL.md
│   └── deploy/
│       └── SKILL.md
│
└── src/                      # Application code
    └── ...
```

## Quick Start

```bash
# 1. Create new project
mkdir my-ai-army && cd my-ai-army
npm init -y

# 2. Install framework
npm install ai-assistants-army

# 3. Initialize project
npx ai-army init

# 4. Configure secrets
cp .env.example .env
vim .env  # Add your API keys

# 5. Create your first bot
mkdir -p bots/my-assistant
cat > bots/my-assistant/config.json << EOF
{
  "soul": "./soul.md",
  "provider": "anthropic",
  "model": "claude-sonnet-4-5",
  "channel": {"type": "slack", "botToken": "\${SLACK_BOT_TOKEN}"}
}
EOF

echo "You are a helpful assistant." > bots/my-assistant/soul.md

# 6. Deploy
docker-compose up -d

# 7. Check status
npx ai-army status
```

## Documentation Index

1. [Architecture](./01-architecture.md) - Master/Worker distributed system
2. [Configuration](./02-configuration.md) - JSON config structure
3. [Bots](./03-bots.md) - Each bot's own directory, soul.md, Dockerfile
4. [Execution](./04-execution.md) - Docker containers, persistent workspaces
5. [MCP & Tools](./05-mcp-and-tools.md) - MCP servers and tool definitions
6. [Secrets](./06-secrets.md) - Bitwarden, 1Password, never in config files
7. [Skills](./07-skills.md) - Skills system (including Vercel AI SDK skills)
8. [AI SDKs](./08-ai-sdks.md) - Vercel AI SDK, Claude Agent SDK comparison
9. [Channels](./09-channels.md) - Slack, Discord, user/channel whitelisting
10. [REST API](./10-rest-api.md) - HTTP interface for automation
11. [Getting Started](./11-getting-started.md) - Start simple, scale when needed
12. [Templates & Instances](./12-templates-and-instances.md) - Deploy same bot type X times
13. [Database & Orchestration](./13-database-and-orchestration.md) - PostgreSQL for everything
14. [Adapters](./14-adapters.md) - Easy to add channels, secrets, models
15. [Docker Compose](./15-docker-compose.md) - Deploy with one command
16. [Webhooks & Queuing](./16-webhooks-and-queuing.md) - Per-bot webhooks, concurrent messages
17. [Deployment Strategy](./17-deployment-strategy.md) - 1 VPS → many VPS scaling
18. [Framework Architecture](./18-framework-architecture.md) - Like Rails, users create repos
19. [Version Control](./19-version-control.md) - Everything in git, like Rails apps
