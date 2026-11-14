# AI Army

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen?style=flat-square)](https://nodejs.org)
[![CI Status](https://img.shields.io/github/actions/workflow/status/developerz-ai/ai-army/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/developerz-ai/ai-army/actions)
[![License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)

**A framework for building multi-bot AI systems with master/worker architecture and Incus sandboxing.**

Deploy specialized AI bots across distributed workers, each running in isolated containers with persistent memory and custom tools.

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🤖 **Multi-Bot Architecture** | Run multiple specialized AI bots with unique personalities and tools |
| 🔒 **Incus Sandboxing** | Each bot runs in an Incus container with resource limits |
| 📡 **Multi-Channel Support** | Deploy bots to Slack, Discord, REST API, and custom channels |
| 🔌 **MCP Tool Integration** | Built-in support for Model Context Protocol tools |
| 💾 **Persistent Memory** | Conversation history with automatic summarization |
| 🌐 **Distributed Workers** | Scale across local and remote worker nodes via SSH |
| 🔄 **Hot Reload** | Update bot configs without downtime |
| 🔐 **Secret Management** | Secure secret interpolation from multiple providers |
| 📊 **PostgreSQL Backend** | Robust storage for sessions, queue, and audit logs |

---

## 🏗️ Architecture

```mermaid
graph TB
    subgraph Master["Master Server"]
        Orch[Orchestrator]
        BotMgr[Bot Manager]
        SessMgr[Session Manager]
        ChanMgr[Channel Manager]
        WorkerPool[Worker Pool]
    end

    subgraph Channels["Communication Channels"]
        Slack[Slack]
        Discord[Discord]
        REST[REST API]
    end

    DB[(PostgreSQL)]

    subgraph Workers["Worker Nodes"]
        W1[Local Worker<br/>5 containers]
        W2[Remote Worker 1<br/>10 containers]
        W3[Remote Worker 2<br/>10 containers]
    end

    subgraph Containers["Bot Containers"]
        C1[Bot 1<br/>support-bot]
        C2[Bot 2<br/>work-bot]
        C3[Bot N<br/>custom-bot]
    end

    Slack --> ChanMgr
    Discord --> ChanMgr
    REST --> ChanMgr

    ChanMgr --> Orch
    Orch --> BotMgr
    Orch --> SessMgr
    BotMgr --> WorkerPool
    SessMgr --> DB
    BotMgr --> DB

    WorkerPool --> W1
    WorkerPool --> W2
    WorkerPool --> W3

    W1 --> C1
    W2 --> C2
    W3 --> C3

    C1 -.messages.-> DB
    C2 -.messages.-> DB
    C3 -.messages.-> DB

    style Master fill:#e1f5ff
    style Channels fill:#fff4e1
    style Workers fill:#e8f5e9
    style Containers fill:#fce4ec
```

**Key Components:**
- **Master**: Orchestrates message routing, session management, and worker coordination
- **Workers**: Execute bot containers with resource isolation and health monitoring
- **PostgreSQL**: Central data store for sessions, queue, bot registry, and audit logs
- **Channels**: Adapters for Slack, Discord, REST API, and custom integrations

---

## 📋 Requirements

- **Node.js** >= 22 ([nodejs.org](https://nodejs.org/))
- **PostgreSQL** 18 — the bundled `docker-compose.yml` runs `postgres:18-alpine`
- **Docker Compose** — for the PostgreSQL service only (bots are not Docker-sandboxed)
- **Incus** — bot sandboxing ([Incus bots](docs/getting-started/incus-bots.md))
- **Provider API keys** for the providers you use — `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` — plus `SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN` / `SLACK_SIGNING_SECRET` and `DISCORD_BOT_TOKEN` when those channels are configured

## 🚀 Quick Start

AI Army is installed **from source** — there is no npm package.

```bash
# Get the source
git clone https://github.com/developerz-ai/ai-army.git
cd ai-army

# Install dependencies
npm install

# Create your config
cp config.example.json config.json

# Start PostgreSQL 18
docker compose up -d --wait postgres

# Hand the CLI its database connection — migrate reads DATABASE_URL from the
# environment (a repo-root .env would also work, but this flow creates none)
export DATABASE_URL=postgresql://ai_army:ai_army_dev@localhost:5432/ai_army

# Create the database schema
node bin/cli.js migrate

# Validate configuration
node bin/cli.js validate

# Start the stack in development mode
node bin/cli.js dev
```

**First bot in 30 seconds:**

```bash
# Create the bot directory
mkdir -p bots/my-bot
```

**`bots/my-bot/config.json`:**

```json
{
  "id": "my-bot",
  "soul": "./soul.md",
  "provider": "openrouter",
  "model": "openrouter/anthropic/claude-sonnet-4.5",
  "tools": ["bash", "readFile", "writeFile"],
  "sandbox": {
    "type": "incus"
  }
}
```

**`bots/my-bot/soul.md`:**

```markdown
You are a helpful AI assistant that helps developers with code.
```

```bash
# Validate, then reload the running stack
node bin/cli.js validate

# Reload (validate-only outside "npm run dev"; per-bot reload: POST /api/admin/bots/<bot-id>/reload)
node bin/cli.js reload
```

Bots are discovered by their directory (`bots/<id>/config.json`) — no root-config registration needed.

---

## 📖 Documentation

- **[Architecture Guide](docs/architecture.md)** - Master/worker design, data flow, scaling patterns
- **[Configuration Guide](docs/configuration.md)** - Bot configs, channels, workers, secrets
- **[Incus Bots](docs/getting-started/incus-bots.md)** - Bot sandboxing: images, profiles, resource limits
- **[Deployment Guide](docs/deployment.md)** - Docker Compose stack, VPS, and cloud deployment
- **[Development Guide](docs/development.md)** - Contributing, testing, debugging

**Full documentation site:** [https://developerz-ai.github.io/ai-army](https://developerz-ai.github.io/ai-army)

---

## 📦 Example Bots

- **`support-bot`** - Customer support bot with ticketing integration
- **`work-bot`** - Productivity assistant with calendar and task management
- **`code-bot`** - Code review and debugging assistant

Bot definitions live in [`bots/`](bots/) — one directory per bot with `config.json` and `soul.md`; [`templates/`](templates/) holds reusable instance and worker templates.

---

## 🔧 Configuration

Configuration lives in `config.json` at the repo root (defaults, providers, database, channels, MCP servers); each bot is configured by its own `bots/<id>/config.json`. Copy the ready-to-use example: `cp config.example.json config.json`. Secrets are `${ENV_VAR}` references — written as `${VAR:-default}` when a fallback makes sense — never inlined values.

Minimal `config.json`:

```json
{
  "defaults": {
    "model": {
      "provider": "openrouter",
      "model": "openrouter/anthropic/claude-sonnet-4.5"
    },
    "sandbox": {
      "type": "incus"
    }
  },
  "providers": {
    "openrouter": {
      "type": "openrouter",
      "apiKey": "${OPENROUTER_API_KEY:-}"
    }
  },
  "database": {
    "url": "${DATABASE_URL:-postgresql://ai_army:ai_army_dev@localhost:5432/ai_army}"
  },
  "channels": {},
  "mcpServers": {}
}
```

See [Configuration Guide](docs/configuration.md) for all options.

---

## 🤝 Contributing

We welcome contributions! Please see:
- [CONTRIBUTING.md](CONTRIBUTING.md) - Guidelines and workflow
- [Development Guide](docs/development.md) - Setup and testing
- [CHANGELOG.md](CHANGELOG.md) - Version history

---

## 📄 License

MIT © [Developerz AI](https://github.com/developerz-ai)

See [LICENSE](LICENSE) for details.

---

## 🔗 Links

- **Documentation**: [https://developerz-ai.github.io/ai-army](https://developerz-ai.github.io/ai-army)
- **GitHub**: [https://github.com/developerz-ai/ai-army](https://github.com/developerz-ai/ai-army)
- **Issues**: [https://github.com/developerz-ai/ai-army/issues](https://github.com/developerz-ai/ai-army/issues)

---

**Built with ❤️ by the Developerz AI team**
