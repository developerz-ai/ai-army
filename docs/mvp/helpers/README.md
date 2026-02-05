# MVP Implementation Helper Files

This directory contains comprehensive library recommendations and implementation guides for each technical area of the AI Army MVP.

**Purpose**: Avoid reinventing the wheel by using battle-tested libraries where appropriate.

---

## Helper Files

### [01 - Configuration & Environment](./01-configuration-libraries.md)
**Covers**: Environment variables, deep object merging, config interpolation

**Libraries**:
- `dotenv` + `dotenv-expand` - Environment variable loading
- `deepmerge` - Deep object merging for configs

**Use in**: Phase 1 (ConfigLoader, deepMerge)

---

### [02 - Database & Migrations](./02-database-libraries.md)
**Covers**: PostgreSQL 18, connection pooling, migrations, JSONB arrays

**Libraries**:
- `pg` (node-postgres) - PostgreSQL client with built-in pooling
- Custom migration runner - Simple SQL file-based migrations

**Use in**: Phase 1 (PostgresStorage, MigrationRunner)

---

### [03 - Docker Management](./03-docker-management.md)
**Covers**: Container lifecycle, command execution, health checks, security

**Libraries**:
- `dockerode` - Official Docker API client

**Use in**: Phase 2 (DockerManager, ContainerPool)

---

### [04 - Validation & Schema](./04-validation-schema.md)
**Covers**: Configuration validation, schema validation, type safety

**Libraries**:
- `zod` - TypeScript-first schema validation (required by Vercel AI SDK)

**Use in**: Phase 1 (ConfigValidator), Phase 5 (Tool parameters)

---

### [05 - Channels (Slack & Discord)](./05-channels-slack-discord.md)
**Covers**: Slack Socket Mode, Discord intents, message handling

**Libraries**:
- `@slack/bolt` - Official Slack SDK with Socket Mode
- `discord.js` v14 - Official Discord library

**Use in**: Phase 4 (SlackAdapter, DiscordAdapter)

---

### [06 - AI SDK Integration](./06-ai-sdk-integration.md)
**Covers**: Multi-provider LLMs, tool calling, streaming, agents

**Libraries**:
- `ai` - Vercel AI SDK 6 core
- `@ai-sdk/anthropic` - Claude models
- `@ai-sdk/openai` - OpenAI + compatible APIs

**Use in**: Phase 5 (ModelFactory, AgentRunner, ToolRegistry)

---

### [07 - Testing Frameworks](./07-testing-frameworks.md)
**Covers**: Unit tests, integration tests, E2E, mocking

**Libraries**:
- **Native `node:test`** - Built-in test runner (zero dependencies!)

**Use in**: All phases (test files)

---

### [08 - Logging](./08-logging-libraries.md)
**Covers**: Structured logging, high-performance, error tracking

**Libraries**:
- `pino` - Fastest Node.js logger (5-10x faster than Winston)

**Use in**: All phases (logging)

---

### [09 - CLI & HTTP Frameworks](./09-cli-http-frameworks.md)
**Covers**: Command-line interface, admin API, HTTP server

**Libraries**:
- `commander` - Simple CLI framework
- `fastify` - Fast HTTP server (2x faster than Express)

**Use in**: Phase 7 (CLI tools), Phase 6 (AdminRouter)

---

### [10 - Utilities & Miscellaneous](./10-utilities-misc.md)
**Covers**: File watching, HTTP client, async utilities, string helpers

**Libraries**:
- `chokidar` - File watching for hot reload
- Native `fetch` - HTTP client (built-in)
- Custom utilities - Retry, timeout, string manipulation

**Use in**: Phase 10 (ConfigWatcher, hot reload)

---

### [11 - Vercel AI SDK Agent Loop](./11-vercel-ai-sdk-agent-loop.md)
**Covers**: Multi-step tool calling, maxSteps, agent workflow patterns

