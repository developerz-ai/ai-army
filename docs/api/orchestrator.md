# Orchestrator API Reference

The `Orchestrator` class is the main orchestration engine for AI Army. It coordinates the startup, shutdown, and configuration management of the entire system.

## Overview

The Orchestrator is responsible for:

- Loading and validating configuration
- Initializing database connections and running migrations
- Creating and managing component dependencies
- Loading and starting all configured bots
- Initializing channel adapters (Slack, Discord, REST API)
- Managing message routing and processing
- Providing graceful shutdown
- Supporting hot reload of configuration

## Class: Orchestrator

```javascript
import { Orchestrator } from 'ai-army';

const orchestrator = new Orchestrator({
  configPath: './config.json',
  botsPath: './bots',
  dataPath: './data'
});

await orchestrator.start();
```

### Constructor

```javascript
new Orchestrator(options)
```

#### Parameters

- **`options`** (Object, optional) - Configuration options
  - **`configPath`** (string, optional) - Path to main config file (default: `'./config.json'`)
  - **`botsPath`** (string, optional) - Path to bots directory (default: `'./bots'`)
  - **`dataPath`** (string, optional) - Path to bot data/workspace directory (default: `'./data'`)
  - **`migrationsPath`** (string, optional) - Path to migrations directory (default: `'./migrations'`)
  - **`logger`** (Object, optional) - Custom logger (default: console)

#### Example

```javascript
const orchestrator = new Orchestrator({
  configPath: './config/production.json',
  botsPath: './bots',
  dataPath: '/var/lib/ai-army/data',
  migrationsPath: './db/migrations'
});
```

## Properties

### `state`

**Type:** `string`

Current orchestrator state. One of:
- `'created'` - Orchestrator instance created but not started
- `'starting'` - Start sequence in progress
- `'running'` - Fully operational
- `'stopping'` - Shutdown in progress
- `'stopped'` - Clean shutdown completed
- `'error'` - Error state (see `error` property)

```javascript
console.log(orchestrator.state); // 'running'
```

### `config`

**Type:** `Object | null`

Loaded configuration object. `null` if not yet loaded.

```javascript
console.log(orchestrator.config.defaults.model);
// { provider: 'anthropic', model: 'claude-sonnet-4-5' }
```

### `botManager`

**Type:** `BotManager | null`

Bot manager instance for controlling bot lifecycle. `null` if not yet initialized.

```javascript
const bot = await orchestrator.botManager.getBot('helper');
console.log(bot.status); // 'running'
```

### `sessionManager`

**Type:** `SessionManager | null`

Session manager instance for managing conversation sessions. `null` if not yet initialized.

```javascript
const session = await orchestrator.sessionManager.getSession('user-123');
console.log(session.messages.length);
```

### `channelManager`

**Type:** `ChannelManager | null`

Channel manager instance for managing communication channels (Slack, Discord, etc.). `null` if not yet initialized.

```javascript
const channels = orchestrator.channelManager.listChannels();
console.log(channels); // ['slack', 'discord', 'rest']
```

### `apiServer`

**Type:** `APIServer | null`

API server instance. `null` if not yet initialized or if API is disabled.

```javascript
console.log(orchestrator.apiServer.port); // 3000
```

### `messageQueue`

**Type:** `MessageQueue | null`

Message queue instance for async message processing. `null` if not yet initialized.

```javascript
const queueSize = orchestrator.messageQueue.size();
console.log(queueSize); // 5
```

### `mcpManager`

**Type:** `MCPManager | null`

MCP (Model Context Protocol) manager for managing MCP servers and tools. `null` if not yet initialized.

```javascript
const mcpTools = orchestrator.mcpManager.getTools('filesystem');
console.log(mcpTools.length); // 3
```

### `healthMonitor`

**Type:** `HealthMonitor | null`

Health monitor instance for tracking system health. `null` if not yet initialized.

```javascript
const health = await orchestrator.healthMonitor.check();
console.log(health.status); // 'healthy'
```

### `metricsCollector`

**Type:** `MetricsCollector | null`

Metrics collector instance. `null` if not yet initialized or if metrics are disabled.

```javascript
const metrics = orchestrator.metricsCollector.getMetrics();
console.log(metrics.messagesProcessed); // 1523
```

### `auditLogger`

**Type:** `AuditLogger | null`

Audit logger instance for recording security events. `null` if not yet initialized.

```javascript
await orchestrator.auditLogger.log({
  action: 'bot.started',
  botId: 'helper',
  userId: 'admin'
});
```

### `error`

**Type:** `Error | null`

Last error that occurred, if `state` is `'error'`. Otherwise `null`.

