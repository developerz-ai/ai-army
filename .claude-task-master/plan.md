## Task List

Now I have a complete understanding of the project. Let me create the comprehensive master plan:

---

# AI Assistants Army MVP - Master Implementation Plan

## Executive Summary

This plan implements the full MVP for the **AI Assistants Army** framework - a multi-bot AI system (like Rails for AI bots). The codebase currently has **skeleton files with TODO placeholders** that need complete implementation across 10 phases.

**Current State**: ~15 skeleton files exist with TODO comments
**Target State**: ~41 fully implemented files + ~31 test files = ~8,500 LOC

## Architecture Overview

```
User Message (Slack/Discord)
    ↓
ChannelAdapter → MessageRouter → finds bot
    ↓
MessageProcessor → SessionManager → loads history
    ↓
AgentRunner → calls LLM with tools
    ↓
ToolExecutor → executes in Docker container
    ↓
Response back to user
    ↓
Session saved to PostgreSQL 18
```

## Success Criteria

1. ✅ **Tests pass**: `npm test` runs all unit, integration, and E2E tests successfully
2. ✅ **Lint clean**: `npm run lint` reports zero errors
3. ✅ **Demo works**: `cd demo && ./scripts/setup.sh && npm start` runs 3 working bots
4. ✅ **CLI functional**: `npx ai-army init my-project` creates a working project with CLAUDE.md + AGENT.md
5. ✅ **Hot reload**: `npx ai-army reload` validates and reloads config without restart
6. ✅ **E2E flow**: Slack message → AI processing → Docker tool execution → response
7. ✅ **CI green**: GitHub Actions passes all checks on PR

---

### PR 1: Foundation - Database Schema & Config Loader (Phase 1a)

**Branch**: `feat/phase-1-foundation-config`

- [x] `[coding]` Create `migrations/001_initial_schema.sql` with bots, sessions, tool_calls, schema_migrations tables
- [x] `[coding]` Implement `src/config/ConfigLoader.js` with `load()`, `interpolateEnvVars()`, `deepMerge()` methods - use dotenv, dotenv-expand, deepmerge
- [x] `[coding]` Create `test/unit/config/ConfigLoader.test.js` with 5+ tests for env interpolation, JSON loading, deep merge
- [x] `[quick]` Add missing dependencies to `package.json`: `dotenv`, `dotenv-expand`, `deepmerge`

---

### PR 2: Foundation - Config Validator & PostgreSQL Storage (Phase 1b)

**Branch**: `feat/phase-1-foundation-storage`

- [x] `[coding]` Implement `src/config/ConfigValidator.js` with Zod schemas for main config and bot config validation
- [x] `[coding]` Create `test/unit/config/ConfigValidator.test.js` with tests for valid/invalid configs, error reporting
- [x] `[coding]` Implement `src/adapters/storage/postgres.js` PostgresStorage class with connection pooling, parameterized queries, UPSERT methods
- [x] `[coding]` Create `test/integration/adapters/PostgresStorage.test.js` with database connection and CRUD tests
- [x] `[coding]` Create `test/helpers/setup.js` with `setupTestDatabase()` and `cleanupTestDatabase()` helpers

---

### PR 3: Foundation - Session Manager (Phase 1c)

**Branch**: `feat/phase-1-session-manager`

- [x] `[coding]` Implement `src/core/session-manager.js` SessionManager with `getSession()`, `appendMessage()`, `compact()`, token counting
- [x] `[coding]` Create `test/unit/core/SessionManager.test.js` with session key generation, message appending, compaction tests
- [x] `[coding]` Create `test/helpers/fixtures.js` with MOCK_MESSAGES, MOCK_SESSIONS test data
- [x] `[quick]` Create `src/adapters/secrets/env.js` EnvAdapter for ${ENV_VAR} secret resolution

---

### PR 4: Docker Execution - DockerManager (Phase 2a)

