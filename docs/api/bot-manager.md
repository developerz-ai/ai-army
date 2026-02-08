# BotManager API Reference

The `BotManager` class manages the complete lifecycle of bots: loading, starting, stopping, and reloading. It's the primary interface for programmatic bot control.

## Overview

BotManager is responsible for:

- Loading bot configurations and personalities
- Validating bot configurations
- Starting and stopping bots
- Managing bot Docker containers
- Tracking bot state and status
- Providing bot access to tools and MCP servers
- Hot-reloading bot configurations
- Emitting lifecycle events

## Class: BotManager

```javascript
import { BotManager } from 'ai-army';

const botManager = new BotManager(
  storage,        // PostgresStorage instance
  containerPool,  // ContainerPool instance
  soulLoader,     // SoulLoader instance
  {
    configValidator,  // ConfigValidator (optional)
    toolRegistry,     // ToolRegistry (optional)
    skillRegistry,    // SkillRegistry (optional)
    eventEmitter,     // BotEventEmitter (optional)
    workerAssigner,   // WorkerAssigner (optional)
    auditLogger       // AuditLogger (optional)
  }
);
```

### Constructor

```javascript
new BotManager(storage, containerPool, soulLoader, options)
```

#### Parameters

- **`storage`** (Object, required) - PostgresStorage instance for persistence
- **`containerPool`** (Object, required) - ContainerPool instance for Docker containers
- **`soulLoader`** (Object, required) - SoulLoader instance for loading soul.md files
- **`options`** (Object, optional) - Configuration options
  - **`configValidator`** (Object, optional) - ConfigValidator instance (created if not provided)
  - **`toolRegistry`** (Object, optional) - ToolRegistry for built-in and MCP tools
  - **`skillRegistry`** (Object, optional) - SkillRegistry for bot skills
  - **`eventEmitter`** (Object, optional) - BotEventEmitter for lifecycle events
  - **`workerAssigner`** (Object, optional) - WorkerAssigner for distributed workers
  - **`auditLogger`** (Object, optional) - AuditLogger for security events

#### Example

```javascript
import { BotManager } from 'ai-army';
import { PostgresStorage } from 'ai-army/storage';
import { ContainerPool } from 'ai-army/execution';
import { SoulLoader } from 'ai-army/utils';

const storage = new PostgresStorage({ url: process.env.DATABASE_URL });
const containerPool = new ContainerPool();
const soulLoader = new SoulLoader('./bots');

const botManager = new BotManager(storage, containerPool, soulLoader, {
  eventEmitter: myEventEmitter,
  auditLogger: myAuditLogger
});
```

## Properties

### `bots`

**Type:** `Map<string, Object>`

Internal map of bot ID to bot object. Access via `getBot()` or `getBots()` methods instead.

### `storage`

**Type:** `Object`

PostgresStorage instance used for persisting bot state.

### `containerPool`

**Type:** `Object`

ContainerPool instance for managing Docker containers.

### `soulLoader`

**Type:** `Object`

SoulLoader instance for loading personality files.

### `configValidator`

**Type:** `Object`

ConfigValidator instance for validating bot configurations.

### `toolRegistry`

**Type:** `Object | null`

ToolRegistry instance for resolving tools, or `null` if not provided.

### `skillRegistry`

**Type:** `Object | null`

SkillRegistry instance for resolving skills, or `null` if not provided.

### `eventEmitter`

**Type:** `Object | null`

BotEventEmitter instance for emitting events, or `null` if not provided.

### `auditLogger`

**Type:** `Object | null`

AuditLogger instance for recording audit events, or `null` if not provided.

## Methods

### `loadBot()`

Load a bot from its configuration directory.

```javascript
async loadBot(botPath, botConfig, defaults): Promise<Object>
```

#### Parameters

- **`botPath`** (string) - Path to bot directory (e.g., `'./bots/helper'`)
- **`botConfig`** (Object) - Bot configuration object
- **`defaults`** (Object, optional) - Default configuration to merge

#### Returns

Promise resolving to bot object:

```javascript
{
  id: string,              // Bot ID
  status: string,          // 'loaded'
  config: Object,          // Full bot configuration
  soul: string,            // Bot personality content
  container: null,         // Container (null until started)
  createdAt: Date,         // Load timestamp
  updatedAt: Date          // Last update timestamp
}
```

#### Example

```javascript
const botConfig = {
  id: 'helper',
  soul: './soul.md',
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  tools: ['bash', 'readFile']
};

const defaults = {
  model: { temperature: 0.7 },
  sandbox: { image: 'node:22-slim' }
};

const bot = await botManager.loadBot(
  './bots/helper',
  botConfig,
  defaults
);

console.log(bot.id);      // 'helper'
console.log(bot.status);  // 'loaded'
```

