# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**AI Assistants Army** is a framework for building multi-bot AI systems (like Ruby on Rails for AI bots). Users install it as an npm package and create their own repositories with bot definitions.

**Current Status:** Planning/Design Phase - This repository contains comprehensive architecture documentation. Implementation will follow this specification.

**Core Philosophy:**
- Framework, not application - Users create their own repos
- Configuration-first - JSON + Markdown + Dockerfiles
- No UI - Pure config files, version-controlled
- PostgreSQL for everything - Orchestration, messaging, logging, state
- SRP, SOLID, simple, small JS files

## Architecture Principles

### Code Quality Standards
- **SRP (Single Responsibility Principle)** - Each module does one thing well
- **SOLID principles** - Clean, maintainable, testable code
- **Simple, small JS files** - Prefer small, focused modules over large files
- **Each file is TESTED** - Unit tests for all modules

### Framework Design
1. **Start Simple, Scale Later** - 1 VPS → many VPS workers when needed
2. **Master/Worker Architecture** - Master orchestrates, workers execute
3. **Each Bot is a Person** - Own directory, workspace, personality (soul.md)
4. **Adapter Pattern** - Easy to extend channels, secrets, models, storage
5. **Convention Over Configuration** - Sensible defaults, but configurable

## High-Level Architecture

### Master Server Components
```
Master Server
├── Config Loader - Load/validate JSON configs, env var interpolation
├── Secrets Manager - Fetch from Bitwarden/1Password/env vars
├── Channel Manager - Slack/Discord/REST API connections
├── Session Manager - Per-user conversation history
├── Worker Pool - Manage local/remote worker connections
├── Bot Orchestrator - Route messages to correct bot/worker
└── MCP Manager - Spawn and manage MCP server processes
```

### Worker Server Components
```
Worker Server
├── Container Pool - Manage Docker containers per bot
├── Docker Manager - Create/start/stop/health-check containers
├── Tool Executor - Execute bash/file ops in containers
└── SSH Tunnel (remote) - Connect to master via SSH
```

### Data Flow
1. User message arrives via Channel (Slack/Discord/REST)
2. Session Manager finds/creates user session
3. Bot Orchestrator routes to correct bot config
4. Worker Pool selects available worker
5. AI SDK Agent calls LLM with tools
6. Tool calls execute in Docker container (real bash, not simulated)
7. Response streams back to user

### PostgreSQL as Central Nervous System
All state flows through PostgreSQL:
- **Orchestration:** Bot registry, worker registry, assignments
- **Messaging:** Message queue, session storage
- **Logging:** Tool calls, errors, audit trail
- **Metrics:** Usage stats, performance data
- **Real-time:** LISTEN/NOTIFY for live updates

## Directory Structure (User's Project)

When users create projects using this framework:

```
my-ai-army/                    # User's repository
├── package.json               # Depends on ai-assistants-army
├── config.json                # Main config (providers, MCP, defaults)
├── workers.json               # Optional: remote worker definitions
├── docker-compose.yml         # Deployment config
├── .env                       # Secrets (not committed)
│
├── bots/                      # Bot definitions
│   ├── support-agent/
│   │   ├── config.json        # Bot-specific config
│   │   ├── soul.md            # Personality/instructions
│   │   └── Dockerfile         # Optional custom container
│   ├── code-reviewer/
│   └── devops-bot/
│
├── skills/                    # Vercel AI SDK skills (SKILL.md format)
│   ├── code-review/
│   │   ├── SKILL.md          # Skill definition
│   │   ├── scripts/          # Executable helpers
│   │   └── references/       # Supporting docs
│   └── deploy/
│
├── data/                      # Persistent bot workspaces (runtime)
│   ├── support-agent/
│   │   ├── memory/           # Long-term memory files
│   │   ├── sessions/         # Conversation histories
│   │   ├── scratch/          # Working directory
│   │   └── projects/         # Cloned repos, projects
│   └── ...
│
└── src/                       # Framework code (when developing framework)
```

## Framework Package Structure

The framework itself (when implementing):

