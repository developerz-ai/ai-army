# Webhooks & Message Queuing - Concurrent Message Handling

## Overview

Each assistant can have **webhook URLs** to notify external systems:
- When tasks complete
- When errors occur
- On specific events
- Custom triggers

**Concurrent messages** are handled via a **queue system** - messages arriving while the bot is processing get queued and handled in order.

## Per-Assistant Webhooks

### Configuration

Each bot can define webhook URLs for different events:

```json
{
  "bots": {
    "work": {
      "webhooks": {
        "onTaskComplete": "https://api.example.com/webhooks/task-done",
        "onError": "https://api.example.com/webhooks/error",
        "onDailyReport": "https://api.example.com/webhooks/daily",
        "custom": [
          {
            "event": "high_priority_message",
            "url": "https://pagerduty.com/webhooks/...",
            "headers": {
              "Authorization": "Bearer ${PAGERDUTY_TOKEN}"
            }
          }
        ]
      },
      "webhookConfig": {
        "timeout": 5000,
        "retries": 3,
        "retryDelay": 1000
      }
    }
  }
}
```

### Webhook Payload

```json
{
  "event": "task_complete",
  "botId": "work",
  "botName": "Aria",
  "timestamp": "2026-02-05T10:30:00Z",

  "data": {
    "taskId": "task-123",
    "task": "Review PR #42",
    "result": "PR reviewed, 3 issues found",
    "duration": 15000,
    "toolCalls": [
      {"tool": "github__get_pull_request", "success": true}
    ]
  },

  "session": {
    "sessionId": "work:slack:C123:U456",
    "userId": "U456",
    "channelId": "C123"
  }
}
```

### Webhook Implementation

```typescript
// src/webhooks/manager.ts
export class WebhookManager {
  async trigger(botConfig, event: string, data: any) {
    const webhooks = this.getWebhooksForEvent(botConfig, event);

    for (const webhook of webhooks) {
      await this.send(webhook, event, data, botConfig.webhookConfig);
    }
  }

  getWebhooksForEvent(botConfig, event: string) {
    const hooks = [];

    // Standard webhooks
    if (botConfig.webhooks?.[`on${capitalize(event)}`]) {
      hooks.push({
        url: botConfig.webhooks[`on${capitalize(event)}`],
        headers: {}
      });
    }

    // Custom webhooks
    if (botConfig.webhooks?.custom) {
      for (const custom of botConfig.webhooks.custom) {
        if (custom.event === event) {
          hooks.push(custom);
        }
      }
    }

    return hooks;
  }

  async send(webhook, event: string, data: any, config = {}) {
    const payload = {
      event,
      botId: data.botId,
      botName: data.botName,
      timestamp: new Date().toISOString(),
      data
    };

    const retries = config.retries || 3;
    const timeout = config.timeout || 5000;
    const retryDelay = config.retryDelay || 1000;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await fetch(webhook.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'AI-Assistants-Army/1.0',
            ...webhook.headers
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeout)
        });

        if (response.ok) {
          return; // Success
        }

        console.warn(`Webhook failed (${response.status}): ${webhook.url}`);
      } catch (err) {
        console.error(`Webhook error (attempt ${attempt + 1}/${retries}):`, err);

        if (attempt < retries - 1) {
          await sleep(retryDelay * Math.pow(2, attempt)); // Exponential backoff
        }
      }
    }

    // All retries failed
    console.error(`Webhook failed after ${retries} attempts: ${webhook.url}`);
  }
}
```

### Webhook Events

| Event | When Triggered |
|-------|---------------|
| `message_received` | New message arrives |
| `message_processed` | Bot finishes responding |
| `task_complete` | Async task finishes |
| `task_failed` | Async task fails |
| `error` | Any error occurs |
| `compaction` | Session compacted |
| `daily_report` | Daily summary (configurable time) |
| `high_priority` | Urgent message (custom logic) |

## Message Queue System

### The Problem

When a bot is processing a message (running tool calls), new messages can arrive:

```
User sends: "Review PR #42"
  └─> Bot starts processing (tool calls, takes 30 seconds)
      └─> Meanwhile, user sends: "Actually, review PR #43 instead"
          └─> AND user sends: "Is PR #42 done?"
              └─> What happens?
```

### The Solution: Per-Session Message Queue

Each session has its own message queue:

```sql
CREATE TABLE message_queue (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  bot_id TEXT NOT NULL,

  message JSONB NOT NULL,
  priority INTEGER DEFAULT 0,

  status TEXT NOT NULL,  -- 'queued' | 'processing' | 'completed'

  queued_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_queue_session ON message_queue(session_id, status, priority DESC, queued_at);
```

### Queue Processing Flow

