-- AI Assistants Army - Message Queue Schema
-- Migration 002: Message queue table for durable, priority-based message processing
--
-- PostgreSQL 18+ required
-- Run with: psql -d database_name -f 002_message_queue.sql

-- ============================================================================
-- Message Queue Table - Durable queue for incoming bot messages
-- ============================================================================

CREATE TABLE IF NOT EXISTS message_queue (
  id SERIAL PRIMARY KEY,
  bot_id TEXT NOT NULL,
  channel_type TEXT NOT NULL,            -- 'slack' | 'discord' | 'rest'
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  message_text TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,   -- Higher value = higher priority
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'processing' | 'completed' | 'failed'
  enqueued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error TEXT,

  CONSTRAINT mq_channel_type_check CHECK (channel_type IN ('slack', 'discord', 'rest')),
  CONSTRAINT mq_status_check CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  CONSTRAINT mq_priority_check CHECK (priority >= 0)
);

COMMENT ON TABLE message_queue IS 'Durable message queue for bot message processing with priority support';
COMMENT ON COLUMN message_queue.id IS 'Auto-incrementing message queue identifier';
COMMENT ON COLUMN message_queue.bot_id IS 'Target bot that should process this message';
COMMENT ON COLUMN message_queue.channel_type IS 'Source channel type: slack, discord, or rest';
COMMENT ON COLUMN message_queue.channel_id IS 'Source channel identifier (e.g., Slack channel ID)';
COMMENT ON COLUMN message_queue.user_id IS 'User who sent the message';
COMMENT ON COLUMN message_queue.message_text IS 'The message content to be processed';
COMMENT ON COLUMN message_queue.priority IS 'Processing priority (higher = processed first, default 0)';
COMMENT ON COLUMN message_queue.status IS 'Queue item lifecycle: pending -> processing -> completed/failed';
COMMENT ON COLUMN message_queue.enqueued_at IS 'When the message was added to the queue';
COMMENT ON COLUMN message_queue.started_at IS 'When processing began (NULL until picked up)';
COMMENT ON COLUMN message_queue.completed_at IS 'When processing finished (NULL until done)';
COMMENT ON COLUMN message_queue.error IS 'Error message if processing failed';

-- ============================================================================
-- Indexes for efficient queue operations
-- ============================================================================

-- Primary index for dequeuing: find pending messages for a specific bot
CREATE INDEX IF NOT EXISTS idx_mq_bot_status ON message_queue(bot_id, status);

-- Index for queue ordering and stale message detection
CREATE INDEX IF NOT EXISTS idx_mq_enqueued ON message_queue(enqueued_at);

-- Partial index for fast pending message lookup (most common query)
CREATE INDEX IF NOT EXISTS idx_mq_pending ON message_queue(bot_id, priority DESC, enqueued_at ASC)
  WHERE status = 'pending';

-- ============================================================================
-- LISTEN/NOTIFY Trigger - Real-time notification on new messages
-- ============================================================================

CREATE OR REPLACE FUNCTION notify_new_message()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('message_queue', NEW.bot_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION notify_new_message() IS 'Notify listeners when a new message is enqueued for processing';

-- Drop existing trigger if it exists for idempotency
DROP TRIGGER IF EXISTS message_queue_notify ON message_queue;

CREATE TRIGGER message_queue_notify
  AFTER INSERT ON message_queue
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_message();

-- ============================================================================
-- Record this migration
-- ============================================================================

INSERT INTO schema_migrations (version, name)
VALUES (2, '002_message_queue.sql')
ON CONFLICT (version) DO NOTHING;
