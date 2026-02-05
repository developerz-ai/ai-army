# Database & Migration Libraries

**Problem Areas**:
- PostgreSQL connection pooling
- Parameterized queries (SQL injection prevention)
- Database migrations
- JSONB array handling

---

## PostgreSQL Client

### ✅ Recommended: pg (node-postgres)
**Install**: `npm install pg`

**Why**: Industry standard, built-in connection pooling, excellent performance, TypeScript support

**Connection Pooling**:
```javascript
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Pool automatically manages connections
const result = await pool.query('SELECT * FROM bots WHERE id = $1', [botId]);

// Close pool on shutdown
await pool.end();
```

**Parameterized Queries** (prevents SQL injection):
```javascript
// ✅ GOOD - Parameterized
await pool.query('SELECT * FROM sessions WHERE id = $1', [sessionId]);

// ❌ BAD - String interpolation (SQL injection risk)
await pool.query(`SELECT * FROM sessions WHERE id = '${sessionId}'`);
```

**Transaction Support**:
```javascript
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('INSERT INTO bots (id, config) VALUES ($1, $2)', [id, config]);
  await client.query('INSERT INTO sessions (id, bot_id) VALUES ($1, $2)', [sessId, id]);
  await client.query('COMMIT');
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
} finally {
  client.release();
}
```

