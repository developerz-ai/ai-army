# Changelog

All notable changes to AI Army will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-02-14

### Added
- **PATCH `/api/bots/:id/config`** - Hot-update bot configuration (model, provider, tools, Docker image) without restarting the system
- **Bot-level access control** - Operator tokens can be scoped to specific bots via `name` and `bots` fields in auth token config
- **`experimental_repairToolCall`** - Automatic repair of malformed tool call JSON from models (e.g., aurora-alpha)
- **Fallback text extraction** - `MessageProcessor` always returns useful text, even when the model fails to produce a final text response

### Fixed
- Empty bot responses when tools are used - fixed tool result extraction to use Vercel AI SDK's `.output` property
- ConfigValidator Zod schema now preserves `name` and `bots` fields in auth tokens (previously stripped by `safeParse()`)
- Token normalization passes `name` and `bots` through to auth middleware
- Bot DB persistence on load (required for session foreign key constraints)
- Health check endpoint bypasses auth (required for Docker health checks)

## [0.1.0] - 2024-02-08

Initial release of AI Army - a framework for building multi-bot AI systems with distributed execution, channel adapters, and comprehensive bot management.

### Added

#### Core Framework
- **Bot Orchestration System**
  - Multi-bot lifecycle management with start/stop/reload capabilities
  - Message routing and processing pipeline
  - Session management with conversation history
  - Dynamic bot reloading without downtime
  - Event-driven architecture with custom event emitter
  - Worker registry for distributed bot assignment

#### Channel Adapters
- **Slack Integration**
  - Slack Bolt adapter with event handling
  - Thread support for conversation context
  - Message formatting and attachments
  - Channel and DM support
- **Discord Integration**
  - Discord.js adapter with guild support
  - Thread and channel message handling
  - Embed support for rich messages
  - Role-based access control
- **CLI Adapter**
  - Interactive command-line interface for testing
  - Direct bot interaction via terminal

#### Execution Engine
- **Container-based Execution**
  - Docker container pool for isolated bot execution
  - Resource limits and cleanup
  - Secure sandbox environment
- **SSH Worker Support**
  - Remote worker execution via SSH
  - Distributed processing across multiple machines
  - Automatic connection management
- **Local Execution**
  - In-process execution for development
  - Fast iteration without container overhead

#### AI Model Support
- **Multiple Model Providers**
  - Anthropic Claude integration (claude-3-5-sonnet, claude-3-5-haiku)
  - OpenAI GPT integration (gpt-4o, gpt-4o-mini, o3-mini)
  - Model-specific configuration and fallbacks
  - Streaming response support

#### MCP (Model Context Protocol)
- **Server Management**
  - Docker-based MCP server lifecycle
  - Tool discovery and registration
  - Server health monitoring
  - Automatic restart on failure
- **Tool Integration**
  - Dynamic tool loading from MCP servers
  - Tool execution with parameter validation
  - Error handling and recovery

#### Skills System
- **Built-in Skills**
  - Tool management (add/remove/list tools)
  - Configuration management
  - Health monitoring
  - Debugging utilities
- **Custom Skill Support**
  - Skill definition via JSON/JS files
  - Parameter schemas with Zod validation
  - Async execution handlers
  - Skill discovery and registration

#### Database & Storage
- **PostgreSQL Integration**
  - Session storage with conversation history
  - Message persistence
  - Bot state management
- **Migration System**
  - SQL migration runner
  - Version tracking
  - Automatic schema updates
  - `npx ai-army migrate` CLI command

#### REST API Server
- **Bot Management API**
  - List, start, stop, and reload bots
  - Bot status and health endpoints
  - Session management
- **Message API**
  - Send messages to bots
  - Retrieve conversation history
  - Thread support
- **Admin API**
  - System health monitoring
  - Worker status
  - Configuration management

#### Webhooks
- **Webhook Management**
  - Register webhook endpoints
  - Route webhooks to appropriate bots
  - Signature verification
  - Payload validation and transformation

#### Message Queuing
- **Queue System**
  - Priority-based message queuing
  - Retry logic with exponential backoff
  - Dead letter queue for failed messages
  - Queue metrics and monitoring

#### Secrets Management
- **Environment Variable Support**
  - `${ENV_VAR}` interpolation in configs
  - Dotenv integration with expansion
  - Secret validation and required field checking
  - Automatic redaction in logs and errors

#### Monitoring & Health
- **Health Checks**
  - Bot health monitoring
  - Worker health status
  - Database connection health
  - MCP server health
- **Channel Health Monitoring**
  - Message success/failure tracking
  - Latency monitoring per channel
  - Error rate tracking
  - Automatic health status updates
- **Metrics Collection**
  - Message throughput metrics
  - Response time tracking
  - Resource usage monitoring

#### Audit & Logging
- **Audit Trail**
  - Action logging (bot operations, config changes)
  - User tracking
  - Timestamp and context capture
  - Queryable audit log
- **Structured Logging**
  - JSON-formatted logs
  - Log levels (debug, info, warn, error)
  - Context-aware logging with bot/user IDs
  - Secret redaction in logs

#### Templates
- **Message Templates**
  - Template engine for dynamic messages
  - Variable interpolation
  - Conditional content
  - Template inheritance
- **Template Manager**
  - Template loading and caching
  - Validation and error handling

#### CLI Tools
- **Command-Line Interface**
  - `npx ai-army start` - Start the bot system
  - `npx ai-army validate` - Validate configurations
  - `npx ai-army migrate` - Run database migrations
  - `npx ai-army dev` - Development mode with watch
  - `npx ai-army reload <botId>` - Reload specific bot
  - `npx ai-army instance new` - Create new project

#### Configuration
- **Configuration Validation**
  - Zod schema validation for all configs
  - Type checking and error messages
  - Environment variable validation
  - Bot configuration validation
- **Hot Reloading**
  - Watch for config file changes
  - Automatic bot reload on config update
  - Validation before applying changes

#### Testing
- **Comprehensive Test Suite**
  - Unit tests for all core modules
  - Integration tests with PostgreSQL and Docker
  - E2E tests for complete workflows
  - Test helpers and mock factories
  - >90% code coverage

#### CI/CD
- **GitHub Actions Workflows**
  - Parallel test execution (lint, unit, integration, e2e)
  - Automatic cancellation of outdated runs
  - PostgreSQL service containers for tests
  - Docker image pre-pulling for speed
  - Demo validation

#### Documentation
- **Project Documentation**
  - Comprehensive README with quick start
  - CLAUDE.md for AI-assisted development
  - CONTRIBUTING.md with code style guide
  - API documentation
  - Architecture diagrams
- **Code Documentation**
  - JSDoc comments on all public APIs
  - Inline comments for complex logic
  - Type annotations where applicable

#### Demo Project
- **Example Bot Configuration**
  - Sample assistant bot
  - Configuration examples
  - Docker Compose setup
  - Development environment

### Project Infrastructure
- ES Modules throughout (Node.js 22+)
- ESLint + Prettier for code quality
- MIT License
- npm package with CLI binary
- Docker support for containerized deployment

---

## Future Releases

See [docs/full-missing-implementation/](./docs/full-missing-implementation/) for planned features:
- Worker pool enhancements
- Advanced MCP capabilities
- Extended skills library
- Template system improvements
- Advanced queuing strategies
- Webhook routing enhancements
- Multi-channel support
- Model fallback strategies
- Enhanced secrets management
- REST API extensions
- Advanced health monitoring
- Audit log querying
- GitHub Pages documentation site
- Interactive configuration playground

[0.1.0]: https://github.com/developerz-ai/ai-army/releases/tag/v0.1.0