```
ai-assistants-army/            # Framework npm package
├── src/
│   ├── core/
│   │   ├── orchestrator.js    # Main orchestration engine
│   │   ├── bot-manager.js     # Bot lifecycle management
│   │   └── session-manager.js # Session/conversation tracking
│   │
│   ├── adapters/
│   │   ├── channels/          # Slack, Discord, REST
│   │   ├── secrets/           # Bitwarden, 1Password, env
│   │   ├── models/            # Anthropic, OpenAI, OpenRouter
│   │   └── storage/           # PostgreSQL, SQLite, file
│   │
│   ├── execution/
│   │   ├── docker-manager.js  # Docker container management
│   │   └── container-pool.js  # Container pooling/health
│   │
│   ├── worker/
│   │   ├── ssh-tunnel.js      # SSH tunnel to remote workers
│   │   └── worker-pool.js     # Worker selection/assignment
│   │
│   ├── queue/
│   │   ├── message-queue.js   # Per-session message queuing
│   │   └── task-queue.js      # Background task processing
│   │
│   ├── mcp/
│   │   ├── manager.js         # MCP server lifecycle
│   │   └── client.js          # MCP protocol client
│   │
│   └── webhooks/
│       └── manager.js         # Per-bot webhook notifications
│
├── migrations/                # PostgreSQL schema migrations
│   ├── 001_initial.sql
│   ├── 002_templates.sql
│   └── 003_queue.sql
│
└── templates/                 # Project templates
    ├── basic/
    ├── slack-bot/
    └── saas/
```

## Key Concepts

### 1. Bot Configuration Inheritance

Bots inherit from defaults with deep merge:
```javascript
effectiveConfig = deepMerge(
  config.defaults,           // Global defaults
  botConfig,                 // Bot-specific overrides
  environmentOverrides       // Runtime env vars
)
```

### 2. Session Keys

Sessions use format: `botId:channelType:channelId:userId`
- Example: `work:slack:C123ABC:U456DEF`
- Enables per-user conversations with each bot
- Stored in PostgreSQL with message history

### 3. Docker Container Lifecycle

- Containers persist across messages (not ephemeral)
- Mounted workspace at `/home/agent` (persistent)
- Resource limits: CPU, memory, network (per bot)
- Health checks every 30s, auto-recreate if unhealthy
- Packages installed on first boot (cached)

### 4. Message Queue (Per-Session)

- Each session has own queue to prevent race conditions
- Messages processed sequentially per session
- Concurrent sessions process in parallel
- Priority queue for urgent messages
- Database-backed, survives restarts

### 5. Templates & Instances

Define bot template once, deploy multiple instances:
- Same config, different instance IDs
- Per-team instances (same bot, different teams)
- Load balancing (multiple instances, round-robin)
- SaaS model (per-customer instances)

### 6. MCP Integration

Model Context Protocol for external integrations:
- MCP servers spawn once, shared across bots
- Each bot declares which MCP servers to use
- Tools exposed automatically to AI SDK
- Examples: GitHub, Notion, Linear, Postgres, Filesystem

### 7. Skills System (Vercel AI SDK Format)

Reusable, portable capabilities following AgentSkills spec:
- `SKILL.md` - YAML frontmatter + Markdown instructions
- `scripts/` - Executable helpers for deterministic workflows
- `references/` - Supporting docs (progressive disclosure)
- `assets/` - Templates, examples, artifacts
- Agents load skill index on startup, retrieve full content when task matches
- Skills can be shared via npm or GitHub

