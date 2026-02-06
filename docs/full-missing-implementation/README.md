# Missing Implementation Overview

This directory documents features designed in `docs/idea/` but not yet implemented in `src/`.

## Status Legend
- ❌ Not implemented
- 🟡 Partially implemented
- ✅ Fully implemented

## Implementation Status

| Feature | Status | Priority | Document |
|---------|--------|----------|----------|
| Worker Distribution | ❌ | High | [01-workers.md](./01-workers.md) |
| MCP Integration | ❌ | High | [02-mcp.md](./02-mcp.md) |
| Skills System | ❌ | Medium | [03-skills.md](./03-skills.md) |
| Templates & Instances | ❌ | Medium | [04-templates.md](./04-templates.md) |
| Message Queuing | ❌ | High | [05-queuing.md](./05-queuing.md) |
| Webhooks | ❌ | Medium | [06-webhooks.md](./06-webhooks.md) |
| Channel Manager | 🟡 | Medium | [07-channels.md](./07-channels.md) |
| Model Provider System | 🟡 | Medium | [08-models.md](./08-models.md) |
| Secrets Integration | 🟡 | Low | [09-secrets.md](./09-secrets.md) |
| REST API (full) | 🟡 | Medium | [10-rest-api.md](./10-rest-api.md) |
| Health Monitoring | ❌ | Low | [11-health.md](./11-health.md) |
| Audit Logging | ❌ | Low | [12-audit.md](./12-audit.md) |

## What's Already Implemented

✅ Core orchestration engine
✅ Bot lifecycle management
✅ Configuration system with validation
✅ Hot reload (config/soul/container)
✅ Docker container management
✅ PostgreSQL storage adapter
✅ Slack/Discord/REST channel adapters
✅ Database migrations
✅ CLI commands
✅ Session management (basic)
✅ Message routing with restrictions
✅ Admin API (hot reload endpoints)

## Implementation Priority

### Phase 11: Worker Distribution (High Priority)
- Remote worker support via SSH tunnels
- Worker registry in PostgreSQL
- Bot-to-worker assignment
- Health checks and failover

### Phase 12: MCP & Message Queue (High Priority)
- MCP server lifecycle management
- PostgreSQL-based message queue
- LISTEN/NOTIFY for real-time processing
- Concurrent message handling

### Phase 13: Templates & Skills (Medium Priority)
- Template system for bot definitions
- Instance creation from templates
- Skills loader and registry
- Skill attachment to bots

### Phase 14: Webhooks & Observability (Medium Priority)
- Per-bot webhook configuration
- Event emission system
- Health monitoring dashboard
- Audit logging

### Phase 15: Polish & Production (Low Priority)
- Complete REST API
- Secret resolution in config
- Multiple model provider support
- Channel manager abstraction
