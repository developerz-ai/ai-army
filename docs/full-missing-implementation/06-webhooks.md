# Missing: Webhooks

**Status:** ❌ Not Implemented
**Priority:** Medium
**Design Doc:** [docs/idea/16-webhooks-and-queuing.md](../idea/16-webhooks-and-queuing.md)

## What's Missing

### 1. Webhook Manager
```javascript
// src/webhooks/webhook-manager.js - NOT IMPLEMENTED
class WebhookManager {
  async send(botId, event, payload)
  async retry(webhookId)
  async getHistory(botId, limit)
  async configure(botId, config)
}
```

**Purpose:**
- Notify external systems when bot events occur
- Per-bot webhook configuration
- Delivery guarantees and retry logic
- Audit trail of webhook calls

### 2. Database Schema

**Webhooks table:**
```sql
CREATE TABLE webhooks (
  id SERIAL PRIMARY KEY,
  bot_id TEXT NOT NULL,
  event TEXT NOT NULL,
  url TEXT NOT NULL,
  method TEXT DEFAULT 'POST',
  headers JSONB DEFAULT '{}',
  payload JSONB NOT NULL,
  status TEXT DEFAULT 'pending',
  attempts INT DEFAULT 0,
  max_attempts INT DEFAULT 3,
  last_attempt_at TIMESTAMPTZ,
  response_code INT,
  response_body TEXT,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  INDEX idx_bot_status (bot_id, status),
  INDEX idx_created_at (created_at)
);
```

**Webhook states:**
- `pending` - Not yet sent
- `sending` - Currently being sent
- `success` - Successfully delivered (2xx response)
- `failed` - All retry attempts exhausted

### 3. Configuration Format

**Per-bot webhook config:**
```json
{
  "id": "work-bot",
  "webhooks": [
    {
      "url": "https://api.example.com/bot-events",
      "events": ["message.received", "message.sent", "error"],
      "method": "POST",
      "headers": {
        "Authorization": "Bearer ${WEBHOOK_SECRET}"
      },
      "retries": 3,
      "timeout": 5000
    },
    {
      "url": "https://slack.com/webhook/...",
      "events": ["error"],
      "method": "POST"
    }
  ]
}
```

### 4. Event Types

**Bot lifecycle events:**
- `bot.started` - Bot started successfully
- `bot.stopped` - Bot stopped
- `bot.error` - Bot encountered error

**Message events:**
- `message.received` - New message from user
- `message.sent` - Response sent to user
- `message.error` - Error processing message

**Tool events:**
- `tool.called` - Tool executed
- `tool.error` - Tool execution failed

**Example payload:**
```json
{
  "event": "message.sent",
  "timestamp": "2026-02-06T10:30:00Z",
  "bot": {
    "id": "work-bot",
    "name": "Work Assistant"
  },
  "message": {
    "userId": "U123456",
    "channelId": "C789012",
    "text": "How can I help you?",
    "sessionId": "work-bot:slack:C789012:U123456"
  }
}
```

### 5. Delivery Manager

```javascript
// src/webhooks/delivery-manager.js - NOT IMPLEMENTED
class DeliveryManager {
  async deliver(webhook) {
    const response = await fetch(webhook.url, {
      method: webhook.method,
      headers: webhook.headers,
      body: JSON.stringify(webhook.payload),
      timeout: webhook.timeout || 5000
    });

    if (!response.ok && webhook.attempts < webhook.maxAttempts) {
      await this.scheduleRetry(webhook);
    }

    return response;
  }

  async scheduleRetry(webhook) {
    const delay = Math.min(1000 * Math.pow(2, webhook.attempts), 60000);
    setTimeout(() => this.deliver(webhook), delay);
  }
}
```

### 6. Webhook Worker

```javascript
// src/webhooks/webhook-worker.js - NOT IMPLEMENTED
class WebhookWorker {
  async start() {
    // Poll for pending webhooks
    // Or use LISTEN/NOTIFY
    setInterval(async () => {
      const pending = await this.queue.getPending();
      await Promise.all(pending.map(w => this.deliver(w)));
    }, 1000);
  }
}
```

## Current State

**What Works:**
- Nothing related to webhooks

**What Doesn't Work:**
- Webhook configuration
- Event emission
- Webhook delivery
- Retry logic
- Audit trail

## Implementation Path

### Step 1: Database Schema
1. Create `webhooks` table migration
2. Create indexes for efficient queries
3. Test manual webhook insertion

### Step 2: Event Emitter
1. Create `EventEmitter` class
2. Wire into key points (MessageProcessor, BotManager)
3. Emit events for all actions
4. Test event emission

### Step 3: Webhook Manager
1. Implement `WebhookManager` class
2. Store webhook configs per bot
3. Match events to webhook subscriptions
4. Queue webhook deliveries

### Step 4: Delivery Manager
1. Implement HTTP delivery with fetch
2. Handle timeouts and errors
3. Exponential backoff retry logic
4. Store response/error in database

### Step 5: Webhook Worker
1. Implement background worker
2. Poll for pending webhooks
3. Deliver via DeliveryManager
4. Mark success/failed

### Step 6: Configuration
1. Extend `ConfigValidator` for webhook config
2. Parse webhook config in bot configs
3. Support env var substitution in URLs/headers
4. Validate URLs and event names

### Step 7: Integration
1. Wire WebhookManager into Orchestrator
2. Emit events from MessageProcessor
3. Start WebhookWorker on orchestrator start
4. Add webhook history to admin API

## Files to Create

```
src/webhooks/webhook-manager.js
src/webhooks/delivery-manager.js
src/webhooks/webhook-worker.js
src/core/event-emitter.js
test/unit/webhook-manager.test.js
test/integration/webhook-delivery.test.js
migrations/015_webhooks.sql
```

## Configuration Example

```json
{
  "id": "support-bot",
  "webhooks": [
    {
      "url": "https://api.company.com/bot-events",
      "events": ["message.received", "message.sent"],
      "headers": {
        "Authorization": "Bearer ${WEBHOOK_TOKEN}",
        "X-Bot-ID": "support-bot"
      },
      "retries": 3,
      "timeout": 5000
    }
  ]
}
```

## CLI Commands

```bash
# Test webhook manually
ai-army webhook test work-bot \
  --event message.sent \
  --payload '{"text":"test"}'

# View webhook history
ai-army webhook history work-bot --limit 10

# Retry failed webhook
ai-army webhook retry <webhook-id>
```

## Dependencies

- Node.js fetch (built-in since Node 18)
- PostgreSQL storage (already exists)
- EventEmitter pattern

## Use Cases

1. **Logging**: Send all bot events to external log service
2. **Notifications**: Alert Slack when errors occur
3. **Analytics**: Track bot usage metrics
4. **Integrations**: Trigger workflows in other systems
5. **Audit**: Compliance logging to external system

## Complexity: Medium
- HTTP delivery and retries
- Event emission integration
- Background worker
- Error handling
- Simpler than message queue
