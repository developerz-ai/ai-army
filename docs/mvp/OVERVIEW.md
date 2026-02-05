# AI Army MVP - Complete Implementation Plan

**Goal**: Fully functional multi-bot framework with Slack/Discord, PostgreSQL 18, Docker execution
**Quality**: SRP, SOLID, TESTED - every module fully implemented, no TODOs
**Testing**: ~25 test files covering 100% of public APIs
**Demo**: Rails-style ./demo project for developers
**CI/CD**: Automated testing on every PR
**Hot Reload**: nginx-style validate and reload

---

## 📚 Library Helper Files

**NEW**: Before implementing, check the **[helpers/](./helpers/)** directory for comprehensive library recommendations!

Each helper file covers:
- ✅ Recommended libraries with justification
- ✅ Why NOT to use alternatives
- ✅ Implementation examples
- ✅ Testing strategies
- ✅ Common pitfalls and solutions

**Quick Links**:
- [Configuration & Environment](./helpers/01-configuration-libraries.md)
- [Database & Migrations](./helpers/02-database-libraries.md)
- [Docker Management](./helpers/03-docker-management.md)
- [Validation & Schema](./helpers/04-validation-schema.md)
- [Channels (Slack & Discord)](./helpers/05-channels-slack-discord.md)
- [AI SDK Integration](./helpers/06-ai-sdk-integration.md)
- **[Vercel AI SDK Agent Loop](./helpers/11-vercel-ai-sdk-agent-loop.md)** ⭐ Important!
- [Testing Frameworks](./helpers/07-testing-frameworks.md)
- [Logging](./helpers/08-logging-libraries.md)
- [CLI & HTTP Frameworks](./helpers/09-cli-http-frameworks.md)
- [Utilities & Misc](./helpers/10-utilities-misc.md)

**Total Production Dependencies**: 16 well-chosen libraries (see helpers/README.md)

---

## MVP Scope

### What's Included ✅
- ✅ Configuration loading with env var interpolation
- ✅ PostgreSQL 18 for sessions and bot state
- ✅ Docker containers with real bash execution
- ✅ Slack integration (@slack/bolt)
- ✅ Discord integration (discord.js)
- ✅ Vercel AI SDK agent with tools
- ✅ Session management with compaction
- ✅ Multi-provider models (Anthropic, OpenAI, OpenRouter, Ollama)
- ✅ Built-in tools (bash, readFile, writeFile, glob, grep)
- ✅ User/channel restrictions
- ✅ Hot reload (like nginx -s reload)
- ✅ CLI commands (init, validate, migrate, start, dev, reload, status)
- ✅ ./demo project with 3 working bots
- ✅ GitHub Actions CI/CD
- ✅ Comprehensive test suite

### What's Deferred ⏭️
- ⏭️ MCP server integration
- ⏭️ Skills system
- ⏭️ Remote workers via SSH
- ⏭️ Message queuing
- ⏭️ Webhooks
- ⏭️ Templates & instances
- ⏭️ Bitwarden/1Password adapters
- ⏭️ REST API (minimal version in MVP)

---

## Implementation Phases

| Phase | Name | Files | Tests | LOC |
|-------|------|-------|-------|-----|
| 1 | Foundation | 5 | 5 | ~800 |
| 2 | Docker Execution | 3 | 3 | ~600 |
| 3 | Bot Lifecycle | 4 | 4 | ~700 |
| 4 | Channels | 4 | 4 | ~800 |
| 5 | AI Agent | 5 | 5 | ~600 |
| 6 | E2E Flow | 3 | 3 | ~400 |
| 7 | CLI Tools | 3 | 3 | ~500 |
| 8 | Demo | 8 | - | ~400 |
| 9 | CI/CD | 2 | - | ~100 |
| 10 | Hot Reload | 4 | 4 | ~500 |
| **Total** | | **41** | **31** | **~5,500** |

---

## Complete File Structure After MVP