**See:** [Vercel Agent Skills FAQ](https://vercel.com/blog/agent-skills-explained-an-faq)

## Technology Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| Model Abstraction | Vercel AI SDK 6 | Multi-provider support, streaming |
| Agents | Vercel AI SDK Agents | Reusable agent definitions |
| Tool Execution | Custom Docker wrapper | Real bash, not simulated |
| Database | PostgreSQL 16 | Orchestration, messaging, logging |
| Channels | @slack/bolt, discord.js | Chat integrations |
| Docker | dockerode | Container management |
| MCP | @modelcontextprotocol/sdk | External integrations |
| Secrets | bitwarden-cli, 1password-cli | Secret management |
| SSH | ssh2 | Remote worker tunneling |

## Common Development Patterns

### Creating a New Adapter

All adapters follow the same interface pattern:

```javascript
// src/adapters/channels/telegram.js
export class TelegramAdapter {
  async initialize(config) {
    // Setup Telegram bot
  }

  async sendMessage(channelId, text) {
    // Send to Telegram
  }

  async onMessage(handler) {
    // Register message handler
  }
}
```

Register in orchestrator:
```javascript
orchestrator.registerChannelAdapter('telegram', TelegramAdapter);
```

### Database Queries

Always use parameterized queries to prevent SQL injection:
```javascript
// GOOD
await db.query('SELECT * FROM bots WHERE id = $1', [botId]);

// BAD
await db.query(`SELECT * FROM bots WHERE id = '${botId}'`);
```

### Error Handling

Errors should bubble up with context:
```javascript
try {
  await executeToolInContainer(container, tool);
} catch (err) {
  throw new ToolExecutionError(
    `Failed to execute ${tool.name} in bot ${botId}`,
    { cause: err, botId, toolName: tool.name }
  );
}
```

### Container Management

Always check container health before use:
```javascript
const container = await containerPool.getContainer(botId);
const health = await container.inspect();
if (!health.State.Running) {
  await containerPool.recycleContainer(botId);
  container = await containerPool.getContainer(botId);
}
```

## Configuration Files

### config.json Structure

```json
{
  "defaults": {
    "model": { "provider": "anthropic", "model": "claude-sonnet-4-5" },
    "sandbox": { "type": "docker", "image": "node:22-slim" }
  },
  "providers": {
    "anthropic": { "type": "anthropic", "apiKey": "${ANTHROPIC_API_KEY}" }
  },
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }
    }
  },
  "channels": {
    "slack-main": {
      "type": "slack",
      "botToken": "${SLACK_BOT_TOKEN}",
      "appToken": "${SLACK_APP_TOKEN}"
    }
  }
}
```

### Bot config.json Structure

```json
{
  "id": "support",
  "soul": "./soul.md",
  "provider": "anthropic",
  "model": "claude-sonnet-4-5",
  "channel": "slack-main",
  "workspace": { "root": "./data/support" },
  "sandbox": { "type": "docker", "packages": ["git", "python3"] },
  "tools": ["bash", "readFile", "writeFile", "grep"],
  "mcpServers": ["github", "notion"],
  "skills": ["./skills/code-review"]
}
```

### Environment Variable Interpolation

Syntax in config files:
- `${VAR}` - Required, error if not set
- `${VAR:-default}` - Use default if not set
- `${VAR:+value}` - Use value only if VAR is set

## Design Philosophy

### Do One Thing Well

Framework handles:
- ✅ Orchestration (routing messages to bots)
- ✅ Session management (conversation history)
- ✅ Execution (Docker containers)
- ✅ Queuing (concurrent messages)
- ✅ Adapters (channels, secrets, models)

Framework does NOT handle:
- ❌ UI/dashboards (users build their own)
- ❌ Analytics platform (use PostgreSQL + their tools)
- ❌ Billing/payments (SaaS users implement)
- ❌ User management (users implement)

### No UI Philosophy

Everything is configuration files, REST API, and PostgreSQL:
- No web dashboard, no admin panel
- Configuration via JSON/Markdown
- Monitoring via REST API + external tools (Grafana, Datadog)
- Logs via stdout + PostgreSQL
- Version control for all config (git)

Users who want UIs build their own or use:
- Grafana (query PostgreSQL)
- Metabase (SQL dashboards)
- Retool (internal tools)
- Custom React app

### Bring Your Own Tools

Framework is deployment-agnostic:
- Docker Compose ✅
- Kubernetes ✅
- systemd ✅
- Capistrano ✅

Framework just needs:
- PostgreSQL connection
- Docker access
- Config files

## Scaling Path

### Day 1: Single VPS
```
VPS (Master + Worker)
├── PostgreSQL
├── Master (orchestrator)
└── Worker (Docker containers)
```

### Later: Multiple Workers
```
VPS 1 (Master)          VPS 2 (Worker)      VPS 3 (Worker)
├── PostgreSQL    ←──── SSH tunnel   ←──── SSH tunnel
└── Master              └── Containers      └── Containers
```

### Production: Multi-Master
```
Load Balancer
├── Master 1 (Slack)  ──┐
├── Master 2 (Discord)──┼─→ Shared PostgreSQL ←─── Workers
└── Master N (REST)   ──┘
```

## Testing Strategy

### Unit Tests
- Test each adapter independently
- Mock external services (Slack, Discord, Docker)
- Test configuration validation
- Test message queue logic

### Integration Tests
- Test Master ↔ Worker communication
- Test PostgreSQL queries
- Test Docker container lifecycle
- Test MCP server spawning

### End-to-End Tests
- Test full message flow: Slack → Master → Worker → Docker → Response
- Test session management across restarts
- Test hot-reload of configuration
- Test worker failover

## Important Implementation Notes

### Security
- Never log API keys or secrets
- Validate all user input (SQL injection, command injection)
- Sandbox Docker containers (no privileged mode)
- Network isolation per bot (allowlist domains)
- User/channel restrictions (whitelist/blacklist)

### Performance
- Connection pooling for PostgreSQL
- Container reuse (don't recreate per message)
- Session compaction (summarize old messages)
- MCP server reuse (don't spawn per message)
- Message queue batching where possible

### Reliability
- Health checks for workers and containers
- Auto-reconnect for channels (Slack, Discord)
- Retry logic for transient failures
- Graceful degradation (fallback models)
- Container auto-recreation on failure

## Documentation Structure

All design docs are in `docs/idea/`:
- `00-overview.md` - High-level project vision
- `01-architecture.md` - Master/worker distributed system
- `02-configuration.md` - JSON config structure
- `03-bots.md` - Bot definitions (soul.md, Dockerfile)
- `04-execution.md` - Docker execution environment
- `05-mcp-and-tools.md` - MCP integration details
- `06-secrets.md` - Secret management (Bitwarden, 1Password)
- `07-skills.md` - Skills system (Vercel AI SDK format)
- `08-ai-sdks.md` - Why Vercel AI SDK, not Claude Agent SDK
- `09-channels.md` - Slack, Discord, REST API
- `10-rest-api.md` - HTTP API for automation
- `11-getting-started.md` - Quick start guide
- `12-templates-and-instances.md` - Bot templates
- `13-database-and-orchestration.md` - PostgreSQL schema
- `14-adapters.md` - Extensibility via adapters
- `15-docker-compose.md` - Easy deployment
- `16-webhooks-and-queuing.md` - Webhooks, message queues
- `17-deployment-strategy.md` - 1 VPS → many VPS
- `18-framework-architecture.md` - Framework vs application
- `19-version-control.md` - Git for all configs
- `20-no-ui-philosophy.md` - Why no UI, what instead

## Additional Resources

### Vercel AI SDK & Skills
- [AI SDK 6 Release](https://vercel.com/blog/ai-sdk-6) - Agent abstraction and reusability
- [Agent Skills Explained FAQ](https://vercel.com/blog/agent-skills-explained-an-faq) - SKILL.md format, installation, usage
- [Skills.sh Ecosystem](https://www.infoq.com/news/2026/02/vercel-agent-skills/) - Open ecosystem for agent commands
- [Agent Skills Launch](https://www.marktechpost.com/2026/01/18/vercel-releases-agent-skills-a-package-manager-for-ai-coding-agents-with-10-years-of-react-and-next-js-optimisation-rules/) - Package manager for AI coding agents

### Implementation Guidelines
When implementing, prioritize:
1. **Configuration validation** - Fail fast with clear errors
2. **Test coverage** - Every module has unit tests
3. **Small files** - Keep modules focused and simple
4. **Documentation** - JSDoc for all public APIs
5. **Error messages** - Clear, actionable error messages
