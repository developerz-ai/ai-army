# Phase 7: CLI Tools

**Goal**: Developer commands for project management
**Dependencies**: All previous phases
**Deliverables**: 3 files, 3 tests

---

## Files to Implement

### 1. CLI Implementation
**File**: `bin/cli.js`
**Test**: `test/integration/cli/commands.test.js`

**Commands**:

```javascript
#!/usr/bin/env node

const commands = {
  init: 'Initialize new AI Army project',
  validate: 'Validate configuration',
  migrate: 'Run database migrations',
  dev: 'Start with hot reload',
  start: 'Start in production mode',
  status: 'Show system status',
  reload: 'Validate and reload config'
};
```

**Implementation**:
```javascript
switch (command) {
  case 'init':
    await ProjectInitializer.initialize(process.cwd(), template);
    break;

  case 'validate':
    const errors = await ConfigValidator.validateAll('./config.json');
    if (errors.length === 0) {
      console.log('✅ All configurations valid');
    } else {
      console.error('❌ Validation errors:');
      errors.forEach(e => console.error(`  - ${e}`));
      process.exit(1);
    }
    break;

  case 'migrate':
    await MigrationRunner.runMigrations(storage, './migrations');
    break;

  case 'start':
    const orchestrator = new Orchestrator({ configPath: './config.json' });
    await orchestrator.start();
    break;
}
```

**Tests**:
- ✓ `init` creates project structure
- ✓ `validate` catches config errors
- ✓ `migrate` runs SQL files
- ✓ `status` shows bot states

### 2. Project Initializer
**File**: `src/cli/ProjectInitializer.js`
**Test**: `test/unit/cli/ProjectInitializer.test.js`

**Class**: `ProjectInitializer`

**Static Methods**:
- `async initialize(targetPath, template='basic')` → `void`
  Create project from template

- `createDirectoryStructure(basePath)` → `void`
  Create bots/, data/, migrations/, skills/

- `async writeTemplateFiles(basePath, template)` → `void`
  Copy from templates/{template}/

- `generateEnvExample(basePath)` → `void`
  Create .env.example with required vars

- `async writeHelperFiles(basePath)` → `void`
  Create CLAUDE.md and AGENT.md for AI agent users

**Created Structure**:
```
my-ai-army/
├── package.json
├── .env.example
├── .gitignore
├── config.json
├── docker-compose.yml
├── CLAUDE.md           # Claude Code instructions
├── AGENT.md            # Generic AI agent instructions
├── bots/
│   └── assistant/
│       ├── config.json
│       └── soul.md
├── migrations/
├── data/
└── README.md
```

**CLAUDE.md template**:
```markdown
# AI Army Project

Use Claude Code to build and deploy your bot army.

## Quick Start
\`\`\`bash
npm install
npx ai-army validate
docker-compose up -d
\`\`\`

## Create New Bot
Ask Claude: "Create a new bot called 'my-bot' that helps with..."

Claude will:
1. Create bots/my-bot/ directory
2. Write config.json
3. Write soul.md personality
4. Update config.json to include it
5. Validate and reload

## Common Tasks
- "Add a new tool to support-bot"
- "Update the personality of work-bot"
- "Fix the error in bot-manager"
- "Add tests for SessionManager"
```

**AGENT.md template**:
```markdown
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
- Sessions stored in PostgreSQL 18

## Testing
npm run test:unit      # Fast unit tests
npm run test:integration  # With Docker/DB
npm test               # All tests
```

**Tests**:
- ✓ Creates directory structure
- ✓ Copies template files
- ✓ Generates .env.example
- ✓ Creates CLAUDE.md and AGENT.md
- ✓ package.json has ai-army dependency

### 3. Status Command
**File**: `src/cli/StatusCommand.js`
**Test**: `test/integration/cli/status.test.js`

**Function**: `async showStatus(storage)` → `void`

**Shows**:
```
🤖 AI Army Status

Bots:
  ✅ support-bot (running) - 3 active sessions
  ✅ work-bot (running) - 1 active session
  ⏸️  devops-bot (stopped)

Database:
  ✅ Connected to PostgreSQL 18
  📊 127 total sessions
  📝 1,234 messages processed

Workers:
  ✅ local (5/10 containers)

Channels:
  ✅ slack-main (connected)
  ✅ discord-main (connected)
```

**Tests**:
- ✓ Shows running bots
- ✓ Shows session counts
- ✓ Shows database status
- ✓ Handles disconnected state

---

## CLI Usage Examples

```bash
# Initialize new project
npx ai-army init my-bot-army

# Validate configs
npx ai-army validate
# Output: ✅ All configurations valid

# Run migrations
npx ai-army migrate
# Output: ✅ Ran 1 migration: 001_initial_schema

# Start in dev mode (with hot reload)
npx ai-army dev

# Check status
npx ai-army status

# Reload without restart
npx ai-army reload
# Output: ✅ Configuration reloaded (3 bots updated)
```

---

## Success Criteria

- ✅ `npx ai-army init` creates working project
- ✅ Generated project has CLAUDE.md + AGENT.md
- ✅ `npx ai-army validate` catches errors
- ✅ `npx ai-army migrate` runs SQL
- ✅ `npx ai-army status` shows system state
- ✅ All 3 test suites pass