```
ai-army/
├── src/
│   ├── index.js ✅
│   │
│   ├── core/
│   │   ├── Orchestrator.js ✅ Main orchestration
│   │   ├── BotManager.js ✅ Bot lifecycle
│   │   ├── SessionManager.js ✅ Session tracking
│   │   ├── ChannelManager.js ✅ Channel adapters
│   │   ├── MessageRouter.js ✅ Message routing
│   │   ├── MessageProcessor.js ✅ Processing pipeline
│   │   └── BotReloader.js ✅ Hot reload logic
│   │
│   ├── config/
│   │   ├── ConfigLoader.js ✅ Load + validate
│   │   ├── ConfigValidator.js ✅ Validation rules
│   │   └── ConfigWatcher.js ✅ File watching
│   │
│   ├── database/
│   │   └── MigrationRunner.js ✅ Migration system
│   │
│   ├── adapters/
│   │   ├── channels/
│   │   │   ├── SlackAdapter.js ✅
│   │   │   ├── DiscordAdapter.js ✅
│   │   │   └── RESTAdapter.js ⏭️ Post-MVP
│   │   ├── secrets/
│   │   │   └── EnvAdapter.js ✅
│   │   └── storage/
│   │       └── PostgresStorage.js ✅
│   │
│   ├── execution/
│   │   ├── DockerManager.js ✅ Docker API
│   │   ├── ContainerPool.js ✅ Container reuse
│   │   └── ToolExecutor.js ✅ Tool routing
│   │
│   ├── models/
│   │   └── ModelFactory.js ✅ Multi-provider
│   │
│   ├── agent/
│   │   └── AgentRunner.js ✅ Vercel AI SDK
│   │
│   ├── tools/
│   │   ├── ToolRegistry.js ✅
│   │   ├── BashTool.js ✅
│   │   └── FileTools.js ✅
│   │
│   ├── cli/
│   │   ├── ProjectInitializer.js ✅
│   │   ├── ReloadCommand.js ✅
│   │   └── StatusCommand.js ✅
│   │
│   ├── api/
│   │   └── AdminRouter.js ✅
│   │
│   └── utils/
│       ├── SoulLoader.js ✅
│       └── ErrorHandler.js ✅
│
├── bin/
│   └── cli.js ✅ Full CLI
│
├── migrations/
│   └── 001_initial_schema.sql ✅
│
├── test/
│   ├── unit/ (12 test files)
│   ├── integration/ (16 test files)
│   ├── e2e/ (1 test file)
│   └── helpers/ (3 files)
│
├── demo/
│   ├── package.json
│   ├── config.json
│   ├── docker-compose.yml
│   ├── README.md
│   ├── CLAUDE.md
│   ├── AGENT.md
│   ├── .env.example
│   ├── bots/
│   │   ├── echo-bot/
│   │   ├── calculator-bot/
│   │   └── file-assistant/
│   └── scripts/
│       ├── setup.sh
│       ├── test.sh
│       └── cleanup.sh
│
└── templates/
    └── basic/
        ├── config.json
        ├── .env.example
        ├── docker-compose.yml
        ├── README.md
        ├── CLAUDE.md
        ├── AGENT.md
        └── bots/
            └── assistant/
```

---

## Test Coverage

### Unit Tests (12 files, ~120 tests)
Fast, no external dependencies:
- config/ConfigLoader.test.js
- config/ConfigValidator.test.js
- core/SessionManager.test.js
- core/BotManager.test.js
- core/MessageRouter.test.js
- core/ChannelManager.test.js
- adapters/EnvAdapter.test.js
- utils/SoulLoader.test.js
- utils/ErrorHandler.test.js
- models/ModelFactory.test.js
- tools/ToolRegistry.test.js
- cli/ProjectInitializer.test.js

### Integration Tests (16 files, ~80 tests)
With PostgreSQL 18, Docker:
- adapters/PostgresStorage.test.js
- adapters/SlackAdapter.test.js (mock/sandbox)
- adapters/DiscordAdapter.test.js (mock/sandbox)
- execution/DockerManager.test.js
- execution/ContainerPool.test.js
- execution/ToolExecutor.test.js
- tools/BashTool.test.js
- tools/FileTools.test.js
- agent/AgentRunner.test.js
- core/MessageProcessor.test.js
- core/BotReloader.test.js
- core/Orchestrator.test.js
- database/MigrationRunner.test.js
- config/ConfigWatcher.test.js
- cli/commands.test.js
- cli/reload.test.js
- api/AdminRouter.test.js

### E2E Tests (1 file, ~5 tests)
Full system:
- e2e/Orchestrator.e2e.test.js

**Total**: ~205 tests across 29 test files

---

## Development Workflow

### Day 1: Setup
```bash
git clone https://github.com/developerz-ai/ai-army.git
cd ai-army
npm install
docker run -d --name ai-army-postgres \
  -e POSTGRES_DB=ai_army \
  -e POSTGRES_USER=ai_army \
  -e POSTGRES_PASSWORD=password \
  -p 5432:5432 \
  postgres:18-alpine
cp .env.example .env
vim .env  # Add ANTHROPIC_API_KEY
```

### Day 2: Develop
```bash
# Run tests while developing
npm run test:watch

# Lint
npm run lint:fix

# Start with hot reload
npm run dev
```

### Day 3: Test Demo
```bash
cd demo
./scripts/setup.sh
npm start
./scripts/test.sh
```

### Day 4: Deploy
```bash
# Push to main
git push origin main

# CI runs automatically
# - Linting ✅
# - Unit tests ✅
# - Integration tests ✅
# - E2E tests ✅
# - Demo validation ✅
```