**Not a library guide** - Explains how the Vercel AI SDK agent loop works

**Use in**: Phase 5 (AgentRunner understanding)

---

## Total Dependencies Summary

| Category | Libraries | Count |
|----------|-----------|-------|
| **Production** | | |
| Config & Environment | dotenv, dotenv-expand, deepmerge | 3 |
| Database | pg | 1 |
| Docker | dockerode | 1 |
| Validation | zod | 1 |
| Channels | @slack/bolt, discord.js | 2 |
| AI SDK | ai, @ai-sdk/anthropic, @ai-sdk/openai | 3 |
| Logging | pino | 1 |
| CLI & HTTP | commander, fastify | 2 |
| Utilities | chokidar | 1 |
| **Testing (Dev Only)** | | |
| Test Runner | node:test (built-in) | 0 |
| Test Utilities | node:test mock API (built-in) | 0 |
| Pretty Logging (Dev) | pino-pretty | 1 |
| **TOTAL** | | **16** |

---

## Philosophy: Use Libraries Wisely

### ✅ When to Use a Library

1. **Complex Problem**: Docker API, Slack protocol, database pooling
2. **Battle-Tested**: pg has 10M+ weekly downloads, proven reliable
3. **Standard**: Vercel AI SDK is the standard for multi-provider LLM integration
4. **Time-Saver**: Reinventing chokidar would take weeks

### ❌ When NOT to Use a Library

1. **Simple Problem**: String manipulation, basic async utilities
2. **Native Alternative**: Use `fetch` (built-in) instead of axios
3. **Heavy Dependency**: Avoid libraries with many transitive dependencies
4. **Unmaintained**: Check last update date, issue count

### 🎯 Our Approach

- **Prefer native Node.js features** (fetch, Promise.all, fs/promises)
- **Use zero-dependency libraries** when possible (zod, pino)
- **Standard over custom** (Vercel AI SDK over custom LLM abstraction)
- **Test runner built-in** (node:test over Jest/Vitest)

---

## Implementation Order

Follow MVP phases sequentially, referencing helpers as needed:

1. **Phase 1** → Use helpers [01-config](#01---configuration--environment), [02-database](#02---database--migrations), [04-validation](#04---validation--schema)
2. **Phase 2** → Use helper [03-docker](#03---docker-management)
3. **Phase 3** → Continue with config/database helpers
4. **Phase 4** → Use helper [05-channels](#05---channels-slack--discord)
5. **Phase 5** → Use helpers [06-ai-sdk](#06---ai-sdk-integration), [11-agent-loop](#11---vercel-ai-sdk-agent-loop)
6. **Phase 6-10** → Use remaining helpers as needed

---

## Quick Reference: Library Choices

| Need | Chosen Library | Why Not Alternative? |
|------|----------------|----------------------|
| PostgreSQL | pg | ✅ Standard, built-in pooling |
| Validation | Zod | ✅ Zero deps, TypeScript-first, AI SDK requires it |
| Testing | node:test | ✅ Built-in, zero deps, fast startup |
| Logging | Pino | ✅ 5-10x faster than Winston |
| CLI | commander | ✅ Simple, lightweight vs heavy oclif |
| HTTP | Fastify | ✅ 2x faster than Express, modern API |
| File Watch | chokidar | ✅ Battle-tested (30M repos), cross-platform |
| HTTP Client | Native fetch | ✅ Built-in, no deps needed |
| Docker | dockerode | ✅ Only viable option, 2M+ downloads |
| AI SDK | Vercel AI SDK | ✅ Multi-provider standard, tool calling built-in |

---

## Questions?

If you're unsure which library to use:
1. Check the helper file for that area
2. Look at the "Why" section
3. Check the "Alternatives" and "Why NOT" sections
4. Follow the "Summary" recommendation

**Remember**: The goal is to **ship a working MVP quickly** using proven tools, not to evaluate every possible library option.