**Branch**: `feat/phase-2-docker-manager`

- [x] `[coding]` Implement `src/execution/docker-manager.js` DockerManager with dockerode: `createContainer()`, `startContainer()`, `stopContainer()`, `exec()`, `healthCheck()`, `installPackages()`
- [x] `[coding]` Create `test/integration/execution/DockerManager.test.js` with container creation, bash execution, output capture tests
- [x] `[quick]` Add utility function `parseMemory()` for '2g' → bytes conversion in DockerManager

---

### PR 5: Docker Execution - ContainerPool & ToolExecutor (Phase 2b)

**Branch**: `feat/phase-2-container-pool`

- [x] `[coding]` Implement `src/execution/container-pool.js` ContainerPool with container reuse, `getContainer()`, `recycleContainer()`, `healthCheckAll()`, `cleanup()`
- [x] `[coding]` Create `test/integration/execution/ContainerPool.test.js` with pooling, recycling, health check tests
- [x] `[coding]` Create `src/execution/ToolExecutor.js` with `executeTool()`, `bash()`, `readFile()`, `writeFile()`, `isDangerousCommand()` security checks
- [x] `[coding]` Create `test/integration/execution/ToolExecutor.test.js` with tool routing, dangerous command blocking, timeout tests

---

### PR 6: Bot Lifecycle - SoulLoader & MigrationRunner (Phase 3a)

**Branch**: `feat/phase-3-lifecycle-utils`

- [x] `[coding]` Create `src/utils/SoulLoader.js` with `loadSoulFile()`, `interpolateVariables()` for {botName} replacement
- [x] `[coding]` Create `test/unit/utils/SoulLoader.test.js` with file loading, variable interpolation tests
- [x] `[coding]` Create `src/database/MigrationRunner.js` with `runMigrations()`, `getMigrationStatus()`, transaction handling
- [x] `[coding]` Create `test/integration/database/MigrationRunner.test.js` with migration execution, skip-if-run, rollback tests

---

### PR 7: Bot Lifecycle - BotManager & Orchestrator (Phase 3b)

**Branch**: `feat/phase-3-bot-manager`

- [x] `[coding]` Implement `src/core/bot-manager.js` BotManager with `loadBot()`, `startBot()`, `stopBot()`, `reloadBot()`, config validation
- [x] `[coding]` Create `test/unit/core/BotManager.test.js` with bot loading, starting, stopping, reload tests
- [x] `[coding]` Enhance `src/core/orchestrator.js` Orchestrator with full startup sequence: config → DB → migrations → bots → channels
- [x] `[coding]` Create `test/integration/core/Orchestrator.test.js` with startup, shutdown, reload tests

---

### PR 8: Channels - SlackAdapter (Phase 4a)

**Branch**: `feat/phase-4-slack-adapter`

- [x] `[coding]` Implement `src/adapters/channels/slack.js` SlackAdapter with @slack/bolt Socket Mode, `initialize()`, `start()`, `stop()`, `sendMessage()`, `onMessage()`, `cleanMention()`
- [x] `[coding]` Create `test/integration/adapters/SlackAdapter.test.js` with mock Slack events, mention cleaning tests
- [x] `[quick]` Add Slack event types: app_mention, message (DM)

---

### PR 9: Channels - DiscordAdapter (Phase 4b)

**Branch**: `feat/phase-4-discord-adapter`

- [x] `[coding]` Implement `src/adapters/channels/discord.js` DiscordAdapter with discord.js v14, Gateway Intents, `splitMessage()` for >2000 chars
- [x] `[coding]` Create `test/integration/adapters/DiscordAdapter.test.js` with mock Discord client, message splitting tests
- [x] `[quick]` Configure Discord intents: Guilds, GuildMessages, DirectMessages, MessageContent

---

### PR 10: Channels - ChannelManager & MessageRouter (Phase 4c)

**Branch**: `feat/phase-4-channel-manager`

