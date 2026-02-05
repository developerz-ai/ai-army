# AI Assistants Army - Documentation

## What is This?

A **framework for building multi-bot AI systems**, like **Ruby on Rails for AI bots**.

You create your own repository, define your bots (JSON + Markdown + Dockerfiles), everything under version control, deploy with familiar tools.

Each assistant is like a person with their own:
- **Personality** (soul.md file)
- **Workspace** (persistent home directory)
- **Tools** (bash, file ops, web search, MCP servers)
- **Channel** (Slack, Discord, REST API)

**No UI.** Just config files. **PostgreSQL for everything** (orchestration, messaging, logging).

## Core Concepts

### Each Assistant is a Person

Think of each bot as an employee:
- Has their own **directory** with config.json, soul.md, Dockerfile
- Has their own **persistent workspace** in `data/{bot-name}/`
- Has their own **environment** (Docker container)
- Remembers past conversations
- Can have their own **webhook URLs** to notify external systems

### Start with 1 Server, Scale to Many

**Day 1:** Deploy to single VPS
**Later:** Add more VPS machines as workers
**Production:** Multiple masters + workers, all connected via PostgreSQL

Same config works everywhere.

### Adapter-Based Architecture

Easy to extend:
- **Channel adapters** - Add Telegram, WhatsApp, etc.
- **Secret adapters** - Add 1Password, AWS Secrets Manager, etc.
- **Model adapters** - Use any AI provider
- **Storage adapters** - Swap PostgreSQL for MySQL, MongoDB, etc.

Just implement the interface, register the adapter, done.

### Templates & Instances

Define a bot template once, deploy it **X times**:
- Same bot type, multiple instances for load balancing
- Per-team instances (same bot, different teams)
- Per-customer instances (SaaS model)

## Documentation Structure

| # | Document | What It Covers |
|---|----------|---------------|
| 00 | **[Overview](./00-overview.md)** | Project vision, quick start |
| 01 | **[Architecture](./01-architecture.md)** | Master/worker distributed system |
| 02 | **[Configuration](./02-configuration.md)** | JSON config structure, env vars |
| 03 | **[Bots](./03-bots.md)** | Each bot's directory, soul.md, Dockerfile |
| 04 | **[Execution](./04-execution.md)** | Docker containers, persistent workspaces |
| 05 | **[MCP & Tools](./05-mcp-and-tools.md)** | GitHub, Notion, custom integrations |
| 06 | **[Secrets](./06-secrets.md)** | Bitwarden, 1Password, env vars |
| 07 | **[Skills](./07-skills.md)** | Reusable capabilities, Vercel skills |
| 08 | **[AI SDKs](./08-ai-sdks.md)** | Vercel AI SDK vs Claude Agent SDK |
| 09 | **[Channels](./09-channels.md)** | Slack, Discord, user restrictions |
| 10 | **[REST API](./10-rest-api.md)** | HTTP interface for automation |
| 11 | **[Getting Started](./11-getting-started.md)** | Quick start, scaling path |
| 12 | **[Templates & Instances](./12-templates-and-instances.md)** | Deploy same bot X times |
| 13 | **[Database & Orchestration](./13-database-and-orchestration.md)** | PostgreSQL for everything |
| 14 | **[Adapters](./14-adapters.md)** | Extensible architecture |
| 15 | **[Docker Compose](./15-docker-compose.md)** | Easy deployment |
| 16 | **[Webhooks & Queuing](./16-webhooks-and-queuing.md)** | Webhooks, concurrent messages |
| 17 | **[Deployment Strategy](./17-deployment-strategy.md)** | 1 VPS → many VPS |
| 18 | **[Framework Architecture](./18-framework-architecture.md)** | Like Rails, users create repos |
| 19 | **[Version Control](./19-version-control.md)** | Everything in git |
| 20 | **[No UI Philosophy](./20-no-ui-philosophy.md)** | Config files, not interfaces |

## Quick Example

### Minimal Setup

```
bots/my-assistant/
├── config.json
└── soul.md
```

**config.json:**
```json
{
  "soul": "./soul.md",
  "provider": "anthropic",
  "model": "claude-sonnet-4-5",
  "channel": {
    "type": "slack",
    "botToken": "${SLACK_BOT_TOKEN}",
    "appToken": "${SLACK_APP_TOKEN}"
  }
}
```

**soul.md:**
```markdown
You are a helpful assistant.
```

**Deploy:**
```bash
docker-compose up -d
```

Done. Bot is live.

## Architecture Diagram

```
                    Users
                      ↓
            ┌─────────────────┐
            │  Load Balancer  │
            └─────────────────┘
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
   ┌────────┐   ┌────────┐   ┌────────┐
   │Master 1│   │Master 2│   │Master N│
   │(Slack) │   │(Discord)   │ (REST) │
   └────────┘   └────────┘   └────────┘
        │             │             │
        └─────────────┼─────────────┘
                      ▼
              ┌──────────────┐
              │  PostgreSQL  │
              │  (Shared)    │
              └──────────────┘
                      │
        ┌─────────────┼─────────────┬──────────┐
        ▼             ▼             ▼          ▼
   ┌────────┐   ┌────────┐   ┌────────┐   ┌────────┐
   │Worker 1│   │Worker 2│   │Worker 3│   │Worker N│
   │(local) │   │(remote)│   │(remote)│   │(remote)│
   └────────┘   └────────┘   └────────┘   └────────┘
      Bots          Bots        Bots         Bots
```

## Technology Stack

| Layer | Technology |
|-------|------------|
| Model Abstraction | Vercel AI SDK 6 |
| Execution | Docker containers |
| Database | PostgreSQL 16 |
| Channels | Slack Bolt, Discord.js |
| MCP | @modelcontextprotocol/sdk |
| Secrets | Bitwarden, 1Password |
| Deployment | Docker Compose |

## Key Features

- ✅ **Multi-provider**: Anthropic, OpenAI, OpenRouter, Ollama, any model
- ✅ **Multi-channel**: Slack, Discord, REST API, extensible
- ✅ **Persistent workspaces**: Each bot has own file system
- ✅ **Real execution**: Docker containers with real bash, git, python
- ✅ **MCP integration**: GitHub, Notion, Linear, custom servers
- ✅ **Skills**: Portable, reusable capabilities
- ✅ **Templates**: Define once, deploy X times
- ✅ **Webhooks**: Per-bot notifications to external systems
- ✅ **Message queuing**: Handle concurrent messages gracefully
- ✅ **User restrictions**: Whitelist/blacklist users and channels
- ✅ **Secrets management**: Bitwarden, 1Password, env vars
- ✅ **Easy deployment**: docker-compose up -d
- ✅ **Horizontal scaling**: Add VPS workers on demand

## Get Started

Read [Getting Started](./11-getting-started.md) to deploy your first bot.

## Questions?

Each document goes deep on its topic. Start with:
1. [Overview](./00-overview.md) - High-level concepts
2. [Getting Started](./11-getting-started.md) - Practical first steps
3. [Configuration](./02-configuration.md) - Understanding the JSON
4. [Bots](./03-bots.md) - Creating your first bot

## Project Status

📋 **Planning Phase** - Documentation complete, implementation next

This is the idea/design documentation. Implementation will follow this spec.