```javascript
if (orchestrator.state === 'error') {
  console.error(orchestrator.error.message);
}
```

## Methods

### `start()`

Start the orchestrator and all subsystems.

```javascript
async start(): Promise<void>
```

#### Process

1. Load and validate configuration
2. Initialize database and run migrations
3. Initialize secrets manager
4. Initialize MCP servers
5. Initialize message queue and workers
6. Initialize bot manager and load bots
7. Initialize channel adapters
8. Initialize API server
9. Initialize monitoring and webhooks
10. Transition to `'running'` state

#### Example

```javascript
try {
  await orchestrator.start();
  console.log('AI Army is running!');
} catch (error) {
  console.error('Failed to start:', error);
}
```

#### Throws

- **`OrchestratorError`** - If startup fails at any stage

### `stop()`

Gracefully shut down the orchestrator and all subsystems.

```javascript
async stop(): Promise<void>
```

#### Process

1. Stop accepting new messages
2. Stop webhooks and workers
3. Stop monitoring
4. Stop API server
5. Stop all channels
6. Stop all bots
7. Stop MCP servers
8. Close database connections
9. Transition to `'stopped'` state

#### Example

```javascript
await orchestrator.stop();
console.log('AI Army stopped cleanly');
```

### `reload()`

Hot reload configuration without full restart.

```javascript
async reload(): Promise<void>
```

#### What Gets Reloaded

- ✅ Bot configurations
- ✅ Bot personalities (soul.md)
- ✅ Provider settings
- ✅ Channel configurations
- ✅ MCP server configurations
- ❌ Database settings (requires full restart)
- ❌ API server settings (requires full restart)

#### Process

1. Load new configuration
2. Validate configuration
3. Compare with current configuration
4. Stop affected bots
5. Reload changed configurations
6. Restart affected bots
7. Update channels as needed

#### Example

```javascript
try {
  await orchestrator.reload();
  console.log('Configuration reloaded');
} catch (error) {
  console.error('Reload failed:', error);
  // System continues with previous config
}
```

#### Throws

- **`OrchestratorError`** - If reload fails (previous config remains active)

### `sendMessage()`

Send a message to a bot and get a response.

```javascript
async sendMessage(botId, message, options): Promise<Object>
```

#### Parameters

- **`botId`** (string) - ID of the bot to send message to
- **`message`** (string) - Message content
- **`options`** (Object, optional) - Message options
  - **`sessionId`** (string, optional) - Session ID (creates new if not provided)
  - **`channel`** (string, optional) - Channel name (default: 'rest')
  - **`userId`** (string, optional) - User ID for tracking
  - **`metadata`** (Object, optional) - Additional metadata

#### Returns

Promise resolving to response object:

```javascript
{
  botId: string,
  sessionId: string,
  response: string,
  timestamp: string,
  metadata: Object
}
```

#### Example

```javascript
const response = await orchestrator.sendMessage(
  'helper',
  'Create a Node.js HTTP server',
  {
    sessionId: 'user-123',
    userId: 'john@example.com',
    metadata: { source: 'web' }
  }
);

console.log(response.response);
// "I'll create a simple HTTP server for you..."
```

#### Throws

- **`OrchestratorError`** - If bot not found or message fails

### `getStatus()`

Get current system status.

```javascript
async getStatus(): Promise<Object>
```

#### Returns

Promise resolving to status object:

```javascript
{
  state: string,               // Orchestrator state
  uptime: number,              // Uptime in milliseconds
  bots: {
    total: number,
    running: number,
    stopped: number,
    error: number,
    list: Array<{
      id: string,
      status: string,
      uptime: number
    }>
  },
  channels: {
    total: number,
    active: number,
    list: Array<string>
  },
  queue: {
    size: number,
    processing: number
  },
  health: {
    status: string,            // 'healthy', 'degraded', 'unhealthy'
    checks: Object
  },
  metrics: Object              // If metrics enabled
}
```

#### Example

```javascript
const status = await orchestrator.getStatus();
console.log(`System: ${status.state}`);
console.log(`Bots: ${status.bots.running}/${status.bots.total} running`);
console.log(`Queue: ${status.queue.size} pending`);
console.log(`Health: ${status.health.status}`);
```

### `getBot()`