```
1. Message arrives from Slack
   └─> INSERT INTO message_queue (session_id, message, status)
       VALUES ('work:slack:C123:U456', {...}, 'queued')

2. Queue processor checks session lock
   └─> SELECT * FROM sessions WHERE id = '...' FOR UPDATE NOWAIT
   └─> If locked (bot processing): message stays queued
   └─> If unlocked: mark message as 'processing', run agent

3. Bot processes message
   └─> Agent tool loop runs
   └─> UPDATE message_queue SET status = 'completed', completed_at = NOW()
   └─> Release session lock

4. Check for next queued message
   └─> SELECT * FROM message_queue
       WHERE session_id = '...' AND status = 'queued'
       ORDER BY priority DESC, queued_at
       LIMIT 1
   └─> If found: goto step 2
```

### Implementation

```typescript
// src/queue/message-queue.ts
export class MessageQueue {
  constructor(private db) {}

  async enqueue(sessionId: string, botId: string, message: any, priority = 0) {
    await this.db.query(`
      INSERT INTO message_queue (session_id, bot_id, message, priority, status)
      VALUES ($1, $2, $3, $4, 'queued')
    `, [sessionId, botId, message, priority]);

    // Trigger processing
    await this.processNext(sessionId);
  }

  async processNext(sessionId: string) {
    // Try to acquire session lock
    let session;
    try {
      session = await this.db.query(`
        SELECT * FROM sessions
        WHERE id = $1
        FOR UPDATE NOWAIT
      `, [sessionId]);
    } catch (err) {
      // Lock held by another process
      return;
    }

    if (session.rows.length === 0) return;

    // Get next message
    const next = await this.db.query(`
      UPDATE message_queue
      SET status = 'processing', started_at = NOW()
      WHERE id = (
        SELECT id FROM message_queue
        WHERE session_id = $1 AND status = 'queued'
        ORDER BY priority DESC, queued_at
        LIMIT 1
      )
      RETURNING *
    `, [sessionId]);

    if (next.rows.length === 0) {
      // No queued messages, release lock
      await this.db.query('COMMIT');
      return;
    }

    const messageData = next.rows[0];

    try {
      // Process the message
      await this.processMessage(messageData);

      // Mark complete
      await this.db.query(`
        UPDATE message_queue
        SET status = 'completed', completed_at = NOW()
        WHERE id = $1
      `, [messageData.id]);

    } catch (err) {
      console.error('Message processing failed:', err);
      await this.db.query(`
        UPDATE message_queue
        SET status = 'failed', completed_at = NOW()
        WHERE id = $1
      `, [messageData.id]);
    }

    // Release lock
    await this.db.query('COMMIT');

    // Process next (recursive)
    await this.processNext(sessionId);
  }

  async processMessage(queueItem) {
    const { bot_id, session_id, message } = queueItem;

    // Get bot
    const bot = await this.orchestrator.getBot(bot_id);

    // Load session history
    const session = await this.db.query(
      'SELECT messages FROM sessions WHERE id = $1',
      [session_id]
    );

    const messages = session.rows[0]?.messages || [];

    // Add new user message
    messages.push({
      role: 'user',
      content: message.text
    });

    // Run agent
    const result = await bot.agent.run({ messages });

    // Save assistant response
    messages.push({
      role: 'assistant',
      content: result.text
    });

    await this.db.query(`
      UPDATE sessions
      SET messages = $1, last_message_at = NOW()
      WHERE id = $2
    `, [messages, session_id]);

    // Send response to channel
    await bot.channel.sendMessage(message.channelId, result.text);

    // Trigger webhooks
    await bot.webhookManager.trigger('message_processed', {
      botId: bot_id,
      sessionId: session_id,
      message: message.text,
      response: result.text
    });
  }
}
```

## Vercel AI SDK Streaming with Queue

The Vercel AI SDK supports streaming responses. For queued messages:

```typescript
// src/agent/streaming-queue.ts
import { ToolLoopAgent } from 'ai';

export class StreamingQueueProcessor {
  async processMessage(bot, session, message) {
    const messages = session.messages || [];
    messages.push({ role: 'user', content: message.text });

    // Stream response
    let responseText = '';

    const result = await bot.agent.run({
      messages,
      onChunk: async (chunk) => {
        responseText += chunk.text;

        // Update channel in real-time
        await bot.channel.streamChunk(message.channelId, chunk);
      }
    });

    // Save final response
    messages.push({ role: 'assistant', content: responseText });

    await this.db.query(`
      UPDATE sessions SET messages = $1 WHERE id = $2
    `, [messages, session.id]);

    return responseText;
  }
}
```

## Priority Queuing

Some messages should jump the queue:

