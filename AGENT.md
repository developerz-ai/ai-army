# Building Your AI Army

This project uses the ai-army framework. Each bot is independent with its own:
- Personality (soul.md)
- Workspace (persistent directory)
- Tools (bash, files, web search)
- Channel (Slack, Discord, REST)

## Architecture

- src/core/ - Orchestration
- src/adapters/ - Channels, secrets, storage
- src/execution/ - Docker management
- bots/*/ - Your bot definitions

## Conventions

- One bot = one directory in bots/
- Each bot has config.json + soul.md
- All configs use ${ENV_VAR} for secrets
- Sessions stored in PostgreSQL

## Testing

```bash
npm run test:unit        # Fast unit tests
npm run test:integration # With Docker/DB
npm test                 # All tests
```
