# MVP Implementation Guide

**Start Here**: Complete step-by-step implementation guide

---

## Quick Reference

**Package**: `ai-army`
**PostgreSQL**: 18 (not 16)
**Node**: 22+
**Testing**: test/ directory (not .test.js files)
**Quality**: SRP, SOLID, TESTED - every module fully implemented

---

## Phase Sequence

Build in this exact order (each depends on previous):

### Phase 1: Foundation → [Details](./phase-1-foundation.md)
**Purpose**: Config loading, database, validation
**Deliverables**: ConfigLoader, PostgresStorage, SessionManager, migrations
**Test**: 5 test files
**Estimate**: 9 hours
**Validate**: `npx ai-army validate` works

### Phase 2: Docker → [Details](./phase-2-docker.md)
**Purpose**: Real bash in containers
**Deliverables**: DockerManager, ContainerPool, ToolExecutor
**Test**: 3 integration tests with Docker
**Estimate**: 8 hours
**Validate**: Container creates, bash executes

### Phase 3: Lifecycle → [Details](./phase-3-lifecycle.md)
**Purpose**: Bot start/stop/reload
**Deliverables**: BotManager, Orchestrator, SoulLoader, ConfigValidator
**Test**: 4 test files
**Estimate**: 9 hours
**Validate**: Bots load and start from config

### Phase 4: Channels → [Details](./phase-4-channels.md)
**Purpose**: Slack + Discord integration
**Deliverables**: SlackAdapter, DiscordAdapter, ChannelManager, MessageRouter
**Test**: 4 integration tests
**Estimate**: 12 hours
**Validate**: Messages received from Slack/Discord

### Phase 5: AI Agent → [Details](./phase-5-ai-agent.md)
**Purpose**: Vercel AI SDK with tools
**Deliverables**: ModelFactory, ToolRegistry, BashTool, FileTools, AgentRunner
**Test**: 5 integration tests
**Estimate**: 11 hours
**Validate**: AI processes message with tool calls

### Phase 6: E2E Flow → [Details](./phase-6-e2e.md)
**Purpose**: Complete message flow
**Deliverables**: MessageProcessor, Orchestrator (complete), ErrorHandler
**Test**: 3 E2E tests
**Estimate**: 8 hours
**Validate**: Full Slack → AI → Docker → Response works

### Phase 7: CLI → [Details](./phase-7-cli.md)
**Purpose**: Developer commands
**Deliverables**: CLI (complete), ProjectInitializer, StatusCommand
**Test**: 3 integration tests
**Estimate**: 9 hours
**Validate**: `npx ai-army init` creates project with CLAUDE.md + AGENT.md

### Phase 8: Demo → [Details](./phase-8-demo.md)
**Purpose**: ./demo project for developers
**Deliverables**: 3 bots, setup scripts, CLAUDE.md, AGENT.md
**Test**: Demo validation
**Estimate**: 4 hours
**Validate**: `cd demo && ./scripts/setup.sh && npm start` works

### Phase 9: CI/CD → [Details](./phase-9-cicd.md)
**Purpose**: Automated testing
**Deliverables**: Enhanced GitHub Actions, test helpers
**Test**: All tests run in CI
**Estimate**: 2 hours
**Validate**: PR triggers tests automatically

### Phase 10: Hot Reload → [Details](./phase-10-reload.md)
**Purpose**: nginx-style reload
**Deliverables**: ConfigWatcher, BotReloader, ReloadCommand, AdminRouter
**Test**: 4 integration tests
**Estimate**: 8 hours
**Validate**: `npx ai-army reload` works

---

## Implementation Checklist

### Before Starting
- [ ] PostgreSQL 18 installed or Docker available
- [ ] Node.js 22+ installed
- [ ] Anthropic API key for testing
- [ ] Slack app created (optional, for testing)
- [ ] Docker daemon running

### Phase 1
- [ ] migrations/001_initial_schema.sql created
- [ ] src/config/ConfigLoader.js implemented
- [ ] src/config/ConfigValidator.js implemented
- [ ] src/adapters/storage/PostgresStorage.js implemented
- [ ] src/core/SessionManager.js implemented
- [ ] All 5 unit tests pass

### Phase 2
- [ ] src/execution/DockerManager.js implemented
- [ ] src/execution/ContainerPool.js implemented
- [ ] src/execution/ToolExecutor.js implemented
- [ ] All 3 integration tests pass
- [ ] Container can execute bash commands