#### Throws

- **`BotManagerError`** - If load fails (invalid config, missing files, etc.)

### `startBot()`

Start a loaded bot.

```javascript
async startBot(botId): Promise<void>
```

#### Parameters

- **`botId`** (string) - ID of bot to start

#### Process

1. Validate bot is in 'loaded' or 'stopped' state
2. Create Docker container from bot config
3. Initialize bot workspace
4. Connect to MCP servers (if configured)
5. Update bot status to 'running'
6. Persist state to database
7. Emit 'bot:started' event

#### Example

```javascript
await botManager.startBot('helper');
console.log('Bot started!');
```

#### Throws

- **`BotManagerError`** - If bot not found, already running, or start fails

### `stopBot()`

Stop a running bot.

```javascript
async stopBot(botId, options): Promise<void>
```

#### Parameters

- **`botId`** (string) - ID of bot to stop
- **`options`** (Object, optional) - Stop options
  - **`timeout`** (number, optional) - Grace period in milliseconds (default: 30000)
  - **`force`** (boolean, optional) - Force stop if timeout exceeded (default: true)

#### Process

1. Validate bot is running
2. Send shutdown signal to container
3. Wait for graceful shutdown (up to timeout)
4. Force stop if timeout exceeded and force=true
5. Update bot status to 'stopped'
6. Persist state to database
7. Emit 'bot:stopped' event

#### Example

```javascript
// Graceful stop with 30s timeout
await botManager.stopBot('helper');

// Force immediate stop
await botManager.stopBot('helper', { timeout: 0, force: true });
```

#### Throws

- **`BotManagerError`** - If bot not found or stop fails

### `restartBot()`

Restart a bot (stop + start).

```javascript
async restartBot(botId): Promise<void>
```

#### Parameters

- **`botId`** (string) - ID of bot to restart

#### Example

```javascript
await botManager.restartBot('helper');
```

#### Throws

- **`BotManagerError`** - If bot not found or restart fails

### `reloadBot()`

Reload bot configuration without affecting other bots.

```javascript
async reloadBot(botId, botPath, botConfig, defaults): Promise<void>
```

#### Parameters

- **`botId`** (string) - ID of bot to reload
- **`botPath`** (string) - Path to bot directory
- **`botConfig`** (Object) - New bot configuration
- **`defaults`** (Object, optional) - Default configuration

#### Process

1. Validate new configuration
2. Stop bot if running
3. Load new configuration
4. Load new soul.md (if changed)
5. Start bot with new configuration
6. Emit 'bot:reloaded' event

#### Example

```javascript
const newConfig = {
  id: 'helper',
  soul: './soul.md',
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  tools: ['bash', 'readFile', 'writeFile', 'listDirectory']
};

await botManager.reloadBot(
  'helper',
  './bots/helper',
  newConfig,
  defaults
);

console.log('Bot reloaded with new tools!');
```

#### Throws

- **`BotManagerError`** - If reload fails (previous config remains active)

### `removeBot()`

Remove a bot (stop if running, then remove).

```javascript
async removeBot(botId): Promise<void>
```

#### Parameters

- **`botId`** (string) - ID of bot to remove

#### Process

1. Stop bot if running
2. Remove from internal map
3. Clean up workspace (optional)
4. Remove from database
5. Emit 'bot:removed' event

#### Example

```javascript
await botManager.removeBot('helper');
console.log('Bot removed');
```

#### Throws

- **`BotManagerError`** - If bot not found or removal fails

### `getBot()`

Get a specific bot object.

```javascript
async getBot(botId): Promise<Object>
```

#### Parameters

- **`botId`** (string) - Bot ID

#### Returns

Promise resolving to bot object:

```javascript
{
  id: string,
  status: string,          // 'loading', 'loaded', 'starting', 'running', 'stopping', 'stopped', 'error'
  config: Object,          // Bot configuration
  soul: string,            // Personality content
  container: Object,       // Docker container info (if running)
  createdAt: Date,
  updatedAt: Date,
  error: Error | null,     // Last error (if status === 'error')
  metrics: {
    messagesProcessed: number,
    totalResponseTime: number,
    averageResponseTime: number,
    errorCount: number,
    lastMessageAt: Date | null
  }
}
```

#### Example

```javascript
const bot = await botManager.getBot('helper');
console.log(`${bot.id} is ${bot.status}`);
console.log(`Processed ${bot.metrics.messagesProcessed} messages`);
```

#### Throws

- **`BotManagerError`** - If bot not found

### `getBots()`

Get all bots.

```javascript
async getBots(options): Promise<Array<Object>>
```

#### Parameters

- **`options`** (Object, optional) - Filter options
  - **`status`** (string | string[], optional) - Filter by status
  - **`provider`** (string, optional) - Filter by provider