Get a specific bot instance.

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
  status: string,
  config: Object,
  soul: string,
  container: Object,
  uptime: number,
  metrics: Object
}
```

#### Example

```javascript
const bot = await orchestrator.getBot('helper');
console.log(bot.status);        // 'running'
console.log(bot.uptime);        // 123456
console.log(bot.config.model);  // 'claude-sonnet-4-5'
```

#### Throws

- **`OrchestratorError`** - If bot not found

### `getBots()`

Get all bots.

```javascript
async getBots(): Promise<Array<Object>>
```

#### Returns

Promise resolving to array of bot objects (same structure as `getBot()`).

#### Example

```javascript
const bots = await orchestrator.getBots();
bots.forEach(bot => {
  console.log(`${bot.id}: ${bot.status}`);
});
```

### `on()`

Register event listener.

```javascript
on(event, handler): void
```

#### Parameters

- **`event`** (string) - Event name
- **`handler`** (Function) - Event handler function

#### Available Events

- **`started`** - Orchestrator has fully started
- **`stopped`** - Orchestrator has stopped
- **`error`** - Error occurred
- **`bot:started`** - Bot has started (payload: `{ botId }`)
- **`bot:stopped`** - Bot has stopped (payload: `{ botId }`)
- **`bot:error`** - Bot error occurred (payload: `{ botId, error }`)
- **`message:received`** - Message received (payload: `{ botId, message }`)
- **`message:sent`** - Response sent (payload: `{ botId, response }`)
- **`config:reloaded`** - Configuration reloaded

#### Example

```javascript
orchestrator.on('started', () => {
  console.log('AI Army is ready!');
});

orchestrator.on('bot:error', ({ botId, error }) => {
  console.error(`Bot ${botId} error:`, error);
});

orchestrator.on('message:received', ({ botId, message }) => {
  console.log(`[${botId}] Received: ${message.content}`);
});
```

### `off()`

Remove event listener.

```javascript
off(event, handler): void
```

#### Parameters

- **`event`** (string) - Event name
- **`handler`** (Function) - Handler function to remove (must be same reference)

#### Example

```javascript
const handler = () => console.log('Started');
orchestrator.on('started', handler);
// ... later
orchestrator.off('started', handler);
```

## Error Handling

### OrchestratorError

Custom error class for orchestrator failures.

```javascript
class OrchestratorError extends Error {
  name: 'OrchestratorError'
  operation: string      // Operation that failed
  component: string      // Component that failed (optional)
  cause: Error          // Original error (optional)
}
```

#### Example

```javascript
try {
  await orchestrator.start();
} catch (error) {
  if (error.name === 'OrchestratorError') {
    console.error(`Failed during ${error.operation}`);
    console.error(`Component: ${error.component}`);
    if (error.cause) {
      console.error('Caused by:', error.cause.message);
    }
  }
}
```

## Complete Example

```javascript
import { Orchestrator } from 'ai-army';

// Create orchestrator
const orchestrator = new Orchestrator({
  configPath: './config.json',
  botsPath: './bots',
  dataPath: './data'
});

// Register event handlers
orchestrator.on('started', () => {
  console.log('✅ AI Army started successfully');
});

orchestrator.on('bot:started', ({ botId }) => {
  console.log(`✅ Bot ${botId} is ready`);
});

orchestrator.on('bot:error', ({ botId, error }) => {
  console.error(`❌ Bot ${botId} error:`, error.message);
});

orchestrator.on('message:received', async ({ botId, message }) => {
  console.log(`📨 [${botId}] ${message.content}`);
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await orchestrator.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await orchestrator.stop();
  process.exit(0);
});

// Start the system
try {
  await orchestrator.start();

  // Send a test message
  const response = await orchestrator.sendMessage(
    'helper',
    'Hello! What can you help with?',
    { sessionId: 'test-session' }
  );

  console.log('Response:', response.response);

  // Get system status
  const status = await orchestrator.getStatus();
  console.log('Status:', JSON.stringify(status, null, 2));

} catch (error) {
  console.error('Failed to start AI Army:', error);
  process.exit(1);
}
```

## TypeScript Types

```typescript
interface OrchestratorOptions {
  configPath?: string;
  botsPath?: string;
  dataPath?: string;
  migrationsPath?: string;
  logger?: Logger;
}

interface SendMessageOptions {
  sessionId?: string;
  channel?: string;
  userId?: string;
  metadata?: Record<string, any>;
}

interface MessageResponse {
  botId: string;
  sessionId: string;
  response: string;
  timestamp: string;
  metadata: Record<string, any>;
}

interface SystemStatus {
  state: string;
  uptime: number;
  bots: BotsStatus;
  channels: ChannelsStatus;
  queue: QueueStatus;
  health: HealthStatus;
  metrics?: MetricsData;
}

type OrchestratorState =
  | 'created'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'error';
```

## See Also

- [BotManager API](bot-manager.md) - Bot lifecycle management
- [REST API Reference](rest-api.md) - HTTP endpoints
- [Configuration Guide](../getting-started/configuration.md) - Configuration options
- [Architecture Overview](../architecture.md) - System architecture