### Phase 3
- [ ] src/core/BotManager.js implemented
- [ ] src/core/Orchestrator.js enhanced
- [ ] src/utils/SoulLoader.js implemented
- [ ] src/database/MigrationRunner.js implemented
- [ ] All 4 tests pass
- [ ] Bots start from config

### Phase 4
- [ ] src/adapters/channels/SlackAdapter.js implemented
- [ ] src/adapters/channels/DiscordAdapter.js implemented
- [ ] src/core/ChannelManager.js implemented
- [ ] src/core/MessageRouter.js implemented
- [ ] All 4 integration tests pass
- [ ] Can receive Slack messages

### Phase 5
- [ ] src/models/ModelFactory.js implemented
- [ ] src/tools/ToolRegistry.js implemented
- [ ] src/tools/BashTool.js implemented
- [ ] src/tools/FileTools.js implemented
- [ ] src/agent/AgentRunner.js implemented
- [ ] All 5 integration tests pass
- [ ] AI executes tools in Docker

### Phase 6
- [ ] src/core/MessageProcessor.js implemented
- [ ] src/core/Orchestrator.js completed
- [ ] src/utils/ErrorHandler.js implemented
- [ ] All 3 E2E tests pass
- [ ] Full message flow works

### Phase 7
- [ ] bin/cli.js completed
- [ ] src/cli/ProjectInitializer.js implemented
- [ ] src/cli/StatusCommand.js implemented
- [ ] All 3 CLI tests pass
- [ ] `npx ai-army init` works
- [ ] Generated projects have CLAUDE.md + AGENT.md

### Phase 8
- [ ] demo/ directory created
- [ ] 3 demo bots configured
- [ ] Setup scripts working
- [ ] CLAUDE.md and AGENT.md created
- [ ] Demo runs successfully

### Phase 9
- [ ] .github/workflows/ci.yml enhanced
- [ ] package.json test scripts updated
- [ ] test/helpers/ created
- [ ] All tests run in CI
- [ ] CI badge green

### Phase 10
- [ ] src/config/ConfigWatcher.js implemented
- [ ] src/core/BotReloader.js implemented
- [ ] src/cli/ReloadCommand.js implemented
- [ ] src/api/AdminRouter.js implemented
- [ ] All 4 hot reload tests pass
- [ ] `npx ai-army reload` works

---

## Testing Strategy

### Unit Tests
**Run**: `npm run test:unit`
**Speed**: < 1 second total
**Purpose**: Test logic without external dependencies

### Integration Tests
**Run**: `npm run test:integration`
**Speed**: < 30 seconds total
**Requirements**: PostgreSQL 18, Docker daemon
**Purpose**: Test with real DB and containers

### E2E Tests
**Run**: `npm run test:e2e`
**Speed**: < 60 seconds total
**Requirements**: PostgreSQL 18, Docker, (optional: Slack/Discord)
**Purpose**: Test complete message flow

### All Tests
**Run**: `npm test`
**Speed**: < 2 minutes total
**Coverage**: > 90% of code

---

## Quality Gates

**Every PR must**:
- ✅ Pass linting (`npm run lint`)
- ✅ Pass unit tests (`npm run test:unit`)
- ✅ Pass integration tests (`npm run test:integration`)
- ✅ Pass E2E tests (`npm run test:e2e`)
- ✅ Validate demo (`cd demo && npx ai-army validate`)

**Every file must**:
- ✅ Have JSDoc header
- ✅ Follow SRP (one responsibility)
- ✅ Have test file in test/
- ✅ Be < 300 lines
- ✅ Use clear symbol names
- ✅ Handle errors with context

---

## File Symbols Reference

Quick lookup for class and function names:

**Core**:
- `Orchestrator` - Main orchestration engine (src/core/Orchestrator.js)
- `BotManager` - Bot lifecycle (src/core/BotManager.js)
- `SessionManager` - Session tracking (src/core/SessionManager.js)
- `ChannelManager` - Channel adapters (src/core/ChannelManager.js)
- `MessageRouter` - Message routing (src/core/MessageRouter.js)
- `MessageProcessor` - Processing pipeline (src/core/MessageProcessor.js)
- `BotReloader` - Hot reload (src/core/BotReloader.js)

**Config**:
- `ConfigLoader` - Load configs (src/config/ConfigLoader.js)
- `ConfigValidator` - Validate (src/config/ConfigValidator.js)
- `ConfigWatcher` - File watching (src/config/ConfigWatcher.js)