- [x] `[coding]` Create `src/core/ChannelManager.js` with adapter factory, `initializeChannel()`, `getChannel()`, `stopAll()`
- [x] `[coding]` Create `test/unit/core/ChannelManager.test.js` with adapter creation, registry tests
- [x] `[coding]` Create `src/core/MessageRouter.js` with `route()`, `checkRestrictions()`, `findBotForMessage()` for allowedUsers/deniedUsers/channels
- [x] `[coding]` Create `test/unit/core/MessageRouter.test.js` with routing, restriction enforcement, DM blocking tests

---

### PR 11: AI Agent - ModelFactory (Phase 5a)

**Branch**: `feat/phase-5-model-factory`

- [x] `[coding]` Create `src/models/ModelFactory.js` with `createModel()` supporting anthropic, openai, openrouter, ollama providers
- [x] `[coding]` Create `test/unit/models/ModelFactory.test.js` with provider creation, unknown provider error tests
- [x] `[quick]` Add AI SDK dependencies to package.json: `@ai-sdk/anthropic`, `@ai-sdk/openai`

---

### PR 12: AI Agent - ToolRegistry & Tools (Phase 5b)

**Branch**: `feat/phase-5-tools`

- [x] `[coding]` Create `src/tools/ToolRegistry.js` with `registerTool()`, `getToolsForBot()`, builtin tool registration
- [x] `[coding]` Create `test/unit/tools/ToolRegistry.test.js` with registration, bot-scoped tool retrieval tests
- [x] `[coding]` Create `src/tools/BashTool.js` with Zod schema, Docker execution, security checks
- [x] `[coding]` Create `test/integration/tools/BashTool.test.js` with bash execution, security blocking tests
- [x] `[coding]` Create `src/tools/FileTools.js` with `createReadFileTool()`, `createWriteFileTool()`, `createGlobTool()`, `createGrepTool()`
- [x] `[coding]` Create `test/integration/tools/FileTools.test.js` with file read/write/glob/grep tests

---

### PR 13: AI Agent - AgentRunner (Phase 5c)

**Branch**: `feat/phase-5-agent-runner`

- [x] `[coding]` Create `src/agent/AgentRunner.js` with `run()` using generateText, maxSteps:30, multi-step tool calling
- [x] `[coding]` Create `test/integration/agent/AgentRunner.test.js` with AI message processing, tool call tests (requires API key or mock)
- [x] `[quick]` Add `stream()` method to AgentRunner for streaming responses

---

### PR 14: E2E Flow - MessageProcessor (Phase 6a)

**Branch**: `feat/phase-6-message-processor`

- [x] `[coding]` Create `src/core/MessageProcessor.js` with `processMessage()`: session → agent → tools → save, `logToolCall()`, compaction trigger
- [x] `[coding]` Create `test/integration/core/MessageProcessor.test.js` with full pipeline, tool logging, compaction tests
- [x] `[coding]` Create `src/utils/ErrorHandler.js` with `logError()`, `classifyError()`, `redactSecrets()` for API keys

---

### PR 15: E2E Flow - Wire Everything & E2E Tests (Phase 6b)

**Branch**: `feat/phase-6-e2e`

- [x] `[coding]` Complete `src/core/orchestrator.js` with `_setupChannelHandlers()` wiring messages to MessageProcessor
- [x] `[coding]` Create `test/unit/utils/ErrorHandler.test.js` with secret redaction, error classification tests
- [x] `[coding]` Create `test/e2e/Orchestrator.e2e.test.js` with full Slack → AI → Docker → Response flow test
- [x] `[quick]` Add tool_calls table INSERT in MessageProcessor for audit trail

---

### PR 16: CLI - ProjectInitializer & Commands (Phase 7a)

**Branch**: `feat/phase-7-cli-init`

