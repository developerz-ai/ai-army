# 🏗️ Architecture Guide

## Overview

AI Assistants Army uses a **Master/Worker architecture** with PostgreSQL as the central nervous system.

```
┌─────────────────────────────────────────────────────────────┐
│                        MASTER SERVER                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Orchestrator │  │   Channel    │  │    Session       │  │
│  │              │  │   Manager    │  │    Manager       │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Bot Manager  │  │ Worker Pool  │  │   MCP Manager    │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                            ↓
                    ┌──────────────┐
                    │  PostgreSQL  │
                    └──────────────┘
                            ↓
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
   ┌─────────┐         ┌─────────┐         ┌─────────┐
   │ Worker 1│         │ Worker 2│         │ Worker N│
   │ (local) │         │(remote) │         │(remote) │
   └─────────┘         └─────────┘         └─────────┘
```

## Core Components

### 1. Orchestrator (`src/core/orchestrator.js`)

**Responsibilities:**
- Load and validate configuration
- Initialize all subsystems
- Route messages to appropriate bots
- Coordinate between components

**Key Methods:**
```javascript
async start()              // Initialize and start all systems
async stop()               // Graceful shutdown
registerChannelAdapter()   // Add custom channel
registerSecretAdapter()    // Add custom secret provider
use(middleware)           // Add custom middleware
```

### 2. Bot Manager (`src/core/bot-manager.js`)

**Responsibilities:**
- Bot lifecycle management (load, start, stop, restart)
- Bot configuration validation
- Bot registry maintenance

**Key Methods:**
```javascript
async loadBot(botId, config)    // Load bot from config
async startBot(botId)            // Start bot container
async stopBot(botId)             // Stop bot container
async restartBot(botId)          // Restart bot
getBot(botId)                    // Get bot instance
listBots()                       // List all bots
```

### 3. Session Manager (`src/core/session-manager.js`)

**Responsibilities:**
- Per-user conversation tracking
- Message history management
- Session compaction (summarization)
- Session persistence to PostgreSQL

**Session Key Format:**
```
{botId}:{channelType}:{channelId}:{userId}
Example: work-bot:slack:C123ABC:U456DEF
```

**Key Methods:**
```javascript
getSession(botId, channel, userId)    // Get or create session
appendMessage(session, role, content) // Add message to history
compact(session)                      // Summarize old messages
```

## Data Flow

### Message Processing Flow

```
1. User sends message
   ↓
2. Channel Adapter receives message
   ↓
3. Session Manager finds/creates session
   ↓
4. Bot Orchestrator routes to bot config
   ↓
5. Worker Pool selects available worker
   ↓
6. AI SDK Agent processes with tools
   ↓
7. Tools execute in Docker container
   ↓
8. Response streams back to user
```

### Session Flow

```javascript
// 1. Message arrives
const message = { text: "Hello", userId: "U123", channelId: "C456" };

// 2. Get session
const session = await sessionManager.getSession(
  botId: "work-bot",
  channel: { type: "slack", id: "C456" },
  userId: "U123"
);
// Session key: work-bot:slack:C456:U123

// 3. Append message
await sessionManager.appendMessage(session, "user", "Hello");

// 4. AI processes (adds messages to session)
const response = await agent.process(session.messages);

// 5. Append response
await sessionManager.appendMessage(session, "assistant", response);

// 6. Check if compaction needed
if (session.messages.length > 50) {
  await sessionManager.compact(session);
}
```

## Storage Architecture

### PostgreSQL Schema

```sql
-- Bot registry
CREATE TABLE bots (
  id VARCHAR(255) PRIMARY KEY,
  config JSONB NOT NULL,
  status VARCHAR(50),
  worker_id VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Sessions
CREATE TABLE sessions (
  id VARCHAR(255) PRIMARY KEY,  -- botId:channelType:channelId:userId
  bot_id VARCHAR(255) NOT NULL,
  messages JSONB DEFAULT '[]',
  metadata JSONB DEFAULT '{}',
  last_active_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Message queue
CREATE TABLE message_queue (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(255) NOT NULL,
  message JSONB NOT NULL,
  status VARCHAR(50) DEFAULT 'queued',
  priority INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

-- Tool calls log
CREATE TABLE tool_calls (
  id SERIAL PRIMARY KEY,
  bot_id VARCHAR(255) NOT NULL,
  session_id VARCHAR(255) NOT NULL,
  tool_name VARCHAR(255) NOT NULL,
  arguments JSONB,
  result JSONB,
  success BOOLEAN,
  executed_at TIMESTAMP DEFAULT NOW()
);

-- Workers
CREATE TABLE workers (
  id VARCHAR(255) PRIMARY KEY,
  type VARCHAR(50),  -- 'local' or 'remote'
  host VARCHAR(255),
  status VARCHAR(50),
  max_containers INTEGER,
  current_containers INTEGER DEFAULT 0,
  last_heartbeat TIMESTAMP DEFAULT NOW()
);
```