**Execution**:
- `DockerManager` - Docker API (src/execution/DockerManager.js)
- `ContainerPool` - Container reuse (src/execution/ContainerPool.js)
- `ToolExecutor` - Tool routing (src/execution/ToolExecutor.js)

**Adapters**:
- `SlackAdapter` - Slack integration (src/adapters/channels/SlackAdapter.js)
- `DiscordAdapter` - Discord integration (src/adapters/channels/DiscordAdapter.js)
- `PostgresStorage` - Database (src/adapters/storage/PostgresStorage.js)
- `EnvAdapter` - Secrets (src/adapters/secrets/EnvAdapter.js)

**Tools**:
- `ToolRegistry` - Tool management (src/tools/ToolRegistry.js)
- `createBashTool()` - Bash tool (src/tools/BashTool.js)
- `createReadFileTool()` - File tools (src/tools/FileTools.js)

**Agent**:
- `AgentRunner` - AI execution (src/agent/AgentRunner.js)
- `ModelFactory` - Model creation (src/models/ModelFactory.js)

**Utilities**:
- `SoulLoader` - Load soul.md (src/utils/SoulLoader.js)
- `ErrorHandler` - Error logging (src/utils/ErrorHandler.js)
- `MigrationRunner` - Migrations (src/database/MigrationRunner.js)

**CLI**:
- `ProjectInitializer` - Project init (src/cli/ProjectInitializer.js)
- `StatusCommand` - Status display (src/cli/StatusCommand.js)
- `ReloadCommand` - Hot reload (src/cli/ReloadCommand.js)

---

## Common Commands Reference

```bash
# Development
npm install                    # Install dependencies
npm run dev                    # Start with hot reload
npm run test:watch            # Run tests on file change
npm run lint:fix              # Auto-fix lint issues

# Testing
npm run test:unit             # Fast unit tests
npm run test:integration      # With PostgreSQL 18 + Docker
npm run test:e2e              # Full system test
npm test                      # All tests

# Deployment
npx ai-army validate          # Check config
npx ai-army migrate           # Run migrations
npx ai-army start             # Production start
npx ai-army reload            # Hot reload config
npx ai-army status            # Show system state

# Demo
cd demo
./scripts/setup.sh           # One-time setup
npm start                     # Run demo
./scripts/test.sh            # Test all bots
./scripts/cleanup.sh         # Clean up
```

---

## MVP Deliverables

### Code
- ✅ 41 implementation files (~5,500 LOC)
- ✅ 31 test files (~3,000 LOC)
- ✅ 4 database migrations
- ✅ 8 demo files
- ✅ 2 CI/CD workflows

### Documentation
- ✅ 10 phase implementation docs
- ✅ OVERVIEW.md with complete plan
- ✅ README.md updated
- ✅ CLAUDE.md in generated projects
- ✅ AGENT.md in generated projects
- ✅ Demo README with instructions

### Features
- ✅ Multi-bot orchestration
- ✅ Slack + Discord channels
- ✅ Real Docker execution
- ✅ Multi-provider AI models
- ✅ Session persistence
- ✅ Hot config reload
- ✅ Comprehensive testing
- ✅ CI/CD automation

---

## Success Definition

**MVP complete when**: Developer runs these commands and everything works:

```bash
# 1. Initialize project
npx ai-army init my-bot-army
cd my-bot-army

# 2. Add API key
echo "ANTHROPIC_API_KEY=sk-ant-..." >> .env

# 3. Deploy
docker-compose up -d

# 4. Validate
npx ai-army status
# Shows: ✅ 1 bot running

# 5. Test
# Send message to bot in Slack → receives response

# 6. Modify
vim bots/assistant/soul.md
npx ai-army reload
# Bot personality updates immediately

# 7. Verify
# Send message → bot uses new personality
```

**This proves**: Architecture works, framework is usable, ready for production features.

---

## Getting Started

1. Read [OVERVIEW.md](./OVERVIEW.md) for complete plan
2. Start with [Phase 1](./phase-1-foundation.md)
3. Build phases sequentially
4. Run tests after each phase
5. Deploy demo after Phase 8
6. Ship MVP after Phase 10

**Total time**: 2-3 weeks full-time or 1-2 months part-time

---

## Need Help?

- 📖 Read phase docs for detailed specs
- 🤖 Use CLAUDE.md instructions for Claude Code
- 🤖 Use AGENT.md for any AI agent
- 💬 See docs/idea/ for architecture details
- 🐛 Run tests to verify implementation