- [x] `[coding]` Create `src/cli/ProjectInitializer.js` with `initialize()`, `createDirectoryStructure()`, `writeTemplateFiles()`, `writeHelperFiles()` for CLAUDE.md + AGENT.md
- [x] `[coding]` Create `test/unit/cli/ProjectInitializer.test.js` with directory creation, template copying, CLAUDE.md generation tests
- [x] `[coding]` Implement `bin/cli.js` init command with template selection, directory creation
- [x] `[quick]` Add `commander` or native arg parsing to CLI for better command handling

---

### PR 17: CLI - Status, Validate, Migrate Commands (Phase 7b)

**Branch**: `feat/phase-7-cli-commands`

- [x] `[coding]` Create `src/cli/StatusCommand.js` with `showStatus()` displaying bots, sessions, database, channels state
- [x] `[coding]` Create `test/integration/cli/status.test.js` with status display tests
- [x] `[coding]` Implement full `validate`, `migrate`, `start`, `dev` commands in `bin/cli.js`
- [x] `[coding]` Create `test/integration/cli/commands.test.js` with validate, migrate command tests

---

### PR 18: Templates - Basic Project Template (Phase 7c)

**Branch**: `feat/phase-7-templates`

- [x] `[coding]` Create `templates/basic/config.json` with defaults, providers, channels structure
- [x] `[coding]` Create `templates/basic/docker-compose.yml` with PostgreSQL 18 service
- [x] `[coding]` Create `templates/basic/.env.example` with required environment variables
- [x] `[coding]` Create `templates/basic/bots/assistant/config.json` + `soul.md` default bot
- [x] `[coding]` Create `templates/basic/CLAUDE.md` with Claude Code instructions
- [x] `[coding]` Create `templates/basic/AGENT.md` with generic AI agent instructions
- [x] `[quick]` Create `templates/basic/README.md` and `templates/basic/.gitignore`

---

### PR 19: Demo Project - Setup & Bots (Phase 8a)

**Branch**: `feat/phase-8-demo-bots`

- [x] `[coding]` Create `demo/package.json` with ai-army dependency
- [x] `[coding]` Create `demo/config.json` with 3 bots configuration
- [x] `[coding]` Create `demo/bots/echo-bot/config.json` + `soul.md` - simplest bot
- [x] `[coding]` Create `demo/bots/calculator-bot/config.json` + `soul.md` - bash tool bot with bc package
- [x] `[coding]` Create `demo/bots/file-assistant/config.json` + `soul.md` - file operations bot
- [x] `[quick]` Create `demo/.env.example` with ANTHROPIC_API_KEY placeholder

---

### PR 20: Demo Project - Scripts & Docs (Phase 8b)

**Branch**: `feat/phase-8-demo-scripts`

- [x] `[coding]` Create `demo/scripts/setup.sh` - PostgreSQL 18 Docker, npm install, migrate
- [x] `[coding]` Create `demo/scripts/test.sh` - test messages to all 3 bots
- [x] `[coding]` Create `demo/scripts/cleanup.sh` - remove containers, volumes, data
- [x] `[coding]` Create `demo/docker-compose.yml` with PostgreSQL 18 + ai-army services
- [x] `[coding]` Create `demo/README.md` with quick start instructions
- [x] `[coding]` Create `demo/CLAUDE.md` with demo-specific Claude Code instructions
- [x] `[coding]` Create `demo/AGENT.md` with demo-specific AI agent instructions

---

### PR 21: CI/CD Pipeline Enhancement (Phase 9)

**Branch**: `feat/phase-9-cicd`

- [x] `[coding]` Update `.github/workflows/ci.yml` with separate jobs: lint, unit-tests, integration-tests (with PostgreSQL 18 service), e2e-tests, validate-demo
- [x] `[coding]` Update `package.json` scripts: `test:unit`, `test:integration`, `test:e2e`, proper test glob patterns for test/ directory
- [ ] `[quick]` Add PostgreSQL 18-alpine service in CI for integration tests
- [ ] `[quick]` Add docker pull node:22-slim step for container tests