**Alternatives**:
- **postgres.js** ([GitHub](https://github.com/porsager/postgres)) - Modern alternative, slightly different API, similar performance

**Sources**:
- [node-postgres Documentation](https://node-postgres.com/)
- [Pooling – node-postgres](https://node-postgres.com/features/pooling)
- [How to Implement Connection Pooling in Node.js - OneUptime](https://oneuptime.com/blog/post/2026-01-06-nodejs-connection-pooling-postgresql-mysql/view)

---

## PostgreSQL 18 JSONB Features

### JSONB Arrays for Message Storage

PostgreSQL 18 has excellent JSONB support for storing arrays of messages:

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  messages JSONB[] DEFAULT ARRAY[]::jsonb[],
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert with JSONB array
INSERT INTO sessions (id, messages) VALUES (
  'bot:slack:C123:U456',
  ARRAY[
    '{"role": "user", "content": "Hello"}'::jsonb,
    '{"role": "assistant", "content": "Hi!"}'::jsonb
  ]
);

-- Append to array
UPDATE sessions
SET messages = messages || '{"role": "user", "content": "How are you?"}'::jsonb
WHERE id = 'bot:slack:C123:U456';

-- Query array elements
SELECT jsonb_array_elements(messages) FROM sessions WHERE id = 'bot:slack:C123:U456';
```

**Node.js Usage**:
```javascript
// node-postgres automatically converts JSONB to/from JavaScript
const result = await pool.query('SELECT messages FROM sessions WHERE id = $1', [sessionId]);
const messages = result.rows[0].messages; // Already parsed as array

// Insert with JSONB
await pool.query(
  'INSERT INTO sessions (id, messages) VALUES ($1, $2)',
  [sessionId, JSON.stringify([{ role: 'user', content: 'hi' }])]
);

// Append message
await pool.query(
  'UPDATE sessions SET messages = messages || $1::jsonb WHERE id = $2',
  [JSON.stringify({ role: 'user', content: 'hello' }), sessionId]
);
```

**Sources**:
- [PostgreSQL: Documentation: 18: JSON Types](https://www.postgresql.org/docs/current/datatype-json.html)
- [PostgreSQL: Documentation: 18: JSON Functions and Operators](https://www.postgresql.org/docs/current/functions-json.html)
- [Using Node.js and PostgreSQL's JsonB Column - Medium](https://medium.com/@moiserushanika2006/using-node-js-and-postgresqls-jsonb-column-advantages-for-building-efficient-web-applications-5e26e9902d93)

---

## Database Migrations

### ✅ Recommended: node-pg-migrate
**Install**: `npm install node-pg-migrate`

**Why**: PostgreSQL-specific, supports SQL and JS migrations, simple CLI, excellent for our use case

**Setup**:
```javascript
// migrations/001_initial_schema.sql
CREATE TABLE bots (
  id TEXT PRIMARY KEY,
  config JSONB NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES bots(id),
  messages JSONB[] DEFAULT ARRAY[]::jsonb[],
  token_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_bot ON sessions(bot_id);
```

**Migration Runner**:
```javascript
// src/database/MigrationRunner.js
import fs from 'fs/promises';
import path from 'path';

export class MigrationRunner {
  constructor(pool) {
    this.pool = pool;
  }

  async runMigrations(migrationsPath) {
    // Ensure migrations table exists
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        executed_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Get executed migrations
    const { rows } = await this.pool.query('SELECT version FROM schema_migrations');
    const executed = new Set(rows.map(r => r.version));

    // Read migration files
    const files = await fs.readdir(migrationsPath);
    const sqlFiles = files.filter(f => f.endsWith('.sql')).sort();

    for (const file of sqlFiles) {
      const version = parseInt(file.split('_')[0]);

      if (executed.has(version)) {
        continue; // Already executed
      }

      const sql = await fs.readFile(path.join(migrationsPath, file), 'utf8');

      // Run in transaction
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
          [version, file]
        );
        await client.query('COMMIT');
        console.log(`✅ Ran migration: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${err.message}`);
      } finally {
        client.release();
      }
    }
  }
}
```

**Alternatives**:
- **db-migrate** - Multi-database support (but more complex for PostgreSQL-only projects)
- **umzug** - Flexible but requires more setup
- **postgres-migrations** - Minimal, but less features

**Sources**:
- [GitHub - node-pg-migrate](https://github.com/salsita/node-pg-migrate)
- [Migrations with Node.js and PostgreSQL - MaibornWolff](https://www.maibornwolff.de/en/know-how/migrations-nodejs-and-postgresql/)
- [Database migrations with Node.js - Synvinkel](https://synvinkel.org/notes/node-postgres-migrations)

---

## PostgresStorage Adapter Implementation

```javascript
// src/adapters/storage/PostgresStorage.js
import pg from 'pg';
const { Pool } = pg;

export class PostgresStorage {
  constructor(connectionString) {
    this.pool = new Pool({
      connectionString,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }

  async connect() {
    // Test connection
    await this.pool.query('SELECT NOW()');
  }

  async disconnect() {
    await this.pool.end();
  }

  async query(sql, params = []) {
    return await this.pool.query(sql, params);
  }

  // Bot management
  async saveBotConfig(botId, config) {
    await this.query(
      `INSERT INTO bots (id, config, status)
       VALUES ($1, $2, 'stopped')
       ON CONFLICT (id) DO UPDATE SET config = $2`,
      [botId, JSON.stringify(config)]
    );
  }

  async getBotConfig(botId) {
    const { rows } = await this.query('SELECT * FROM bots WHERE id = $1', [botId]);
    return rows[0] || null;
  }

  // Session management
  async saveSession(session) {
    await this.query(
      `INSERT INTO sessions (id, bot_id, user_id, channel_id, channel_type, messages, token_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         messages = $6,
         token_count = $7,
         last_message_at = NOW()`,
      [
        session.id,
        session.bot_id,
        session.user_id,
        session.channel_id,
        session.channel_type,
        JSON.stringify(session.messages),
        session.token_count
      ]
    );
  }

  async getSession(sessionId) {
    const { rows } = await this.query(
      'SELECT * FROM sessions WHERE id = $1',
      [sessionId]
    );
    return rows[0] || null;
  }

  // Append message to session (efficient JSONB array append)
  async appendMessage(sessionId, message) {
    await this.query(
      `UPDATE sessions
       SET messages = messages || $1::jsonb,
           last_message_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(message), sessionId]
    );
  }
}
```

---

## Testing Strategy

```javascript
// test/integration/adapters/PostgresStorage.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { PostgresStorage } from '../../../src/adapters/storage/PostgresStorage.js';

let storage;

before(async () => {
  storage = new PostgresStorage('postgresql://test:test@localhost:5432/ai_army_test');
  await storage.connect();
  await storage.query('TRUNCATE bots, sessions CASCADE');
});

after(async () => {
  await storage.disconnect();
});

test('saves and retrieves bot config', async () => {
  const config = { id: 'test-bot', model: 'claude-sonnet-4-5' };

  await storage.saveBotConfig('test-bot', config);
  const retrieved = await storage.getBotConfig('test-bot');

  assert.deepStrictEqual(retrieved.config, config);
});

test('appends messages to session', async () => {
  await storage.saveSession({
    id: 'sess-1',
    bot_id: 'test-bot',
    user_id: 'U123',
    channel_id: 'C456',
    channel_type: 'slack',
    messages: [],
    token_count: 0
  });

  await storage.appendMessage('sess-1', { role: 'user', content: 'hi' });
  await storage.appendMessage('sess-1', { role: 'assistant', content: 'hello' });

  const session = await storage.getSession('sess-1');
  assert.strictEqual(session.messages.length, 2);
});
```

---

## Summary

| Need | Library | Why |
|------|---------|-----|
| PostgreSQL client | pg (node-postgres) | Standard, pooling built-in, excellent performance |
| Migrations | node-pg-migrate | PostgreSQL-specific, simple, SQL support |
| JSONB arrays | Native PostgreSQL 18 | Built-in, optimized, no library needed |

**Total Dependencies**: 1 (pg) - migrations use custom runner
