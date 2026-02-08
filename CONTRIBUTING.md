# Contributing to AI Army

Thank you for your interest in contributing to AI Army! This document provides guidelines and instructions for contributing to the project.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Code Style](#code-style)
- [Testing Requirements](#testing-requirements)
- [Commit Conventions](#commit-conventions)
- [Pull Request Process](#pull-request-process)
- [Project Structure](#project-structure)

## Code of Conduct

Please be respectful and professional in all interactions. We aim to create a welcoming and inclusive environment for all contributors.

## Getting Started

### Prerequisites

- Node.js ≥22.0.0
- Docker and Docker Compose (for containerized testing)
- PostgreSQL (for integration tests)

### Setup

1. Fork and clone the repository:
```bash
git clone https://github.com/YOUR_USERNAME/ai-army.git
cd ai-army
```

2. Install dependencies:
```bash
npm install
```

3. Copy environment variables:
```bash
cp .env.example .env
```

4. Run validation:
```bash
npx ai-army validate
```

5. Run tests:
```bash
npm test
```

## Development Workflow

### Local Development

Use the watch mode for rapid development:
```bash
npm run dev
```

This uses `node --watch` to automatically restart on file changes.

### Before Committing

Always run these commands before committing:

```bash
# Lint your code
npm run lint

# Run unit tests
npm run test:unit

# Run all tests (if changes affect integration)
npm test
```

### Validate Bot Configs

After changes to `bots/` or `config.json`:
```bash
npx ai-army validate
```

## Code Style

AI Army follows strict ES Module conventions with Prettier formatting enforced via ESLint.

### Module System

- **ES Modules only** (`"type": "module"` in package.json)
- Use `import`/`export` syntax
- Always include `.js` extension in relative imports
- Use named exports (not default exports)

**Example:**
```javascript
// Good
import { BotManager } from '../core/bot-manager.js';
import { ConfigValidator } from '../config/ConfigValidator.js';

// Bad
import BotManager from '../core/bot-manager'; // Missing .js, no named export
```

### Formatting Rules

Prettier enforces these rules automatically:
- Single quotes for strings
- Semicolons required
- 2-space indentation
- 100 character line width
- Trailing commas (ES5 style)
- No parentheses on single arrow function parameters

### Naming Conventions

- **Variables and functions**: `camelCase`
- **Classes**: `PascalCase`
- **Class filenames**: `PascalCase.js` (e.g., `BotReloader.js`, `ConfigValidator.js`)
- **Non-class modules**: `kebab-case.js` (e.g., `bot-manager.js`, `session-manager.js`)
- **Unused parameters**: Prefix with underscore (e.g., `_unusedParam`)

### Code Quality Rules

Follow these ESLint rules:
- Use `const` by default, `let` when reassignment is needed
- Never use `var`
- Use object shorthand notation
- Prefer arrow callbacks
- Use template literals for string concatenation
- Prefer destructuring for objects

**Example:**
```javascript
// Good
const bot = {
  name,
  status,
  process: () => message.handle(),
};

// Bad
var bot = {
  name: name,
  status: status,
  process: function() { return message.handle(); },
};
```

### Import Grouping

Group imports with node builtins first, then project imports:

```javascript
// Node.js built-ins
import { readFile } from 'fs/promises';
import { join } from 'path';

// Project imports
import { BotManager } from '../core/bot-manager.js';
import { logger } from '../utils/logger.js';
```

### JSDoc Comments

All classes, functions, and modules should have JSDoc comments:

```javascript
/**
 * Manages bot lifecycle and message routing
 * @module bot-manager
 */

/**
 * Creates a new bot instance
 * @param {Object} config - Bot configuration
 * @param {string} config.name - Bot name
 * @param {string} config.model - AI model to use
 * @returns {Promise<Bot>} Created bot instance
 */
export const createBot = async (config) => {
  // Implementation
};
```

## Testing Requirements

AI Army uses Node.js built-in test runner (`node:test`) with `node:assert/strict`.

### Test Organization

- **Unit tests**: `test/unit/` (mirror `src/` structure) or co-located as `*.test.js`
- **Integration tests**: `test/integration/`
- **E2E tests**: `test/e2e/`

### Test File Naming

Use `PascalCase.test.js` for test files:
- `BotManager.test.js`
- `ErrorHandler.test.js`
- `ConfigValidator.test.js`

### Test Structure

Use `describe`, `test`, and `beforeEach`:

```javascript
import { describe, test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { BotManager } from '../../src/core/bot-manager.js';

describe('BotManager', () => {
  let botManager;
  let mockStorage;

  beforeEach(() => {
    mockStorage = createMockStorage();
    botManager = new BotManager(mockStorage);
  });

  test('creates bot with valid config', async () => {
    const config = { name: 'test-bot', model: 'gpt-4' };
    const bot = await botManager.createBot(config);

    assert.equal(bot.name, 'test-bot');
    assert.equal(bot.model, 'gpt-4');
  });
});
```

### Mock Factories

Use factory functions for mocks:

```javascript
const createMockStorage = () => ({
  get: mock.fn(async () => null),
  set: mock.fn(async () => {}),
  delete: mock.fn(async () => {}),
});

const createMockContainerPool = () => ({
  acquire: mock.fn(async () => ({ id: 'container-123' })),
  release: mock.fn(async () => {}),
});
```

### Running Tests

```bash
# All tests (CI sequence)
npm test

# Unit tests only
npm run test:unit

# Integration tests
npm run test:integration

# E2E tests
npm run test:e2e

# Watch mode
npm run test:watch
```

### Test Coverage

Aim for high test coverage:
- Unit tests should cover all business logic
- Integration tests should cover API endpoints and database operations
- E2E tests should cover critical user workflows

## Error Handling

### Custom Error Classes

Create custom error classes extending `Error`:

```javascript
export class BotConfigError extends Error {
  constructor(message, { botId, operation, cause } = {}) {
    super(message);
    this.name = 'BotConfigError';
    this.botId = botId;
    this.operation = operation;
    this.cause = cause;
  }
}
```

### Secret Redaction

Always redact secrets from error messages and logs:

```javascript
// Good
logger.error('API key validation failed', {
  botId,
  keyPrefix: apiKey.slice(0, 8) + '...'
});

// Bad
logger.error('API key validation failed', { apiKey }); // Leaks secret!
```

### Error Context

Include contextual information in errors:
- `operation`: What operation was being performed
- `botId`: Which bot was affected
- `cause`: Original error (if wrapping)

## Commit Conventions

### Commit Message Format

```
type: Brief description (50 chars max)

- Detailed point 1
- Detailed point 2
- Why this change was needed

Co-Authored-By: Your Name <your.email@example.com>
```

### Commit Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `test`: Test additions or fixes
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `chore`: Maintenance tasks
- `ci`: CI/CD changes

### Examples

```
feat: Add webhook support for Slack events

- Implement webhook endpoint in API server
- Add signature verification
- Route events to appropriate bots

Co-Authored-By: Jane Doe <jane@example.com>
```

```
fix: Prevent memory leak in session manager

- Clear expired sessions on interval
- Add session TTL configuration
- Update tests to verify cleanup

Fixes #123

Co-Authored-By: John Smith <john@example.com>
```

## Pull Request Process

### Before Creating a PR

1. **Ensure all tests pass:**
   ```bash
   npm run lint && npm test
   ```

2. **Validate bot configs:**
   ```bash
   npx ai-army validate
   ```

3. **Update documentation** if you've changed APIs or configuration

4. **Add tests** for new features

### PR Title Format

Use the same format as commit messages:
```
feat: Add webhook support for Slack events
fix: Prevent memory leak in session manager
docs: Update API documentation
```

### PR Description Template

```markdown
## Summary
Brief description of changes

## Changes
- Change 1
- Change 2
- Change 3

## Testing
- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Manual testing completed
- [ ] All tests passing

## Documentation
- [ ] README updated (if needed)
- [ ] API docs updated (if needed)
- [ ] Comments added to complex code

## Related Issues
Fixes #123
Relates to #456
```

### Review Process

1. A maintainer will review your PR
2. Address any requested changes
3. Once approved, a maintainer will merge

### CI Checks

All PRs must pass these checks:
1. **Lint** - ESLint validation
2. **Unit Tests** - All unit tests pass
3. **Integration Tests** - Database and Docker integration tests pass
4. **E2E Tests** - End-to-end workflow tests pass
5. **Validate Demo** - Demo bot configuration is valid

The CI workflow runs these in parallel for faster feedback.

## Project Structure

```
ai-army/
├── bin/                    # CLI executables
├── bots/                   # Bot configurations
│   └── <bot-name>/
│       ├── config.json     # Bot config
│       └── soul.md         # Bot personality
├── src/
│   ├── core/              # Core orchestration
│   ├── adapters/          # Channel adapters (Slack, Discord)
│   ├── api/               # REST API server
│   ├── config/            # Configuration management
│   ├── database/          # Database layer
│   ├── execution/         # Bot execution engine
│   ├── mcp/               # Model Context Protocol
│   ├── models/            # AI model integrations
│   ├── queue/             # Message queuing
│   ├── secrets/           # Secret management
│   ├── skills/            # Bot skills/tools
│   ├── webhooks/          # Webhook handlers
│   └── worker/            # Worker management
├── test/
│   ├── unit/              # Unit tests
│   ├── integration/       # Integration tests
│   └── e2e/               # End-to-end tests
├── migrations/            # Database migrations
└── demo/                  # Demo configuration

```

### Bot Structure

Each bot lives in `bots/<name>/`:
```
bots/my-bot/
├── config.json           # Bot configuration
└── soul.md              # Personality and behavior
```

### Secrets Management

- Use `${ENV_VAR}` interpolation in configs
- Never hardcode API keys
- Store secrets in `.env` (gitignored)
- See `.env.example` for required variables

## Additional Resources

- [Project Instructions](./CLAUDE.md) - AI-specific development guidelines
- [README](./README.md) - Project overview and quick start
- [GitHub Issues](https://github.com/developerz-ai/ai-army/issues) - Bug reports and feature requests
- [Discussions](https://github.com/developerz-ai/ai-army/discussions) - Questions and community

## Questions?

If you have questions:
1. Check existing [issues](https://github.com/developerz-ai/ai-army/issues)
2. Start a [discussion](https://github.com/developerz-ai/ai-army/discussions)
3. Reach out to maintainers

Thank you for contributing to AI Army! 🎉
