# Phase 3: Bot Lifecycle

**Goal**: Complete bot management (load, start, stop, reload)
**Dependencies**: Phase 1, Phase 2
**Deliverables**: 4 files, 4 tests

---

## Files to Implement

### 1. Bot Manager
**File**: `src/core/BotManager.js`
**Test**: `test/unit/core/BotManager.test.js`

**Class**: `BotManager(storage, containerPool, soulLoader)`

**Methods**:
- `async loadBot(botId, config)` → `Bot`
  Validate config, load soul, store in Map

- `async startBot(botId)` → `void`
  Create container, load soul, set status='running'

- `async stopBot(botId)` → `void`
  Stop container, set status='stopped'

- `async reloadBot(botId, newConfig)` → `void`
  Update config, reload soul, recreate container if needed

- `getBot(botId)` → `Bot`
  Return from Map

- `listBots()` → `Array<Bot>`
  Return all bots

**Bot Object**:
```javascript
{
  id: 'support-bot',
  config: { /* full config */ },
  soulContent: 'You are a support bot...',
  container: Container,
  status: 'running',
  createdAt: Date,
  lastActiveAt: Date
}
```

**Tests**:
- ✓ `loadBot()` validates config
- ✓ `startBot()` creates container
- ✓ `stopBot()` stops gracefully
- ✓ `reloadBot()` updates without recreating container (if no sandbox change)
- ✓ `listBots()` returns all

### 2. Soul Loader
**File**: `src/utils/SoulLoader.js`
**Test**: `test/unit/utils/SoulLoader.test.js`

**Class**: `SoulLoader`

**Methods**:
- `async loadSoulFile(path)` → `string`
  Read markdown file

- `interpolateVariables(content, variables)` → `string`
  Replace {botName}, {teamName}, etc

**Tests**:
- ✓ Loads markdown files
- ✓ Throws on missing file
- ✓ Interpolates `{botName}` → actual bot name

### 3. Orchestrator (Enhanced)
**File**: `src/core/Orchestrator.js`
**Test**: `test/integration/core/Orchestrator.test.js`

**Class**: `Orchestrator(options)`

**Methods**:
- `async start()` → `void`
  Full startup sequence (see below)

- `async stop()` → `void`
  Graceful shutdown all components

- `async reload()` → `void`
  Reload config without restart

- `registerChannelAdapter(name, AdapterClass)` → `void`
  Add custom channel type

- `registerSecretAdapter(name, AdapterClass)` → `void`
  Add custom secret provider

**Startup Sequence**:
```javascript
async start() {
  1. Load config.json → ConfigLoader.load()
  2. Connect to database → storage.connect()
  3. Run migrations → MigrationRunner.run()
  4. For each bot in config:
     a. Load bot → BotManager.loadBot()
     b. Start bot → BotManager.startBot()
  5. Initialize channels → ChannelManager.initialize()
  6. Register message handlers
  7. Log: "🚀 AI Army started with X bots"
}
```

**Tests**:
- ✓ Starts with valid config
- ✓ Throws on invalid config
- ✓ All bots start successfully
- ✓ Stops all components on shutdown
- ✓ Reload updates bot configs

### 4. Migration Runner
**File**: `src/database/MigrationRunner.js`
**Test**: `test/integration/database/MigrationRunner.test.js`

**Class**: `MigrationRunner(storage: PostgresStorage)`

**Methods**:
- `async runMigrations(migrationsPath)` → `void`
  Run all pending migrations

- `async getMigrationStatus()` → `Array<{version, name, executed_at}>`
  List executed migrations

- `async runMigration(filename)` → `void`
  Run single migration in transaction

**Flow**:
```javascript
1. Read migrations/ directory
2. SELECT version FROM schema_migrations
3. Find pending (not in executed list)
4. For each pending:
   BEGIN;
   Execute SQL;
   INSERT INTO schema_migrations;
   COMMIT;
```

**Tests**:
- ✓ Runs pending migrations
- ✓ Skips already-run migrations
- ✓ Tracks in schema_migrations table
- ✓ Rolls back on error

---

## Directory Structure After Phase 3

```
src/
├── core/
│   ├── Orchestrator.js ✅ Full implementation
│   ├── BotManager.js ✅ Full implementation
│   └── SessionManager.js ✅ Full implementation
├── config/
│   ├── ConfigLoader.js ✅
│   └── ConfigValidator.js ✅
├── database/
│   └── MigrationRunner.js ✅
├── utils/
│   └── SoulLoader.js ✅
├── adapters/
│   └── storage/
│       └── PostgresStorage.js ✅
└── execution/
    ├── DockerManager.js ✅
    ├── ContainerPool.js ✅
    └── ToolExecutor.js ✅

test/
├── unit/
│   ├── config/ (2 tests)
│   ├── core/ (2 tests)
│   └── utils/ (1 test)
└── integration/
    ├── adapters/ (1 test)
    ├── execution/ (3 tests)
    ├── core/ (1 test)
    └── database/ (1 test)
```

---

## Success Criteria

- ✅ Bots load from config
- ✅ Containers created for each bot
- ✅ Souls loaded from markdown
- ✅ Orchestrator starts all bots
- ✅ Graceful shutdown works
- ✅ Hot reload updates bots without full restart
- ✅ All 4 test suites pass