---

## Success Metrics

### Functional
- ✅ Bot starts from config.json
- ✅ Connects to Slack/Discord
- ✅ Receives @mentions and DMs
- ✅ Processes with AI (Anthropic/OpenAI/OpenRouter/Ollama)
- ✅ Executes bash in Docker
- ✅ Maintains conversation history
- ✅ Compacts long sessions
- ✅ Reloads config without restart
- ✅ Multiple bots run simultaneously

### Quality
- ✅ All tests pass
- ✅ Code coverage > 90%
- ✅ No lint errors
- ✅ No TODOs in production code
- ✅ Every module < 300 lines
- ✅ Every public method documented
- ✅ Clear error messages

### Developer Experience
- ✅ `npx ai-army init` creates working project
- ✅ ./demo runs with one command
- ✅ CLAUDE.md helps Claude Code users
- ✅ AGENT.md helps any AI agent
- ✅ Hot reload for fast iteration
- ✅ Clear validation errors

---

## Estimated Effort

| Phase | Implementation | Testing | Total |
|-------|---------------|---------|-------|
| 1 | 6 hours | 3 hours | 9 hours |
| 2 | 5 hours | 3 hours | 8 hours |
| 3 | 6 hours | 3 hours | 9 hours |
| 4 | 8 hours | 4 hours | 12 hours |
| 5 | 7 hours | 4 hours | 11 hours |
| 6 | 5 hours | 3 hours | 8 hours |
| 7 | 6 hours | 3 hours | 9 hours |
| 8 | 4 hours | - | 4 hours |
| 9 | 2 hours | - | 2 hours |
| 10 | 5 hours | 3 hours | 8 hours |
| **Total** | **54 hours** | **26 hours** | **80 hours** |

**Timeline**: 2-3 weeks for 1 developer working full-time

---

## Post-MVP Roadmap

After MVP is complete and tested:

### Phase 11: MCP Integration
- MCP server manager
- Built-in MCP servers (github, notion, filesystem)
- Per-bot MCP server attachment

### Phase 12: Skills System
- Vercel AI SDK agent skills
- SKILL.md loader
- Public skills registry

### Phase 13: Remote Workers
- SSH tunnel management
- Worker pool with remote workers
- Worker health monitoring

### Phase 14: Message Queuing
- Per-session message queue
- Priority queuing
- Queue monitoring

### Phase 15: Webhooks
- Webhook manager
- Event triggers
- Retry logic with exponential backoff

### Phase 16: Templates
- Bot template system
- Instance deployment
- Dynamic instance creation

---

## Key Design Decisions

### 1. PostgreSQL 18 (not Redis/SQLite)
**Why**: ACID guarantees, complex queries, multi-master support, built-in LISTEN/NOTIFY

### 2. Vercel AI SDK (not Claude Agent SDK)
**Why**: Multi-provider support, but we implement custom Docker execution (not just-bash simulation)

### 3. Real Docker (not simulated bash)
**Why**: Bots need real binaries (git, python, node, etc), not just shell commands

### 4. No UI (config files only)
**Why**: Version control, reproducibility, automation-first, simplicity

### 5. Test directory (not .test.js)
**Why**: Clean separation, easier to exclude from builds, follows Jest/Vitest patterns

### 6. Hot Reload (not full restart)
**Why**: Fast iteration, preserve sessions, like nginx

---

## Critical Files Reference

**Core orchestration**:
- src/core/Orchestrator.js:14 - `async start()`
- src/core/BotManager.js:11 - `async loadBot()`
- src/core/SessionManager.js:12 - `getSessionKey()`

**Docker execution**:
- src/execution/DockerManager.js:7 - `async createContainer()`
- src/execution/ContainerPool.js:11 - `async getContainer()`

**Channel adapters**:
- src/adapters/channels/SlackAdapter.js:6 - `async initialize()`
- src/adapters/channels/DiscordAdapter.js:6 - `async initialize()`

**Configuration**:
- src/config/ConfigLoader.js - Main config loading
- migrations/001_initial_schema.sql - PostgreSQL 18 schema

**AI integration**:
- src/agent/AgentRunner.js - Vercel AI SDK integration
- src/tools/BashTool.js - Bash tool definition

**Testing**:
- test/helpers/setup.js - Test database setup
- test/helpers/fixtures.js - Mock data

---

## Validation Checklist

Before considering MVP complete:

**Functionality**:
- [ ] Config loads with ${ENV_VAR} interpolation
- [ ] PostgreSQL 18 migrations run successfully
- [ ] Docker containers created and persist
- [ ] Bash executes: `echo hello` → "hello"
- [ ] File operations work in container
- [ ] Slack bot receives @mentions
- [ ] Discord bot receives @mentions
- [ ] AI processes messages (Anthropic model)
- [ ] Tools execute in Docker
- [ ] Sessions save to database
- [ ] Multiple messages in conversation work
- [ ] Session compaction triggers at threshold
- [ ] Multiple bots run simultaneously
- [ ] Config validates before reload
- [ ] Hot reload updates bots

