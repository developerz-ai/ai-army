# Database & Orchestration - PostgreSQL for State Management

## Overview

**PostgreSQL** is the central database for:
- **Bot registry** - All active bots and their configs
- **Instance tracking** - Template instances and their states
- **Session storage** - Conversation histories (shared across master nodes)
- **Task queue** - Async tasks and their status
- **Audit logs** - All bot actions, tool calls, errors
- **Metrics** - Usage statistics, performance data

This enables:
- **Multi-master deployments** - Multiple master servers sharing state
- **Hot reloading** - Update bot configs without losing sessions
- **Observability** - Track everything happening in the system
- **Easy deployment** - Single `docker-compose up`

## Database Schema

### Core Tables

**bots** - Bot definitions and status
```sql
CREATE TABLE bots (
  id TEXT PRIMARY KEY,
  template_id TEXT,                    -- NULL if not from template
  name TEXT NOT NULL,
  description TEXT,

  config JSONB NOT NULL,               -- Full bot configuration
  soul_content TEXT,                   -- Cached soul.md content

  status TEXT NOT NULL,                -- 'starting' | 'running' | 'stopped' | 'error'
  worker_id TEXT,                      -- Which worker is running this bot
  container_id TEXT,                   -- Docker container ID

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_active_at TIMESTAMPTZ,

  stats JSONB DEFAULT '{}'::jsonb      -- Messages processed, tool calls, etc.
);

CREATE INDEX idx_bots_status ON bots(status);
CREATE INDEX idx_bots_template ON bots(template_id);
CREATE INDEX idx_bots_worker ON bots(worker_id);
```

**templates** - Bot templates
```sql
CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,

  config JSONB NOT NULL,               -- Template configuration
  soul_template TEXT,                  -- Path to soul.md

  version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

**sessions** - Conversation histories
```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                 -- botId:channelType:channelId:userId
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,

  user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  channel_type TEXT NOT NULL,          -- 'slack' | 'discord' | 'rest'

  messages JSONB[] DEFAULT ARRAY[]::jsonb[],

  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_message_at TIMESTAMPTZ DEFAULT NOW(),

  compaction_count INTEGER DEFAULT 0,
  token_count INTEGER DEFAULT 0
);

CREATE INDEX idx_sessions_bot ON sessions(bot_id);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_last_message ON sessions(last_message_at);
```

**tasks** - Async task queue
```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES bots(id),

  task TEXT NOT NULL,                  -- The task description
  session_id TEXT,                     -- Optional session context

  status TEXT NOT NULL,                -- 'queued' | 'running' | 'completed' | 'failed'
  priority INTEGER DEFAULT 0,

  progress JSONB[] DEFAULT ARRAY[]::jsonb[],
  result JSONB,
  error TEXT,

  webhook_url TEXT,                    -- Callback when done
  timeout INTEGER,                     -- Max duration in ms

  created_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  assigned_worker TEXT
);

