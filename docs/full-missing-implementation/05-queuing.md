# Missing: Message Queuing

**Status:** ❌ Not Implemented
**Priority:** High
**Design Doc:** [docs/idea/16-webhooks-and-queuing.md](../idea/16-webhooks-and-queuing.md)

## What's Missing

### 1. Message Queue Manager
```javascript
// src/queue/message-queue.js - NOT IMPLEMENTED
class MessageQueue {
  async enqueue(botId, message, priority)
  async dequeue(botId)
  async getQueueDepth(botId)
  async clearQueue(botId)
  async subscribe(botId, handler)
}
```

**Purpose:**
- Handle concurrent messages to same bot gracefully
- Queue messages per bot (FIFO or priority-based)
- Prevent overwhelming bots with parallel requests
- Persist queue in PostgreSQL for durability

### 2. Database Schema

**Message queue table:**
```sql
CREATE TABLE message_queue (
  id SERIAL PRIMARY KEY,
  bot_id TEXT NOT NULL,
  channel_type TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  message_text TEXT NOT NULL,
  priority INT DEFAULT 0,
  status TEXT DEFAULT 'pending',
  enqueued_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error TEXT,
  INDEX idx_bot_status (bot_id, status),
  INDEX idx_enqueued_at (enqueued_at)
);
```

**Queue states:**
- `pending` - Waiting to be processed
- `processing` - Currently being processed
- `completed` - Successfully processed
- `failed` - Processing failed

### 3. Queue Worker

```javascript
// src/queue/queue-worker.js - NOT IMPLEMENTED
class QueueWorker {
  constructor(messageQueue, messageProcessor) {
    this.queue = messageQueue;
    this.processor = messageProcessor;
  }

  async start() {
    // Poll queue every 100ms
    // Or use PostgreSQL LISTEN/NOTIFY
  }

  async processNext(botId) {
    const message = await this.queue.dequeue(botId);
    if (!message) return;

    try {
      await this.processor.processMessage(botId, message);
      await this.queue.markCompleted(message.id);
    } catch (err) {
      await this.queue.markFailed(message.id, err);
    }
  }
}
```

### 4. Real-time Notification (LISTEN/NOTIFY)

**PostgreSQL pub/sub:**
```sql
-- Trigger to notify on new message
CREATE OR REPLACE FUNCTION notify_new_message()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('message_queue', NEW.bot_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER message_queue_notify
AFTER INSERT ON message_queue
FOR EACH ROW
EXECUTE FUNCTION notify_new_message();
```

**Listen in Node.js:**
```javascript
const client = await pool.connect();
await client.query('LISTEN message_queue');

client.on('notification', (msg) => {
  const botId = msg.payload;
  queueWorker.processNext(botId);
});
```

### 5. Concurrency Control

**Per-bot concurrency limits:**
```json
{
  "id": "work-bot",
  "queue": {
    "maxConcurrent": 3,
    "priority": "fifo"  // or "priority"
  }
}
```

**Implementation:**
```javascript
class ConcurrencyController {
  constructor() {
    this.active = new Map(); // botId -> Set of message IDs
  }

  canProcess(botId, maxConcurrent) {
    const current = this.active.get(botId)?.size || 0;
    return current < maxConcurrent;
  }

  startProcessing(botId, messageId) {
    if (!this.active.has(botId)) {
      this.active.set(botId, new Set());
    }
    this.active.get(botId).add(messageId);
  }

  finishProcessing(botId, messageId) {
    this.active.get(botId)?.delete(messageId);
  }
}
```

## Current State

**What Works:**
- Direct message processing (synchronous)
- One message at a time per channel

**What Doesn't Work:**
- Queueing concurrent messages
- Priority-based processing
- Queue persistence across restarts
- Queue depth monitoring
- Retry logic for failed messages

## Implementation Path

### Step 1: Database Schema
1. Create `message_queue` table migration
2. Create indexes for efficient queries
3. Create NOTIFY trigger
4. Test manual queue operations

### Step 2: Message Queue Class
1. Implement `MessageQueue` with PostgreSQL backend
2. `enqueue()` - Insert into table
3. `dequeue()` - SELECT + UPDATE status
4. Test queue operations

### Step 3: Queue Worker
1. Implement `QueueWorker` class
2. Poll queue for pending messages
3. Process via `MessageProcessor`
4. Mark completed/failed
5. Test processing pipeline

### Step 4: LISTEN/NOTIFY
1. Set up PostgreSQL LISTEN in worker
2. Process on notification (real-time)
3. Fall back to polling if NOTIFY fails
4. Test real-time processing

### Step 5: Concurrency Control
1. Implement `ConcurrencyController`
2. Check concurrency before processing
3. Respect per-bot limits
4. Test concurrent message handling

### Step 6: Integration
1. Wire queue into channel handlers
2. Enqueue instead of direct processing
3. Start `QueueWorker` in `Orchestrator`
4. Add queue metrics to status command

### Step 7: Priority Support (Optional)
1. Add priority field to messages
2. Sort by priority in dequeue
3. Test high-priority messages

## Files to Create

```
src/queue/message-queue.js
src/queue/queue-worker.js
src/queue/concurrency-controller.js
test/unit/message-queue.test.js
test/integration/queue-processing.test.js
migrations/014_message_queue.sql
```

## Configuration Example

```json
{
  "queue": {
    "enabled": true,
    "maxConcurrentPerBot": 3,
    "defaultPriority": 0,
    "retryAttempts": 3,
    "retryDelay": 5000
  }
}
```

## Dependencies

- ✅ PostgreSQL storage (already exists)
- ✅ MessageProcessor (already exists)
- pg module (already in package.json)

## Benefits

1. **Graceful Overload**: Don't drop messages under load
2. **Durability**: Queue survives restarts
3. **Priority**: VIP users get faster responses
4. **Metrics**: Track queue depth and processing time
5. **Retry Logic**: Automatic retry on failures

## Complexity: Medium-High
- PostgreSQL queue operations
- LISTEN/NOTIFY implementation
- Concurrency control
- Error handling and retry logic
- Testing concurrent scenarios