## Worker Architecture

### Local Worker

Runs on same machine as master:

```javascript
const worker = {
  id: 'local',
  type: 'local',
  dockerHost: 'unix:///var/run/docker.sock',
  maxContainers: 5,
  dataPath: '/data/bots'
};
```

### Remote Worker

Connects via SSH tunnel:

```javascript
const worker = {
  id: 'gpu-server',
  type: 'remote',
  host: '192.168.1.100',
  port: 22,
  user: 'deploy',
  keyPath: '~/.ssh/id_rsa',
  maxContainers: 10,
  dataPath: '/home/deploy/ai-army/data'
};
```

**SSH Tunnel Process:**
1. Master establishes SSH connection
2. Forwards local port to remote Docker socket
3. Uses `dockerode` with forwarded connection
4. All Docker commands go through tunnel

## Container Architecture

### Container Lifecycle

```
┌─────────────┐
│   Created   │  Container created but not started
└──────┬──────┘
       ↓
┌─────────────┐
│   Starting  │  Installing packages, setting up
└──────┬──────┘
       ↓
┌─────────────┐
│   Running   │  ← Container stays running between messages
└──────┬──────┘
       ↓
┌─────────────┐
│   Stopped   │  Manually stopped or unhealthy
└──────┬──────┘
       ↓
┌─────────────┐
│   Removed   │  Container deleted, must recreate
└─────────────┘
```

### Container Configuration

```javascript
const containerConfig = {
  Image: 'node:22-slim',
  name: `ai-army-${botId}`,
  Cmd: ['tail', '-f', '/dev/null'],  // Keep alive
  HostConfig: {
    Binds: [
      `${dataPath}/${botId}:/home/agent:rw`,  // Persistent workspace
      `/repos:/repos:ro`                       // Optional mounts
    ],
    Memory: 2 * 1024 * 1024 * 1024,  // 2GB
    NanoCPUs: 2 * 1e9,                // 2 CPU cores
    NetworkMode: 'bridge'              // or 'none' for isolation
  },
  WorkingDir: '/home/agent'
};
```

## Adapter Pattern

All external integrations use adapters:

### Channel Adapter Interface

```javascript
class ChannelAdapter {
  async initialize(config) {
    // Setup connection (Slack SDK, Discord.js, etc.)
  }

  async sendMessage(channelId, text) {
    // Send message to channel
  }

  async onMessage(handler) {
    // Register message handler
    // handler(message: { text, userId, channelId })
  }
}
```

### Secret Adapter Interface

```javascript
class SecretAdapter {
  async initialize(config) {
    // Setup connection to secret provider
  }

  async getSecret(key) {
    // Fetch secret by key
    return secretValue;
  }
}
```

### Storage Adapter Interface

```javascript
class StorageAdapter {
  async connect() {
    // Establish database connection
  }

  async disconnect() {
    // Close database connection
  }

  async query(sql, params) {
    // Execute query
    return { rows: [] };
  }
}
```

## Scaling Patterns

### Vertical Scaling (Single Server)

```
Day 1: Small VPS
├── Master + Worker (same process)
├── PostgreSQL (local)
└── 5-10 bot containers
```

### Horizontal Scaling (Multiple Workers)

```
Week 2: Add worker VPS
Master VPS                Worker VPS 1         Worker VPS 2
├── Master                ├── Worker           ├── Worker
├── PostgreSQL            ├── 10 containers    └── 10 containers
└── Worker (5 containers)

Total capacity: 25 containers
```

### High Availability (Multiple Masters)