#### Returns

Promise resolving to array of bot objects (same structure as `getBot()`).

#### Example

```javascript
// Get all bots
const allBots = await botManager.getBots();

// Get only running bots
const runningBots = await botManager.getBots({ status: 'running' });

// Get bots with specific statuses
const activeBots = await botManager.getBots({
  status: ['running', 'starting']
});

// Get Anthropic bots
const claudeBots = await botManager.getBots({ provider: 'anthropic' });
```

### `listBots()`

List bot IDs and statuses (lighter than `getBots()`).

```javascript
listBots(): Array<Object>
```

#### Returns

Array of lightweight bot info:

```javascript
[
  { id: 'helper', status: 'running' },
  { id: 'moderator', status: 'running' },
  { id: 'analyst', status: 'stopped' }
]
```

#### Example

```javascript
const bots = botManager.listBots();
console.log(`${bots.length} bots loaded`);

bots.forEach(({ id, status }) => {
  console.log(`  ${id}: ${status}`);
});
```

### `hasBots()`

Check if any bots are loaded.

```javascript
hasBots(): boolean
```

#### Returns

`true` if any bots are loaded, `false` otherwise.

#### Example

```javascript
if (!botManager.hasBots()) {
  console.log('No bots loaded');
}
```

### `getBotStatus()`

Get bot status without full object.

```javascript
getBotStatus(botId): string
```

#### Parameters

- **`botId`** (string) - Bot ID

#### Returns

Bot status string, or throws if not found.

**Possible values:**
- `'loading'` - Bot is being loaded
- `'loaded'` - Bot loaded but not started
- `'starting'` - Bot is starting
- `'running'` - Bot is operational
- `'stopping'` - Bot is shutting down
- `'stopped'` - Bot is stopped
- `'error'` - Bot encountered an error

#### Example

```javascript
const status = botManager.getBotStatus('helper');
console.log(status); // 'running'
```

#### Throws

- **`BotManagerError`** - If bot not found

### `isBotRunning()`

Check if bot is running.

```javascript
isBotRunning(botId): boolean
```

#### Parameters

- **`botId`** (string) - Bot ID

#### Returns

`true` if bot status is 'running', `false` otherwise.

#### Example

```javascript
if (botManager.isBotRunning('helper')) {
  console.log('Bot is ready to receive messages');
}
```

### `getBotMetrics()`

Get bot performance metrics.

```javascript
async getBotMetrics(botId): Promise<Object>
```

#### Parameters

- **`botId`** (string) - Bot ID

#### Returns

Promise resolving to metrics object:

```javascript
{
  messagesProcessed: number,
  totalResponseTime: number,
  averageResponseTime: number,
  errorCount: number,
  lastMessageAt: Date | null,
  uptime: number,              // Milliseconds since start
  containerStats: {
    cpu: number,               // CPU usage percentage
    memory: number,            // Memory usage in bytes
    network: {
      rx: number,              // Bytes received
      tx: number               // Bytes transmitted
    }
  }
}
```

#### Example

```javascript
const metrics = await botManager.getBotMetrics('helper');
console.log(`Processed: ${metrics.messagesProcessed}`);
console.log(`Avg response: ${metrics.averageResponseTime}ms`);
console.log(`Error rate: ${metrics.errorCount / metrics.messagesProcessed}`);
```

#### Throws

- **`BotManagerError`** - If bot not found

### `validateBotConfig()`

Validate bot configuration without loading.

```javascript
async validateBotConfig(botPath, botConfig): Promise<Object>
```

#### Parameters

- **`botPath`** (string) - Path to bot directory
- **`botConfig`** (Object) - Bot configuration to validate

#### Returns

Promise resolving to validation result:

```javascript
{
  valid: boolean,
  errors: Array<string>,      // Validation errors
  warnings: Array<string>      // Validation warnings
}
```

#### Example

```javascript
const result = await botManager.validateBotConfig('./bots/helper', config);

if (!result.valid) {
  console.error('Validation errors:');
  result.errors.forEach(err => console.error(`  - ${err}`));
}

if (result.warnings.length > 0) {
  console.warn('Warnings:');
  result.warnings.forEach(warn => console.warn(`  - ${warn}`));
}
```

## Bot Status Constants

```javascript
import { BOT_STATUSES } from 'ai-army/core/bot-manager';

console.log(BOT_STATUSES.LOADING);   // 'loading'
console.log(BOT_STATUSES.LOADED);    // 'loaded'
console.log(BOT_STATUSES.STARTING);  // 'starting'
console.log(BOT_STATUSES.RUNNING);   // 'running'
console.log(BOT_STATUSES.STOPPING);  // 'stopping'
console.log(BOT_STATUSES.STOPPED);   // 'stopped'
console.log(BOT_STATUSES.ERROR);     // 'error'
```

