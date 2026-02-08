-- AI Assistants Army - Queue Reply Routing
-- Migration 003: Add reply routing columns so the queue worker can deliver
-- responses back to the originating channel adapter.
--
-- channel_name  – the orchestrator-level channel name (e.g. 'slack-main')
-- thread_ts     – optional thread timestamp for threaded replies (Slack)

ALTER TABLE message_queue
  ADD COLUMN IF NOT EXISTS channel_name TEXT,
  ADD COLUMN IF NOT EXISTS thread_ts TEXT;

COMMENT ON COLUMN message_queue.channel_name IS 'Orchestrator channel name for routing responses back to the correct adapter';
COMMENT ON COLUMN message_queue.thread_ts IS 'Thread timestamp for threaded replies (e.g. Slack thread_ts)';

-- ============================================================================
-- Record this migration
-- ============================================================================

INSERT INTO schema_migrations (version, name)
VALUES (3, '003_queue_reply_routing.sql')
ON CONFLICT (version) DO NOTHING;
