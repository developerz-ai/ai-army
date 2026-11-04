-- AI Assistants Army - Queue Retry Columns
-- Migration 004: Add retry_count and next_attempt_at columns so the queue
-- worker can enforce exponential backoff at the database level instead of
-- relying on in-memory setTimeout timers (which are lost on restart).
--
-- retry_count    – number of times this message has been retried
-- next_attempt_at – earliest time the message may be dequeued again (NULL = immediately)

ALTER TABLE message_queue
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;

COMMENT ON COLUMN message_queue.retry_count IS 'Number of processing attempts that have failed for this message';
COMMENT ON COLUMN message_queue.next_attempt_at IS 'Earliest time this message may be dequeued (NULL means immediately eligible)';

-- ============================================================================
-- Record this migration
-- ============================================================================

INSERT INTO schema_migrations (version, name)
VALUES (4, '004_queue_retry_columns.sql')
ON CONFLICT (version) DO NOTHING;
