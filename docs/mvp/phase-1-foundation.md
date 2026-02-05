# Phase 1: Foundation

**Goal**: Configuration loading, PostgreSQL 18 connection, validation
**Dependencies**: None
**Deliverables**: 5 files, 5 tests

---

## 📚 Library References

**Before implementing, review these helper files** for library recommendations:

- **[Configuration & Environment](./helpers/01-configuration-libraries.md)** - dotenv, deepmerge, env var interpolation
- **[Database & Migrations](./helpers/02-database-libraries.md)** - pg (node-postgres), PostgreSQL 18, JSONB arrays
- **[Validation & Schema](./helpers/04-validation-schema.md)** - Zod for config validation
- **[Testing Frameworks](./helpers/07-testing-frameworks.md)** - Native node:test for all tests

**Key Libraries for Phase 1**:
- `dotenv` + `dotenv-expand` - Load .env files with variable expansion
- `deepmerge` - Deep merge bot configs with defaults
- `pg` - PostgreSQL client with connection pooling
- `zod` - Schema validation (used in ConfigValidator)
- `node:test` - Built-in test runner (no dependencies)

---

## Files to Implement

### 1. Database Schema
**File**: `migrations/001_initial_schema.sql`

**Tables**:
```sql
CREATE TABLE bots (
  id TEXT PRIMARY KEY,
  config JSONB NOT NULL,
  soul_content TEXT,
  status TEXT NOT NULL,  -- 'starting' | 'running' | 'stopped' | 'error'
  worker_id TEXT,
  container_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_active_at TIMESTAMPTZ
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,  -- Format: botId:channelType:channelId:userId
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  channel_type TEXT NOT NULL,
  messages JSONB[] DEFAULT ARRAY[]::jsonb[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  token_count INTEGER DEFAULT 0
);

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  executed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bots_status ON bots(status);
CREATE INDEX idx_sessions_bot ON sessions(bot_id);
CREATE INDEX idx_sessions_last_message ON sessions(last_message_at);
```

### 2. Config Loader
**File**: `src/config/ConfigLoader.js`
**Test**: `test/unit/config/ConfigLoader.test.js`

**Class**: `ConfigLoader`

**Methods**:
- `async load(configPath: string)` → `Object`
  Load config.json, validate, interpolate env vars

- `interpolateEnvVars(obj: Object)` → `Object`
  Replace `${VAR}`, `${VAR:-default}`, `${VAR:+value}` patterns

- `validate(config: Object)` → `void`
  Throws `ConfigValidationError` if invalid

- `deepMerge(defaults: Object, overrides: Object)` → `Object`
  Deep merge configurations

**Tests**:
- ✓ Loads valid JSON
- ✓ Throws on missing file
- ✓ Interpolates `${ANTHROPIC_API_KEY}` → process.env.ANTHROPIC_API_KEY
- ✓ Handles `${PORT:-3000}` → 3000 if PORT unset
- ✓ Deep merges nested objects

### 3. Config Validator
**File**: `src/config/ConfigValidator.js`
**Test**: `test/unit/config/ConfigValidator.test.js`

**Class**: `ConfigValidator`

**Methods**:
- `validateMainConfig(config: Object)` → `Array<Error>`
  Check providers, channels, defaults

- `validateBotConfig(botConfig: Object)` → `Array<Error>`
  Check required fields: id, soul, provider, model

- `checkRequiredFields(config: Object, fields: Array<string>)` → `Array<Error>`
  Generic field checker

- `generateReport(errors: Array<Error>)` → `string`
  Human-readable error report

**Tests**:
- ✓ Valid config passes
- ✓ Missing soul field detected
- ✓ Missing provider detected
- ✓ Generates helpful error messages

### 4. PostgreSQL Storage
**File**: `src/adapters/storage/PostgresStorage.js`
**Test**: `test/integration/adapters/PostgresStorage.test.js`

**Class**: `PostgresStorage`

**Methods**:
- `async connect()` → `void`
  Create connection pool

- `async disconnect()` → `void`
  Close pool

- `async query(sql: string, params: Array)` → `{rows: Array}`
  Parameterized query (prevent SQL injection)

- `async saveBotConfig(botId: string, config: Object)` → `void`
  INSERT or UPDATE bots table

- `async getBotConfig(botId: string)` → `Object`
  SELECT from bots table

- `async saveSession(session: Object)` → `void`
  INSERT or UPDATE sessions table

- `async getSession(sessionId: string)` → `Object`
  SELECT from sessions table

**Tests** (requires PostgreSQL 18 running):
- ✓ Connects to database
- ✓ Connection pooling works
- ✓ Saves bot config
- ✓ Retrieves bot config
- ✓ Saves session with messages array
- ✓ Handles connection errors

### 5. Session Manager
**File**: `src/core/SessionManager.js`
**Test**: `test/unit/core/SessionManager.test.js`

**Class**: `SessionManager(storage: PostgresStorage)`

**Methods**:
- `getSessionKey(botId, channel, userId)` → `string`
  Format: `botId:channelType:channelId:userId`

- `async getSession(botId, channel, userId)` → `Session`
  Load from storage or create new

- `async appendMessage(session, role, content)` → `void`
  Add message to session.messages array

- `async compact(session)` → `void`
  Summarize old messages when token_count > threshold

**Tests**:
- ✓ Generates session key: `work:slack:C123:U456`
- ✓ Creates new session
- ✓ Appends message to array
- ✓ Compacts when > 50000 tokens
- ✓ Saves to storage after each operation

---

## Test Setup

**Require PostgreSQL 18 running**:
```bash
docker run -d --name ai-army-test-db \
  -e POSTGRES_DB=ai_army_test \
  -e POSTGRES_USER=test \
  -e POSTGRES_PASSWORD=test \
  -p 5432:5432 \
  postgres:18-alpine
```

**Test helpers** in `test/helpers/setup.js`:
```javascript
export async function setupTestDatabase() {
  const db = new PostgresStorage('postgresql://test:test@localhost:5432/ai_army_test');
  await db.connect();
  await db.query(fs.readFileSync('./migrations/001_initial_schema.sql', 'utf8'));
  return db;
}

export async function cleanupTestDatabase(db) {
  await db.query('TRUNCATE bots, sessions CASCADE');
  await db.disconnect();
}
```

---

## Validation

**Command**: `npx ai-army validate`

Should check:
- ✅ config.json exists and is valid JSON
- ✅ All ${ENV_VARS} are set
- ✅ All bot soul.md files exist
- ✅ Database connection works
- ✅ No duplicate bot IDs

**Output**:
```
✅ config.json is valid
✅ All environment variables set
✅ bots/support/config.json is valid
✅ bots/support/soul.md exists
✅ Database connection OK

✅ Configuration valid - ready to start
```

---

## Success Criteria

- ✅ `ConfigLoader` loads config with env interpolation
- ✅ `PostgresStorage` connects to PostgreSQL 18
- ✅ `SessionManager` generates correct session keys
- ✅ All 5 test files pass
- ✅ `npx ai-army validate` works
- ✅ Database migration runs successfully