```typescript
// High priority messages
const URGENT_PATTERNS = [
  /!urgent/i,
  /!help/i,
  /production.*down/i,
  /critical.*bug/i
];

export function getPriority(message: string): number {
  if (URGENT_PATTERNS.some(p => p.test(message))) {
    return 100;  // High priority
  }
  return 0;  // Normal priority
}

// Enqueue with priority
await queue.enqueue(sessionId, botId, message, getPriority(message.text));
```

Queue processes high-priority messages first:

```sql
SELECT * FROM message_queue
WHERE session_id = $1 AND status = 'queued'
ORDER BY priority DESC, queued_at  -- High priority first
LIMIT 1
```

## Multi-Session Concurrency

Different sessions can process concurrently:

```
Session A (User Alice): Processing message (locked)
Session B (User Bob):   Processing message (locked)  ← Concurrent
Session C (User Carol): Queued, waiting for lock
```

Same session can't process multiple messages simultaneously (serialized per user).

## Queue Monitoring

```sql
-- Queued messages per bot
SELECT
  bot_id,
  COUNT(*) as queued,
  MAX(queued_at) as oldest_queued
FROM message_queue
WHERE status = 'queued'
GROUP BY bot_id;

-- Average queue wait time
SELECT
  bot_id,
  AVG(EXTRACT(EPOCH FROM (started_at - queued_at))) as avg_wait_seconds
FROM message_queue
WHERE status = 'completed'
  AND started_at > NOW() - INTERVAL '1 hour'
GROUP BY bot_id;

-- Messages being processed right now
SELECT
  mq.bot_id,
  mq.session_id,
  s.user_id,
  mq.message->>'text' as message_preview,
  NOW() - mq.started_at as processing_duration
FROM message_queue mq
JOIN sessions s ON s.id = mq.session_id
WHERE mq.status = 'processing';
```

## Rate Limiting

Prevent message spam:

```typescript
// src/queue/rate-limiter.ts
export class RateLimiter {
  private redis: Redis;

  async checkLimit(userId: string, limit = 10, window = 60): Promise<boolean> {
    const key = `ratelimit:${userId}`;
    const count = await this.redis.incr(key);

    if (count === 1) {
      await this.redis.expire(key, window);
    }

    return count <= limit;
  }
}

// Usage
if (!await rateLimiter.checkLimit(message.userId)) {
  await channel.sendMessage(
    message.channelId,
    "You're sending messages too quickly. Please wait a moment."
  );
  return;  // Don't enqueue
}

await queue.enqueue(sessionId, botId, message);
```

## Queue Configuration Per Bot

```json
{
  "bots": {
    "work": {
      "queue": {
        "enabled": true,
        "maxQueueSize": 100,
        "maxWaitTime": 300000,  // 5 minutes
        "onQueueFull": "reject",  // 'reject' | 'drop_oldest' | 'notify'
        "processingTimeout": 120000  // 2 minutes
      },
      "rateLimit": {
        "messagesPerUser": 10,
        "window": 60
      }
    }
  }
}
```

### Queue Full Behavior

**Reject:**
```typescript
if (queueSize >= maxQueueSize) {
  await channel.sendMessage(
    channelId,
    "I'm currently very busy. Please try again in a few minutes."
  );
  return;
}
```

**Drop oldest:**
```typescript
if (queueSize >= maxQueueSize) {
  await db.query(`
    DELETE FROM message_queue
    WHERE id = (
      SELECT id FROM message_queue
      WHERE status = 'queued'
      ORDER BY queued_at ASC
      LIMIT 1
    )
  `);
}
```

**Notify:**
```typescript
if (queueSize >= maxQueueSize) {
  await webhooks.trigger('queue_full', {
    botId,
    queueSize,
    oldestMessage: queueAge
  });
}
```

## Handling Interruptions

What if a user wants to cancel the current task?

```
User: "Review PR #42"
  └─> Bot starts processing...

User: "Actually, never mind, cancel that"
  └─> How to handle?
```

### Solution: Interruption Flag

```sql
ALTER TABLE message_queue ADD COLUMN interrupted BOOLEAN DEFAULT false;
```

```typescript
// User sends cancel command
if (message.text.match(/cancel|stop|never mind/i)) {
  // Mark current task as interrupted
  await db.query(`
    UPDATE message_queue
    SET interrupted = true
    WHERE session_id = $1 AND status = 'processing'
  `, [sessionId]);

  // Clear queue
  await db.query(`
    DELETE FROM message_queue
    WHERE session_id = $1 AND status = 'queued'
  `, [sessionId]);

  return "Cancelled current task and cleared queue.";
}

// In agent loop, check interruption flag
async function runAgent(agent, messages, queueItemId) {
  const result = await agent.run({
    messages,
    onStep: async () => {
      // Check if interrupted
      const status = await db.query(
        'SELECT interrupted FROM message_queue WHERE id = $1',
        [queueItemId]
      );

      if (status.rows[0]?.interrupted) {
        throw new InterruptedError('Task cancelled by user');
      }
    }
  });

  return result;
}
```

