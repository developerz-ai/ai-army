# Coding Style

## Workflow
- **Test every module**: Each file must have corresponding `*.test.js` in the same directory
- **Run before commit**: `npm test && npm run lint` (or `npm run lint:fix` to auto-fix)
- Follow SRP - each module does one thing well
- Prefer small, focused JS files over large monolithic ones

## Code Style
- **ES Modules**: Use `import`/`export` (not CommonJS)
- **Single quotes**, semicolons required, trailing comma in ES5 contexts
- **Line width**: 100 characters max
- **Indentation**: 2 spaces (no tabs)
- **Arrow parens**: Avoid when possible (`x => x` not `(x) => x`)
- **Object shorthand**: Required (`{ name }` not `{ name: name }`)
- **Template literals**: Prefer over string concatenation
- **Destructuring**: Required for objects (`const { name } = obj`)

## Naming
- **Files**: `kebab-case.js` (e.g., `bot-manager.js`, `session-manager.js`)
- **Classes**: `PascalCase` (e.g., `TelegramAdapter`, `ContainerPool`)
- **Functions/vars**: `camelCase`
- **Unused params**: Prefix with underscore (`_unused`)

## Testing
- **Framework**: Node.js built-in test runner (`node:test`)
- **Assertions**: Use `node:assert` (strict mode)
- **File naming**: `*.test.js` alongside source files
- **Run tests**: `npm test` or `npm run test:watch`
- **Mock external services**: Slack, Discord, Docker, PostgreSQL

## Error Handling
- Bubble errors with context using `{ cause: err }` pattern
- Create custom error classes with descriptive messages
- Never log API keys or secrets

## Database
- **Always use parameterized queries**: `$1, $2` placeholders, never string interpolation
- PostgreSQL 16 for all persistence

## Security
- Validate all user input (SQL injection, command injection)
- No privileged Docker containers
- Environment variables for secrets (use `${VAR}` interpolation in configs)

## Project-Specific
- **SOLID principles**: Clean, maintainable, testable code
- **Adapter pattern**: Channels, secrets, models, storage all use same interface pattern
- **Config validation**: Fail fast with clear, actionable error messages
- **JSDoc**: Document all public APIs