```
Production:
Load Balancer
├── Master 1 (Slack)     ─┐
├── Master 2 (Discord)   ─┼─→ PostgreSQL (RDS) ←─ Workers (10x VPS)
└── Master 3 (REST)      ─┘

- Masters share nothing except PostgreSQL
- Each master handles different channels
- Workers shared across all masters
```

## Performance Considerations

### Container Reuse

**DON'T:**
```javascript
// Create new container per message (slow!)
for (const message of messages) {
  const container = await docker.createContainer();
  await container.start();
  await execTool(container, message);
  await container.stop();
  await container.remove();
}
```

**DO:**
```javascript
// Reuse container (fast!)
const container = await containerPool.getContainer(botId);
for (const message of messages) {
  await execTool(container, message);
}
```

### Session Compaction

**Problem:** Sessions grow unbounded
**Solution:** Periodic summarization

```javascript
// After 50 messages, summarize old ones
if (session.messages.length > 50) {
  const oldMessages = session.messages.slice(0, -10);
  const summary = await summarize(oldMessages);

  // Save to memory file
  await writeFile(`${botWorkspace}/memory/session-${sessionId}.md`, summary);

  // Keep only recent messages
  session.messages = session.messages.slice(-10);
}
```

### Database Pooling

```javascript
// Use connection pooling
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  min: 2,        // Minimum connections
  max: 10,       // Maximum connections
  idleTimeoutMillis: 30000
});
```

## Security Architecture

### Sandboxing

**Container Isolation:**
- No privileged mode
- Limited network access (allowlist domains)
- CPU/memory limits
- No access to host filesystem (except mounted workspace)

**Example:**
```javascript
// Restricted bot
const sandboxConfig = {
  NetworkMode: 'none',           // No network
  Memory: 512 * 1024 * 1024,     // 512MB max
  NanoCPUs: 0.5 * 1e9,           // 0.5 CPU cores
  ReadonlyRootfs: false,          // Allow workspace writes
  SecurityOpt: ['no-new-privileges']
};
```

### Secret Management

Never store secrets in:
- ❌ Code
- ❌ Config files (git)
- ❌ Environment variables (in git)

Store secrets in:
- ✅ Bitwarden/1Password
- ✅ `.env` file (gitignored)
- ✅ AWS Secrets Manager
- ✅ HashiCorp Vault

### User Restrictions

```javascript
// Bot config
{
  "restrictions": {
    "allowedUsers": ["U123", "U456"],     // Whitelist
    "deniedUsers": ["U789"],              // Blacklist
    "allowedChannels": ["C123"],          // Channel whitelist
    "deniedChannels": ["#random"]         // Channel blacklist
  }
}
```

## Monitoring & Observability

### Metrics to Track

```javascript
// Bot metrics
- Active bots count
- Messages processed per bot
- Average response time per bot
- Error rate per bot

// Queue metrics
- Queue depth per session
- Queue wait time
- Message throughput

// Worker metrics
- Worker health status
- Container count per worker
- CPU/memory usage per worker

// Container metrics
- Container health
- Container uptime
- Container restarts
```

### Health Checks

```javascript
// Every 30 seconds
setInterval(async () => {
  // Check workers
  for (const worker of workers) {
    const health = await checkWorkerHealth(worker);
    if (!health.ok) {
      await alertAndReconnect(worker);
    }
  }

  // Check containers
  for (const [botId, container] of containers) {
    const health = await container.inspect();
    if (!health.State.Running) {
      await containerPool.recycleContainer(botId);
    }
  }
}, 30000);
```

## Error Handling

### Retry Logic

```javascript
async function executeWithRetry(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      await sleep(1000 * Math.pow(2, i));  // Exponential backoff
    }
  }
}
```

### Graceful Degradation

```javascript
// If primary model fails, try fallback
const config = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  fallbacks: ['claude-haiku-4-5', 'gpt-4o']
};

async function getCompletion(messages) {
  const models = [config.model, ...config.fallbacks];

  for (const model of models) {
    try {
      return await callModel(model, messages);
    } catch (err) {
      console.error(`Model ${model} failed:`, err);
      continue;  // Try next model
    }
  }

  throw new Error('All models failed');
}
```

## Next Steps

- 📖 See [Configuration Guide](./configuration.md) for detailed config options
- 🚀 See [Deployment Guide](./deployment.md) for deployment strategies
- 💻 See [Development Guide](./development.md) for contributing
- 📚 See [API Reference](./api.md) for programmatic usage
