# 🤖 AI Assistants Army

[![CI](https://github.com/developerz-ai/ai-army/actions/workflows/ci.yml/badge.svg)](https://github.com/developerz-ai/ai-army/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> A framework for building multi-bot AI systems. Like **Ruby on Rails** for AI bots.

## 🌟 What is This?

**AI Assistants Army** is a framework that lets you deploy and manage multiple AI assistants. Each assistant is like a person with their own:

- **🧠 Personality** (`soul.md` file)
- **🏠 Workspace** (persistent home directory)
- **🛠️ Tools** (bash, file ops, web search, MCP servers)
- **💬 Channel** (Slack, Discord, REST API)

**No UI.** Just config files. **PostgreSQL for everything** (orchestration, messaging, logging).

## ✨ Key Features

- ✅ **Multi-provider** - Anthropic, OpenAI, OpenRouter, Ollama, any model
- ✅ **Multi-channel** - Slack, Discord, REST API, extensible
- ✅ **Persistent workspaces** - Each bot has own file system
- ✅ **Real execution** - Docker containers with real bash, git, python
- ✅ **MCP integration** - GitHub, Notion, Linear, custom servers
- ✅ **Skills** - Portable, reusable capabilities
- ✅ **Templates** - Define once, deploy X times
- ✅ **Webhooks** - Per-bot notifications to external systems
- ✅ **Message queuing** - Handle concurrent messages gracefully
- ✅ **Easy deployment** - `docker-compose up -d`
- ✅ **Horizontal scaling** - Add VPS workers on demand

## 🚀 Quick Start

```bash
# Create new project
mkdir my-ai-army && cd my-ai-army
npm init -y

# Install framework
npm install ai-assistants-army

# Initialize project
npx ai-army init

# Configure secrets
cp .env.example .env
vim .env  # Add your API keys

# Deploy
docker-compose up -d

# Check status
npx ai-army status
```

## 📖 Documentation

### MVP Implementation
- 🎯 **[MVP Overview](docs/mvp/OVERVIEW.md)** - Complete implementation plan
- 📋 **[MVP Phases](docs/mvp/)** - 10 phases from foundation to production

### Core Concepts
- 📋 **[Overview](docs/idea/00-overview.md)** - Project vision and quick start
- 🏗️ **[Architecture](docs/idea/01-architecture.md)** - Master/worker distributed system
- ⚙️ **[Configuration](docs/idea/02-configuration.md)** - JSON config structure, env vars
- 🤖 **[Bots](docs/idea/03-bots.md)** - Each bot's directory, soul.md, Dockerfile
- 🐳 **[Execution](docs/idea/04-execution.md)** - Docker containers, persistent workspaces

### Integration & Tools
- 🔌 **[MCP & Tools](docs/idea/05-mcp-and-tools.md)** - GitHub, Notion, custom integrations
- 🔐 **[Secrets](docs/idea/06-secrets.md)** - Bitwarden, 1Password, env vars
- ⚡ **[Skills](docs/idea/07-skills.md)** - Reusable capabilities, Vercel skills
- 🧠 **[AI SDKs](docs/idea/08-ai-sdks.md)** - Vercel AI SDK vs Claude Agent SDK
- 💬 **[Channels](docs/idea/09-channels.md)** - Slack, Discord, user restrictions
- 🌐 **[REST API](docs/idea/10-rest-api.md)** - HTTP interface for automation

### Deployment & Scaling
- 🎯 **[Getting Started](docs/idea/11-getting-started.md)** - Quick start, scaling path
- 📦 **[Templates & Instances](docs/idea/12-templates-and-instances.md)** - Deploy same bot X times
- 🐘 **[Database & Orchestration](docs/idea/13-database-and-orchestration.md)** - PostgreSQL for everything
- 🔧 **[Adapters](docs/idea/14-adapters.md)** - Extensible architecture
- 🐋 **[Docker Compose](docs/idea/15-docker-compose.md)** - Easy deployment
- 🔔 **[Webhooks & Queuing](docs/idea/16-webhooks-and-queuing.md)** - Webhooks, concurrent messages
- 🚀 **[Deployment Strategy](docs/idea/17-deployment-strategy.md)** - 1 VPS → many VPS

### Philosophy & Design
- 🏛️ **[Framework Architecture](docs/idea/18-framework-architecture.md)** - Like Rails, users create repos
- 📝 **[Version Control](docs/idea/19-version-control.md)** - Everything in git
- 🚫 **[No UI Philosophy](docs/idea/20-no-ui-philosophy.md)** - Config files, not interfaces

## 🏗️ Architecture

**Masters**: Pure orchestration (routing, sessions, queuing) - no AI processing
**Workers**: AI execution in Docker containers - where bots actually run

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
   │Routing │   │Routing │   │Routing │
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
   │🤖 AI   │   │🤖 AI   │   │🤖 AI   │   │🤖 AI   │
   │Bots    │   │Bots    │   │Bots    │   │Bots    │
   └────────┘   └────────┘   └────────┘   └────────┘
```

## 📦 Technology Stack

| Layer | Technology |
|-------|------------|
| Model Abstraction | Vercel AI SDK 6 |
| Execution | Docker containers |
| Database | PostgreSQL 16 |
| Channels | Slack Bolt, Discord.js |
| MCP | @modelcontextprotocol/sdk |
| Secrets | Bitwarden, 1Password |
| Deployment | Docker Compose |

## 🎯 Project Status

📋 **MVP Phase** - Comprehensive documentation complete, ready for implementation.

**Next**: Follow [MVP Implementation Plan](docs/mvp/OVERVIEW.md) - 10 phases, fully specified.

This is the framework specification. Implementation follows this design.

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) (coming soon).

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Vercel AI SDK](https://ai-sdk.dev/) - Model abstraction and agent framework
- [Model Context Protocol](https://modelcontextprotocol.io/) - Integration standard
- All the amazing open source projects we build upon

## 📞 Support

- 📖 [Documentation](docs/idea/)
- 🐛 [Issue Tracker](https://github.com/developerz-ai/ai-army/issues)
- 💬 [Discussions](https://github.com/developerz-ai/ai-army/discussions)

---

Built with ❤️ by [Developerz AI](https://github.com/developerz-ai)