---

### PR 22: Hot Reload - ConfigWatcher (Phase 10a)

**Branch**: `feat/phase-10-config-watcher`

- [ ] `[coding]` Create `src/config/ConfigWatcher.js` with chokidar file watching, `watch()`, `validateAndReload()`, `stop()`
- [ ] `[coding]` Create `test/integration/config/ConfigWatcher.test.js` with file change detection, validation before reload tests

---

### PR 23: Hot Reload - BotReloader & CLI (Phase 10b)

**Branch**: `feat/phase-10-bot-reloader`

- [ ] `[coding]` Create `src/core/BotReloader.js` with `reloadBotConfig()`, `reloadSoul()`, `reloadContainer()`, `needsContainerRestart()` detection
- [ ] `[coding]` Create `test/integration/core/BotReloader.test.js` with config-only reload, soul-only reload, sandbox change restart tests
- [ ] `[coding]` Create `src/cli/ReloadCommand.js` with nginx-style validate-then-reload flow
- [ ] `[coding]` Create `test/integration/cli/reload.test.js` with reload command tests

---

### PR 24: Hot Reload - Admin API (Phase 10c)

**Branch**: `feat/phase-10-admin-api`

- [ ] `[coding]` Create `src/api/AdminRouter.js` with `/api/admin/reload`, `/api/admin/status`, `/api/admin/bots/:botId/restart` endpoints
- [ ] `[coding]` Create `test/integration/api/AdminRouter.test.js` with endpoint tests, authentication checks
- [ ] `[coding]` Add `reload` command to `bin/cli.js` calling ReloadCommand
- [ ] `[quick]` Implement `dev` command with ConfigWatcher for watch mode

---

### PR 25: Final Integration & Documentation (Finalization)

**Branch**: `feat/final-integration`

- [ ] `[general]` Run full test suite: `npm test` - fix any failures
- [ ] `[general]` Run linting: `npm run lint:fix` - fix all lint errors
- [ ] `[general]` Verify demo works: `cd demo && ./scripts/setup.sh && npm start`
- [ ] `[general]` Update root `README.md` with installation, usage, architecture docs
- [ ] `[quick]` Add CI badge to README.md
- [ ] `[quick]` Verify all files have JSDoc headers and follow SRP (< 300 lines)

---

## Technical Notes

### Key Libraries
| Purpose | Library | Version |
|---------|---------|---------|
| AI SDK | ai, @ai-sdk/anthropic, @ai-sdk/openai | ^4.0.0 |
| Docker | dockerode | ^4.0.2 |
| Database | pg | ^8.13.1 |
| Slack | @slack/bolt | ^3.22.0 |
| Discord | discord.js | ^14.16.3 |
| Validation | zod | ^3.22.4 |
| File Watch | chokidar | ^3.5.3 |
| Config | dotenv, dotenv-expand, deepmerge | latest |

### Coding Standards (from CLAUDE.md)
- ES Modules with `import`/`export`
- Single quotes, semicolons, trailing commas
- 2-space indentation, 100 char line width
- Files: kebab-case.js, Classes: PascalCase
- Every file has `*.test.js` in test/ directory
- Parameterized SQL queries only (`$1, $2`)
- Error handling with `{ cause: err }` pattern

### Test Structure
```
test/
├── unit/           # Fast tests, no external deps
│   ├── config/
│   ├── core/
│   ├── utils/
│   ├── models/
│   ├── tools/
│   └── cli/
├── integration/    # With PostgreSQL 18, Docker
│   ├── adapters/
│   ├── execution/
│   ├── core/
│   ├── database/
│   ├── agent/
│   ├── api/
│   └── cli/
├── e2e/            # Full system tests
└── helpers/        # setup.js, fixtures.js
```

---

PLANNING COMPLETE