## Queue Dashboard (Optional)

Even though "no UI", admins might want to see queue status:

```
GET /api/queue/status

Response:
{
  "globalQueue": {
    "queued": 15,
    "processing": 8,
    "avgWaitTime": 5.2
  },
  "perBot": [
    {
      "botId": "work",
      "queued": 5,
      "processing": 2,
      "oldest": "2026-02-05T10:25:00Z"
    },
    {
      "botId": "devops",
      "queued": 10,
      "processing": 6,
      "oldest": "2026-02-05T10:20:00Z"
    }
  ]
}
```

## Webhook Security

### Signature Verification

Sign webhook payloads so receivers can verify authenticity:

```typescript
import crypto from 'crypto';

function signPayload(payload: string, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
}

// When sending webhook
const body = JSON.stringify(payload);
const signature = signPayload(body, process.env.WEBHOOK_SECRET);

await fetch(webhook.url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-AI-Army-Signature': signature,
    'X-AI-Army-Timestamp': Date.now().toString()
  },
  body
});
```

Receiver verifies:

```javascript
// Webhook receiver
app.post('/webhooks/task-done', (req, res) => {
  const signature = req.headers['x-ai-army-signature'];
  const timestamp = req.headers['x-ai-army-timestamp'];
  const body = JSON.stringify(req.body);

  const expectedSignature = crypto
    .createHmac('sha256', process.env.WEBHOOK_SECRET)
    .update(body)
    .digest('hex');

  if (signature !== expectedSignature) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Check timestamp (prevent replay attacks)
  if (Date.now() - parseInt(timestamp) > 300000) { // 5 minutes
    return res.status(401).json({ error: 'Timestamp too old' });
  }

  // Process webhook
  console.log('Task completed:', req.body);
  res.json({ received: true });
});
```

## Webhook Examples

### 1. PagerDuty Integration

Notify on-call when critical errors occur:

```json
{
  "webhooks": {
    "custom": [
      {
        "event": "error",
        "condition": "severity === 'critical'",
        "url": "https://events.pagerduty.com/v2/enqueue",
        "headers": {
          "Authorization": "Token ${PAGERDUTY_TOKEN}"
        },
        "transform": {
          "routing_key": "${PAGERDUTY_ROUTING_KEY}",
          "event_action": "trigger",
          "payload": {
            "summary": "{{botName}}: {{error.message}}",
            "severity": "critical",
            "source": "ai-army"
          }
        }
      }
    ]
  }
}
```

### 2. Slack Notifications

Notify a Slack channel when bot completes important tasks:

```json
{
  "webhooks": {
    "onTaskComplete": "https://hooks.slack.com/services/T00/B00/xxx",
    "custom": [
      {
        "event": "task_complete",
        "condition": "data.duration > 60000",
        "url": "https://hooks.slack.com/services/T00/B00/xxx",
        "body": {
          "text": "Bot {{botName}} completed long-running task",
          "blocks": [
            {
              "type": "section",
              "text": {
                "type": "mrkdwn",
                "text": "*Task:* {{data.task}}\n*Duration:* {{data.duration}}ms"
              }
            }
          ]
        }
      }
    ]
  }
}
```

### 3. Metrics Collection

Send metrics to your monitoring system:

```json
{
  "webhooks": {
    "onMessageProcessed": "https://metrics.example.com/ingest",
    "custom": [
      {
        "event": "tool_call",
        "url": "https://metrics.example.com/ingest",
        "headers": {
          "X-API-Key": "${METRICS_API_KEY}"
        }
      }
    ]
  }
}
```

## Summary

**Webhooks** enable bots to notify external systems:
- Per-assistant webhook URLs
- Multiple events (task complete, error, custom)
- Retry logic with exponential backoff
- Signature verification for security

**Message queuing** handles concurrent messages:
- Messages queued per session while bot is busy
- Processed in order (FIFO) with priority support
- Session locking prevents race conditions
- Queue monitoring and management

This ensures bots never miss messages and external systems stay informed.

## Sources

- [Vercel AI SDK Agents Guide](https://vercel.com/kb/guide/how-to-build-ai-agents-with-vercel-and-the-ai-sdk)
- [Claude Agent SDK Sessions](https://docs.claude.com/en/api/agent-sdk/sessions)
- [OpenAI Agents SDK Sessions](https://openai.github.io/openai-agents-python/sessions/)
