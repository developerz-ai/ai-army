# Logging Libraries

**Problem Areas**:
- Structured logging (JSON format)
- High-performance logging
- Multiple transports (console, file, database)
- Log levels and filtering
- Error tracking with context

---

## Structured Logging

### ✅ Recommended: Pino
**Install**: `npm install pino`

**Why**:
- Fastest Node.js logger (5-10x faster than Winston)
- Asynchronous I/O (doesn't block event loop)
- JSON-structured by default
- Minimal overhead
- Excellent TypeScript support
- Child loggers for context

**Key Performance**:
- Writes logs asynchronously (separate thread)
- Minimal CPU impact on main application
- Optimized for high-throughput APIs

**Basic Usage**:
```javascript
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty', // Pretty print in development
    options: {
      colorize: true
    }
  }
});

logger.info('Application started');
logger.warn({ botId: 'support-bot' }, 'Bot container restarted');
logger.error({ err: new Error('Failed') }, 'Database connection failed');
```

**Structured Output** (production):
```json
{"level":30,"time":1707321600000,"msg":"Application started"}
{"level":40,"time":1707321601000,"botId":"support-bot","msg":"Bot container restarted"}
{"level":50,"time":1707321602000,"err":{"type":"Error","message":"Failed"},"msg":"Database connection failed"}
```

**Sources**:
- [Pino Logger: Complete Node.js Guide - SigNoz](https://signoz.io/guides/pino-logger/)
- [Node.js Logging: Pino vs Winston vs Bunyan - Medium](https://medium.com/@muhammedshibilin/node-js-logging-pino-vs-winston-vs-bunyan-complete-guide-99fe3cc59ed9)
- [Logging in Node.js - Better Stack](https://betterstack.com/community/guides/logging/best-nodejs-logging-libraries/)

**Alternatives**:
- **Winston** - More flexible, multiple transports, but 5x slower
- **Bunyan** - Similar to Pino but slower maintenance, Pino is its spiritual successor

---

## Logger Implementation

```javascript
// src/utils/Logger.js
import pino from 'pino';

export class Logger {
  constructor(options = {}) {
    const isProduction = process.env.NODE_ENV === 'production';

    this.logger = pino({
      level: options.level || process.env.LOG_LEVEL || 'info',

      // Pretty print in development only
      transport: !isProduction ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname'
        }
      } : undefined,

      // Custom serializers
      serializers: {
        err: pino.stdSerializers.err,
        req: pino.stdSerializers.req,
        res: pino.stdSerializers.res
      },

      // Add timestamp
      timestamp: pino.stdTimeFunctions.isoTime
    });
  }

  // Create child logger with context
  child(context) {
    return this.logger.child(context);
  }

  info(obj, msg) {
    this.logger.info(obj, msg);
  }

  warn(obj, msg) {
    this.logger.warn(obj, msg);
  }

  error(obj, msg) {
    this.logger.error(obj, msg);
  }

  debug(obj, msg) {
    this.logger.debug(obj, msg);
  }
}

// Global logger instance
export const logger = new Logger();
```

---

## Child Loggers (Contextual Logging)

```javascript
// Create child logger for specific bot
const botLogger = logger.child({ botId: 'support-bot' });

botLogger.info('Container created');
// Output: {"level":30,"botId":"support-bot","msg":"Container created"}

botLogger.warn({ containerId: 'abc123' }, 'Container unhealthy');
// Output: {"level":40,"botId":"support-bot","containerId":"abc123","msg":"Container unhealthy"}
```

**Usage in Classes**:
```javascript
// src/core/BotManager.js
export class BotManager {
  constructor(storage, containerPool, logger) {
    this.storage = storage;
    this.containerPool = containerPool;
    this.logger = logger.child({ component: 'BotManager' });
  }

  async startBot(botId) {
    const botLogger = this.logger.child({ botId });

    botLogger.info('Starting bot');

    try {
      const container = await this.containerPool.initializeContainer(botId, config);
      botLogger.info({ containerId: container.id }, 'Bot started successfully');
    } catch (err) {
      botLogger.error({ err }, 'Failed to start bot');
      throw err;
    }
  }
}
```

---

## Log Levels

```javascript
// Set via environment variable
process.env.LOG_LEVEL = 'debug';

const logger = new Logger({ level: 'debug' });

logger.debug('Detailed debugging info');  // Only in debug mode
logger.info('General information');       // INFO and above
logger.warn('Warning message');           // WARN and above
logger.error('Error occurred');           // ERROR only
logger.fatal('Critical failure');         // FATAL only
```

**Level Hierarchy**:
```
trace (10) < debug (20) < info (30) < warn (40) < error (50) < fatal (60)
```

---

## Error Logging with Stack Traces

```javascript
try {
  await riskyOperation();
} catch (err) {
  logger.error({
    err,
    botId: 'support-bot',
    operation: 'containerStart'
  }, 'Container start failed');
}

// Output includes full stack trace:
// {
//   "level": 50,
//   "err": {
//     "type": "Error",
//     "message": "Container not found",
//     "stack": "Error: Container not found\n    at ..."
//   },
//   "botId": "support-bot",
//   "operation": "containerStart",
//   "msg": "Container start failed"
// }
```

---

## Redacting Secrets

```javascript
import pino from 'pino';

const logger = pino({
  redact: {
    paths: ['apiKey', 'token', 'password', '*.apiKey', '*.token'],
    censor: '[REDACTED]'
  }
});

logger.info({ apiKey: 'sk-ant-12345', message: 'Config loaded' });
// Output: {"apiKey":"[REDACTED]","message":"Config loaded"}
```

**Custom Redaction**:
```javascript
// src/utils/ErrorHandler.js
export class ErrorHandler {
  redactSecrets(text) {
    return text
      .replace(/sk-ant-[a-zA-Z0-9-]+/g, '[REDACTED_ANTHROPIC_KEY]')
      .replace(/sk-or-[a-zA-Z0-9-]+/g, '[REDACTED_OPENROUTER_KEY]')
      .replace(/xoxb-[a-zA-Z0-9-]+/g, '[REDACTED_SLACK_BOT_TOKEN]')
      .replace(/xapp-[a-zA-Z0-9-]+/g, '[REDACTED_SLACK_APP_TOKEN]')
      .replace(/ghp_[a-zA-Z0-9]+/g, '[REDACTED_GITHUB_TOKEN]');
  }

  logError(error, context = {}) {
    const redactedMessage = this.redactSecrets(error.message);
    const redactedStack = error.stack ? this.redactSecrets(error.stack) : undefined;

    logger.error({
      ...context,
      err: {
        type: error.constructor.name,
        message: redactedMessage,
        stack: redactedStack
      }
    }, 'Error occurred');
  }
}
```

---

## File Transports (Production)

```javascript
import pino from 'pino';
import { pino as pinoPretty } from 'pino-pretty';

const logger = pino(
  {
    level: 'info'
  },
  pino.destination({
    dest: './logs/app.log',
    sync: false  // Async writes
  })
);

// Or use rotating file streams
import { createStream } from 'rotating-file-stream';

const stream = createStream('app.log', {
  interval: '1d',      // Rotate daily
  maxFiles: 7,         // Keep 7 days
  path: './logs'
});

const logger = pino(stream);
```

---

## Database Logging (Tool Calls)

```javascript
// Log tool executions to PostgreSQL for audit
export class ToolLogger {
  constructor(storage) {
    this.storage = storage;
    this.logger = logger.child({ component: 'ToolLogger' });
  }

  async logToolCall(botId, sessionId, toolName, params, result) {
    try {
      await this.storage.query(
        `INSERT INTO tool_calls (bot_id, session_id, tool_name, params, result, executed_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          botId,
          sessionId,
          toolName,
          JSON.stringify(params),
          JSON.stringify(result)
        ]
      );

      this.logger.debug({ botId, toolName }, 'Tool call logged');
    } catch (err) {
      this.logger.error({ err }, 'Failed to log tool call');
    }
  }
}
```

---

## NPM Scripts for Logs

```json
{
  "scripts": {
    "logs": "tail -f logs/app.log | npx pino-pretty",
    "logs:error": "grep '\"level\":50' logs/app.log | npx pino-pretty"
  }
}
```

---

## Performance Comparison

| Logger | Ops/sec | Memory | Notes |
|--------|---------|--------|-------|
| Pino | 30,000 | Low | Async, fastest |
| Winston | 5,000 | Medium | Flexible, slower |
| Bunyan | 15,000 | Low | Similar to Pino, less maintained |
| console.log | 20,000 | Low | Basic, no structure |

---

## Why Pino over Winston?

**Pino Advantages**:
- ✅ 5-10x faster (async writes)
- ✅ Lower CPU overhead
- ✅ JSON-structured by default
- ✅ Better for high-throughput APIs
- ✅ Simpler API

**Winston Advantages**:
- Multiple transports (file, HTTP, database) out of the box
- More flexible configuration
- Larger ecosystem

**For AI Army**: Pino is perfect because:
- High-throughput bot messages
- Minimal performance impact
- JSON logs work great with log aggregators (Datadog, LogRocket)
- Simple API, easy to use

---

## Summary

| Need | Library | Why |
|------|---------|-----|
| Structured logging | Pino | Fastest, async, JSON-first |
| Pretty printing (dev) | pino-pretty | Included with Pino |
| File rotation | rotating-file-stream | Optional, production use |

**Total Dependencies**: 1 (pino) + 1 optional dev (pino-pretty)