## Error Handling

### BotManagerError

Custom error class for bot management failures.

```javascript
class BotManagerError extends Error {
  name: 'BotManagerError'
  operation: string      // Operation that failed
  botId: string         // Bot ID (optional)
  cause: Error          // Original error (optional)
}
```

#### Example

```javascript
try {
  await botManager.startBot('helper');
} catch (error) {
  if (error.name === 'BotManagerError') {
    console.error(`Failed to ${error.operation}`);
    console.error(`Bot: ${error.botId}`);
    if (error.cause) {
      console.error('Caused by:', error.cause.message);
    }
  }
}
```

## Events

BotManager emits events via the optional `eventEmitter`:

- **`bot:loaded`** - Bot has been loaded (payload: `{ botId }`)
- **`bot:started`** - Bot has started (payload: `{ botId }`)
- **`bot:stopped`** - Bot has stopped (payload: `{ botId, reason }`)
- **`bot:error`** - Bot error occurred (payload: `{ botId, error }`)
- **`bot:reloaded`** - Bot configuration reloaded (payload: `{ botId }`)
- **`bot:removed`** - Bot has been removed (payload: `{ botId }`)

## Complete Example

```javascript
import { BotManager } from 'ai-army';
import { PostgresStorage } from 'ai-army/storage';
import { ContainerPool } from 'ai-army/execution';
import { SoulLoader } from 'ai-army/utils';
import { BotEventEmitter } from 'ai-army/core/event-emitter';

// Initialize dependencies
const storage = new PostgresStorage({ url: process.env.DATABASE_URL });
await storage.connect();

const containerPool = new ContainerPool();
const soulLoader = new SoulLoader('./bots');
const eventEmitter = new BotEventEmitter();

// Create bot manager
const botManager = new BotManager(
  storage,
  containerPool,
  soulLoader,
  { eventEmitter }
);

// Listen to events
eventEmitter.on('bot:started', ({ botId }) => {
  console.log(`✅ Bot ${botId} started`);
});

eventEmitter.on('bot:error', ({ botId, error }) => {
  console.error(`❌ Bot ${botId} error:`, error.message);
});

// Load and start a bot
try {
  const botConfig = {
    id: 'helper',
    soul: './soul.md',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    tools: ['bash', 'readFile', 'writeFile']
  };

  const defaults = {
    model: { temperature: 0.7 },
    sandbox: { image: 'node:22-slim' }
  };

  // Load bot
  const bot = await botManager.loadBot('./bots/helper', botConfig, defaults);
  console.log('Bot loaded:', bot.id);

  // Start bot
  await botManager.startBot('helper');

  // Check status
  const status = botManager.getBotStatus('helper');
  console.log('Status:', status); // 'running'

  // Get metrics after some usage
  setTimeout(async () => {
    const metrics = await botManager.getBotMetrics('helper');
    console.log('Metrics:', metrics);
  }, 60000);

  // Reload bot with new config later
  setTimeout(async () => {
    const newConfig = { ...botConfig, tools: [...botConfig.tools, 'listDirectory'] };
    await botManager.reloadBot('helper', './bots/helper', newConfig, defaults);
    console.log('Bot reloaded with additional tools');
  }, 300000);

} catch (error) {
  console.error('Failed:', error);
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Stopping all bots...');
  const bots = botManager.listBots();
  for (const { id } of bots) {
    await botManager.stopBot(id);
  }
  await storage.disconnect();
  process.exit(0);
});
```

## TypeScript Types

```typescript
interface BotConfig {
  id: string;
  soul: string;
  provider: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  tools?: string[];
  mcpServers?: string[];
  sandbox?: SandboxConfig;
  concurrency?: ConcurrencyConfig;
  systemPrompt?: string;
  metadata?: Record<string, any>;
}

interface Bot {
  id: string;
  status: BotStatus;
  config: BotConfig;
  soul: string;
  container: ContainerInfo | null;
  createdAt: Date;
  updatedAt: Date;
  error: Error | null;
  metrics: BotMetrics;
}

interface BotMetrics {
  messagesProcessed: number;
  totalResponseTime: number;
  averageResponseTime: number;
  errorCount: number;
  lastMessageAt: Date | null;
}

type BotStatus =
  | 'loading'
  | 'loaded'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'error';
```

## See Also

- [Orchestrator API](orchestrator.md) - Main orchestration engine
- [REST API Reference](rest-api.md) - HTTP endpoints for bot control
- [Configuration Guide](../getting-started/configuration.md) - Bot configuration options
- [First Bot Tutorial](../getting-started/first-bot.md) - Creating your first bot
