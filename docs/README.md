# AI Assistants Army

> A framework for building multi-bot AI systems, like **Ruby on Rails for AI bots**.

Deploy specialized AI bots across distributed workers, each running in isolated Docker containers with persistent memory and custom tools.

## Quick Start

```bash
npm install
npx ai-army validate
docker-compose up -d
```

## Documentation

### Core Guides

- [Architecture](architecture.md) - Master/worker system design and component overview
- [Configuration](configuration.md) - JSON config structure, environment variables, and validation
- [Deployment](deployment.md) - From single VPS to multi-node production clusters
- [Development](development.md) - Local setup, testing, and contributing

### Idea & Design Docs

Comprehensive design documentation covering every aspect of the framework:

- [Project Overview](idea/00-overview.md) - Vision, core concepts, and quick start
- [Architecture](idea/01-architecture.md) - Distributed master/worker system
- [Bots](idea/03-bots.md) - Bot directory structure, soul.md, and Dockerfiles
- [Channels](idea/09-channels.md) - Slack, Discord, REST API, and custom channels
- [MCP & Tools](idea/05-mcp-and-tools.md) - Model Context Protocol integrations
- [Templates & Instances](idea/12-templates-and-instances.md) - Define once, deploy many
- [All idea docs &rarr;](idea/README.md)

### MVP Implementation

Step-by-step build phases from foundation to production:

- [Phase 1 - Foundation](mvp/phase-1-foundation.md) - Config + database
- [Phase 2 - Docker](mvp/phase-2-docker.md) - Container execution
- [Phase 3 - Lifecycle](mvp/phase-3-lifecycle.md) - Bot start/stop/reload
- [Phase 4 - Channels](mvp/phase-4-channels.md) - Slack + Discord adapters
- [Phase 5 - AI Agent](mvp/phase-5-ai-agent.md) - Vercel AI SDK integration
- [All phases &rarr;](mvp/README.md)

### Missing Implementation

Features designed but not yet implemented:

- [Status Overview](full-missing-implementation/README.md) - What's done vs. remaining
- [Workers](full-missing-implementation/01-workers.md) - Remote worker distribution
- [MCP](full-missing-implementation/02-mcp.md) - Full MCP server lifecycle
- [Queuing](full-missing-implementation/05-queuing.md) - PostgreSQL message queue
- [All missing features &rarr;](full-missing-implementation/README.md)

## Key Features

| Feature | Description |
|---------|-------------|
| **Multi-Bot Architecture** | Run multiple specialized AI bots with unique personalities and tools |
| **Docker Isolation** | Each bot runs in sandboxed containers with resource limits |
| **Multi-Channel Support** | Deploy bots to Slack, Discord, REST API, and custom channels |
| **MCP Tool Integration** | Built-in support for Model Context Protocol tools |
| **Persistent Memory** | Conversation history with automatic summarization |
| **Distributed Workers** | Scale across local and remote worker nodes via SSH |
| **Hot Reload** | Update bot configs without downtime |
| **Secret Management** | Secure secret interpolation from multiple providers |
| **PostgreSQL Backend** | Robust storage for sessions, queue, and audit logs |

## Architecture Overview

```
                    Users
                      |
            +---------+---------+
            |  Load Balancer    |
            +---------+---------+
                      |
        +-------------+-------------+
        v             v             v
   +--------+   +--------+   +--------+
   |Master 1|   |Master 2|   |Master N|
   |(Slack)  |   |(Discord)|  | (REST) |
   +--------+   +--------+   +--------+
        |             |             |
        +-------------+-------------+
                      v
              +------+------+
              | PostgreSQL  |
              |  (Shared)   |
              +------+------+
                      |
        +------+------+------+------+
        v      v      v      v
   +------+ +------+ +------+ +------+
   |Wkr 1 | |Wkr 2 | |Wkr 3 | |Wkr N |
   +------+ +------+ +------+ +------+
     Bots     Bots     Bots     Bots
```

## Technology Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js >= 22 |
| Model Abstraction | Vercel AI SDK |
| Execution | Docker containers |
| Database | PostgreSQL |
| Channels | Slack Bolt, Discord.js |
| MCP | @modelcontextprotocol/sdk |
| Deployment | Docker Compose |

## Links

- [GitHub Repository](https://github.com/developerz-ai/ai-army)
- [npm Package](https://www.npmjs.com/package/ai-army)
- [Issue Tracker](https://github.com/developerz-ai/ai-army/issues)