**Quality**:
- [ ] All 205+ tests pass
- [ ] No lint errors
- [ ] No TODO comments
- [ ] All public methods documented
- [ ] Error messages are clear and actionable

**Developer Experience**:
- [ ] `npx ai-army init` creates working project
- [ ] Generated project has CLAUDE.md and AGENT.md
- [ ] ./demo runs with `./scripts/setup.sh && npm start`
- [ ] ./demo tests pass with `./scripts/test.sh`
- [ ] CI badge shows passing
- [ ] Documentation is up to date

---

## Architecture Validation

### Message Flow Test
```
User sends Slack message
  ↓ SlackAdapter.onMessage()
  ↓ MessageRouter.route() → finds bot
  ↓ MessageRouter.checkRestrictions() → allows
  ↓ MessageProcessor.processMessage()
    ↓ SessionManager.getSession() → loads history
    ↓ SessionManager.appendMessage() → adds user msg
    ↓ AgentRunner.run() → calls AI with tools
      ↓ AI requests bash tool
      ↓ BashTool.execute() → runs in Docker
      ↓ Result returned to AI
      ↓ AI generates response
    ↓ SessionManager.appendMessage() → adds assistant msg
    ↓ SessionManager saves to PostgreSQL 18
  ↓ SlackAdapter.sendMessage() → responds to user
```

### Database Flow Test
```sql
-- After message processed:
SELECT * FROM sessions WHERE id = 'bot:slack:C123:U456';
-- Shows: 2 messages (user + assistant)

SELECT * FROM tool_calls WHERE bot_id = 'test-bot';
-- Shows: 1 bash execution

SELECT * FROM bots WHERE id = 'test-bot';
-- Shows: status='running', container_id set
```

---

## Code Quality Standards

### Every File Must Have:
1. **JSDoc header** explaining purpose
2. **Single responsibility** (one thing well)
3. **Test file** in test/ directory
4. **Clear symbol names** (ConfigLoader not Loader)
5. **Error handling** with context
6. **< 300 lines** (keep focused)

### Example:
```javascript
/**
 * SessionManager - Conversation history tracking
 *
 * Manages per-user sessions with message history, token counting,
 * and automatic compaction when sessions grow too large.
 */

export class SessionManager {
  constructor(storage) {
    this.storage = storage;
    this.sessions = new Map();
  }

  /**
   * Generate session key from bot, channel, and user
   * Format: botId:channelType:channelId:userId
   */
  getSessionKey(botId, channel, userId) {
    return `${botId}:${channel.type}:${channel.id}:${userId}`;
  }

  // ... rest of implementation
}
```

---

## Dependencies

### Production
```json
{
  "dependencies": {
    "ai": "^4.0.0",
    "dockerode": "^4.0.2",
    "pg": "^8.13.1",
    "@slack/bolt": "^3.22.0",
    "discord.js": "^14.16.3",
    "chokidar": "^3.5.3"
  }
}
```

### Development
```json
{
  "devDependencies": {
    "eslint": "^9.17.0",
    "eslint-config-prettier": "^9.1.0",
    "eslint-plugin-prettier": "^5.2.1",
    "prettier": "^3.4.2",
    "c8": "^8.0.1"
  }
}
```

---

## Success Definition

**MVP is complete when**:

1. Developer runs `npx ai-army init my-bot`
2. Follows README to add ANTHROPIC_API_KEY
3. Runs `docker-compose up -d`
4. Bot responds to Slack messages
5. Bot executes bash commands in Docker
6. Conversation history persists
7. Config changes reload without restart
8. All tests pass in CI

**This proves the architecture works** and provides foundation for all post-MVP features.

---

## Next: Start Implementation

Begin with Phase 1 (Foundation) and build sequentially. Each phase is independently testable and deliverable.

See individual phase docs for detailed implementation specs:
- [Phase 1 - Foundation](./phase-1-foundation.md)
- [Phase 2 - Docker](./phase-2-docker.md)
- [Phase 3 - Lifecycle](./phase-3-lifecycle.md)
- [Phase 4 - Channels](./phase-4-channels.md)
- [Phase 5 - AI Agent](./phase-5-ai-agent.md)
- [Phase 6 - E2E](./phase-6-e2e.md)
- [Phase 7 - CLI](./phase-7-cli.md)
- [Phase 8 - Demo](./phase-8-demo.md)
- [Phase 9 - CI/CD](./phase-9-cicd.md)
- [Phase 10 - Hot Reload](./phase-10-reload.md)