CREATE INDEX idx_tasks_status ON tasks(status, priority DESC, created_at);
CREATE INDEX idx_tasks_bot ON tasks(bot_id);
```

**tool_calls** - Audit log of all tool executions
```sql
CREATE TABLE tool_calls (
  id BIGSERIAL PRIMARY KEY,
  bot_id TEXT NOT NULL,
  session_id TEXT,

  tool_name TEXT NOT NULL,
  parameters JSONB,
  result JSONB,

  success BOOLEAN,
  error TEXT,
  duration_ms INTEGER,

  executed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tool_calls_bot ON tool_calls(bot_id, executed_at DESC);
CREATE INDEX idx_tool_calls_tool ON tool_calls(tool_name);
```

**workers** - Worker server registry
```sql
CREATE TABLE workers (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,                  -- 'local' | 'remote'
  host TEXT,

  status TEXT NOT NULL,                -- 'connected' | 'disconnected'
  max_containers INTEGER DEFAULT 5,
  current_containers INTEGER DEFAULT 0,

  last_heartbeat_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**mcp_servers** - Active MCP server processes
```sql
CREATE TABLE mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,

  pid INTEGER,
  config JSONB NOT NULL,

  status TEXT NOT NULL,                -- 'starting' | 'running' | 'stopped' | 'error'

  bots_using TEXT[] DEFAULT ARRAY[]::text[],

  started_at TIMESTAMPTZ,
  last_health_check TIMESTAMPTZ
);
```

## Orchestration Flow

### Bot Startup

```
1. Load config from config.json
   └─> INSERT INTO bots (id, config, status) VALUES (..., 'starting')

2. Assign to worker
   └─> SELECT * FROM workers WHERE status = 'connected'
       ORDER BY current_containers ASC LIMIT 1
   └─> UPDATE bots SET worker_id = '...' WHERE id = '...'

3. Create container on worker
   └─> Docker API call
   └─> UPDATE bots SET container_id = '...', status = 'running'

4. Initialize MCP servers
   └─> For each MCP server bot needs:
       └─> SELECT * FROM mcp_servers WHERE name = '...'
       └─> If not running: spawn process
       └─> UPDATE mcp_servers SET bots_using = array_append(bots_using, '...')

5. Connect to channel
   └─> Slack/Discord SDK initialization
   └─> UPDATE bots SET status = 'running', last_active_at = NOW()
```

### Message Handling

```
1. Message arrives from Slack/Discord
   └─> Check restrictions (query bots table for config)

2. Load or create session
   └─> SELECT * FROM sessions WHERE id = '{sessionKey}'
   └─> If not exists: INSERT INTO sessions (id, bot_id, user_id, ...)

3. Add user message
   └─> UPDATE sessions
       SET messages = messages || '{"role":"user","content":"..."}'::jsonb,
           last_message_at = NOW()

4. Call AI agent (tool loop)
   └─> For each tool call:
       └─> Execute in Docker
       └─> INSERT INTO tool_calls (bot_id, session_id, tool_name, ...)

5. Save assistant response
   └─> UPDATE sessions
       SET messages = messages || '{"role":"assistant","content":"..."}'::jsonb,
           token_count = token_count + ...

6. Check compaction threshold
   └─> If token_count > threshold:
       └─> Compact session (summarize old messages)
       └─> UPDATE sessions SET messages = ..., compaction_count = compaction_count + 1
```

### Task Queue Processing

```
1. Task submitted via REST API
   └─> INSERT INTO tasks (id, bot_id, task, status) VALUES (..., 'queued')

2. Worker picks up task
   └─> SELECT * FROM tasks WHERE status = 'queued'
       ORDER BY priority DESC, created_at
       FOR UPDATE SKIP LOCKED LIMIT 1
   └─> UPDATE tasks SET status = 'running', started_at = NOW(), assigned_worker = '...'

3. Execute task
   └─> Run agent with task prompt
   └─> UPDATE tasks SET progress = array_append(progress, '{"step":1,"message":"..."}'::jsonb)

4. Complete task
   └─> UPDATE tasks SET status = 'completed', result = '...', completed_at = NOW()
   └─> If webhook_url: POST to webhook with result
```

## Multi-Master Support

With PostgreSQL, multiple master servers can run simultaneously:

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  Master 1   │  │  Master 2   │  │  Master 3   │
│  (Slack)    │  │  (Discord)  │  │  (REST API) │
└─────────────┘  └─────────────┘  └─────────────┘
        │                │                │
        └────────────────┼────────────────┘
                         │
                    ┌────────────┐
                    │ PostgreSQL │
                    │  (Shared)  │
                    └────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
  ┌──────────┐    ┌──────────┐    ┌──────────┐
  │ Worker 1 │    │ Worker 2 │    │ Worker N │
  └──────────┘    └──────────┘    └──────────┘
```

All masters share the same:
- Bot registry
- Session storage
- Task queue
- Audit logs

## Benefits of PostgreSQL

### 1. Session Persistence

Sessions survive master server restarts:
- Master crashes → restart → sessions still in DB
- Deploy new master version → existing conversations continue
- Multiple masters can serve same conversations

### 2. Bot Registry

All bots defined in database:
- Query active bots: `SELECT * FROM bots WHERE status = 'running'`
- Find bot by channel: `SELECT * FROM bots WHERE config->>'channel' = 'slack-main'`
- Update bot config: `UPDATE bots SET config = '...' WHERE id = '...'`

### 3. Audit Trail

Every tool call logged:
- "What did the bot do?" → Query `tool_calls` table
- "Why did it fail?" → Join with sessions to see context
- Compliance and debugging

### 4. Analytics

Query usage patterns:
- Most active bots
- Tool usage frequency
- Session lengths
- Error rates
- Token consumption

### 5. Task Distribution

Multiple workers can pull from shared queue:
- `FOR UPDATE SKIP LOCKED` prevents race conditions
- Workers pull tasks concurrently
- Failed tasks can be retried by different workers

## Configuration Storage

Bot configs can live in database instead of files:

```sql
-- Load config from DB
SELECT config FROM bots WHERE id = 'work-assistant';

-- Or use hybrid: master config in file, instances in DB
```

### Dynamic Configuration

```sql
-- Add new bot instance dynamically
INSERT INTO bots (id, template_id, config, status)
VALUES (
  'support-team-mobile',
  'support-agent',
  '{
    "channel": "slack-main",
    "restrictions": {"allowedChannels": ["#mobile-support"]}
  }'::jsonb,
  'starting'
);

-- Master detects new row (via LISTEN/NOTIFY)
-- Spins up container
-- Bot goes live
```

### PostgreSQL LISTEN/NOTIFY

Masters can react to config changes in real-time:

```sql
-- Trigger on bot config changes
CREATE FUNCTION notify_bot_change() RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('bot_changes', json_build_object(
    'action', TG_OP,
    'bot_id', NEW.id
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bot_change_trigger
  AFTER INSERT OR UPDATE OR DELETE ON bots
  FOR EACH ROW EXECUTE FUNCTION notify_bot_change();
```

```javascript
// Master server listens
const client = new pg.Client(DATABASE_URL);
await client.connect();

await client.query('LISTEN bot_changes');

client.on('notification', async (msg) => {
  const change = JSON.parse(msg.payload);

  if (change.action === 'INSERT') {
    await orchestrator.startBot(change.bot_id);
  } else if (change.action === 'UPDATE') {
    await orchestrator.reloadBot(change.bot_id);
  } else if (change.action === 'DELETE') {
    await orchestrator.stopBot(change.bot_id);
  }
});
```

## Metrics & Analytics

Track everything in PostgreSQL:

```sql
-- Bot activity
SELECT
  bot_id,
  COUNT(*) as messages,
  COUNT(DISTINCT session_id) as unique_sessions,
  SUM((result->>'duration_ms')::int) as total_duration_ms
FROM tool_calls
WHERE executed_at > NOW() - INTERVAL '24 hours'
GROUP BY bot_id;

-- Most used tools
SELECT
  tool_name,
  COUNT(*) as calls,
  AVG((result->>'duration_ms')::int) as avg_duration,
  COUNT(*) FILTER (WHERE success = false) as failures
FROM tool_calls
WHERE executed_at > NOW() - INTERVAL '7 days'
GROUP BY tool_name
ORDER BY calls DESC;

-- Active sessions per bot
SELECT
  bot_id,
  COUNT(*) as active_sessions,
  AVG(array_length(messages, 1)) as avg_messages_per_session
FROM sessions
WHERE last_message_at > NOW() - INTERVAL '1 hour'
GROUP BY bot_id;

-- Worker utilization
SELECT
  w.id,
  w.current_containers,
  w.max_containers,
  ROUND(w.current_containers::numeric / w.max_containers * 100, 2) as utilization_pct
FROM workers w
WHERE status = 'connected';
```

## Migration from File-Based Config

The system supports both:

**Phase 1: File-based** (simple)
- Config in `config.json`
- Sessions in `data/{bot}/sessions/*.jsonl`
- Good for single server, few bots

**Phase 2: Database** (production)
- Config in PostgreSQL `bots` table
- Sessions in `sessions` table
- Required for multi-master, scaling

### Migration Script

```javascript
// Migrate file configs to database
import { migrateToDatabase } from './migrate.js';

const fileConfig = JSON.parse(fs.readFileSync('config.json'));

await migrateToDatabase(fileConfig, db);

// Output:
// ✓ Migrated 5 bots to database
// ✓ Imported 127 sessions
// ✓ Preserved 3,421 messages
// ✓ File config backed up to config.json.backup
```

## PostgreSQL Configuration

### Connection

```json
{
  "database": {
    "type": "postgres",
    "url": "${DATABASE_URL}",
    "pool": {
      "min": 2,
      "max": 10,
      "idleTimeoutMillis": 30000
    },
    "ssl": {
      "enabled": true,
      "rejectUnauthorized": true
    }
  }
}
```

### For SQLite (Development)

```json
{
  "database": {
    "type": "sqlite",
    "path": "./data/ai-army.db"
  }
}
```

Same schema, smaller scale. Good for laptop dev.

## Task Queue Management

### Queue Worker

```javascript
// src/queue/worker.ts
export class TaskQueueWorker {
  constructor(private db, private orchestrator) {}

  async start() {
    setInterval(() => this.processNext(), 1000);
  }

  async processNext() {
    // Get next task (with lock)
    const task = await this.db.query(`
      UPDATE tasks
      SET status = 'running',
          started_at = NOW(),
          assigned_worker = $1
      WHERE id = (
        SELECT id FROM tasks
        WHERE status = 'queued'
        ORDER BY priority DESC, created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING *
    `, [this.workerId]);

    if (task.rows.length === 0) return;

    const taskData = task.rows[0];

    try {
      // Execute task
      await this.executeTask(taskData);
    } catch (err) {
      await this.markFailed(taskData.id, err);
    }
  }

  async executeTask(task) {
    const bot = await this.orchestrator.getBot(task.bot_id);

    // Create or get session
    const sessionId = task.session_id || `task:${task.id}`;

    // Run agent
    const result = await bot.agent.run({
      messages: [{ role: 'user', content: task.task }],
      onProgress: async (step) => {
        await this.updateProgress(task.id, step);
      }
    });

    // Mark complete
    await this.db.query(`
      UPDATE tasks
      SET status = 'completed',
          result = $1,
          completed_at = NOW()
      WHERE id = $2
    `, [result, task.id]);

    // Call webhook if specified
    if (task.webhook_url) {
      await fetch(task.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task.id, result })
      });
    }
  }

  async updateProgress(taskId, step) {
    await this.db.query(`
      UPDATE tasks
      SET progress = array_append(progress, $1::jsonb)
      WHERE id = $2
    `, [JSON.stringify(step), taskId]);
  }

  async markFailed(taskId, error) {
    await this.db.query(`
      UPDATE tasks
      SET status = 'failed',
          error = $1,
          completed_at = NOW()
      WHERE id = $2
    `, [error.message, taskId]);
  }
}
```

## Observability

### Real-Time Dashboard Data

PostgreSQL enables real-time dashboards (even though we said "no UI", this is for monitoring):

```sql
-- Active bots
SELECT COUNT(*) FROM bots WHERE status = 'running';

-- Messages last hour
SELECT COUNT(*) FROM sessions WHERE last_message_at > NOW() - INTERVAL '1 hour';

-- Tasks pending
SELECT COUNT(*) FROM tasks WHERE status = 'queued';

-- Average response time
SELECT AVG(duration_ms) FROM tool_calls WHERE executed_at > NOW() - INTERVAL '1 hour';

-- Error rate
SELECT
  COUNT(*) FILTER (WHERE success = false)::float / COUNT(*) * 100 as error_rate_pct
FROM tool_calls
WHERE executed_at > NOW() - INTERVAL '1 hour';
```

### Grafana Integration

Export metrics to Prometheus or query directly:

```yaml
# grafana/datasources.yaml
datasources:
  - name: AI Army DB
    type: postgres
    url: postgres:5432
    database: ai_army
    user: readonly
```

Dashboards can show:
- Messages per minute
- Active sessions
- Tool call success rates
- Worker utilization
- Bot health status

## Benefits Summary

| Capability | File-Based | PostgreSQL |
|------------|------------|------------|
| Multi-master | No | Yes |
| Hot reload | Restart required | LISTEN/NOTIFY |
| Session sharing | No | Yes |
| Task queue | No | Yes |
| Audit logs | Limited | Full |
| Analytics | Manual | SQL queries |
| Scaling | Vertical only | Horizontal |
| Deployment | Simple | Docker Compose |

## When to Use Each

**Use file-based for:**
- Single server
- 1-5 bots
- Development/testing
- Simple deployments

**Use PostgreSQL for:**
- Multiple master servers
- 10+ bots
- Production deployments
- SaaS/multi-tenant
- Need analytics
- Need task queues
