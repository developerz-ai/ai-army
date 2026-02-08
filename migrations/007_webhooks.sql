-- AI Assistants Army - Webhooks Schema
-- Migration 007: Webhooks table for outbound webhook delivery tracking
--
-- Stores individual webhook delivery attempts for bot events. Each row
-- represents a single delivery of a bot event to an external URL, with
-- retry tracking and response storage for debugging and audit.
--
-- PostgreSQL 18+ required
-- Run with: psql -d database_name -f 007_webhooks.sql

-- ============================================================================
-- Webhooks Table - Outbound webhook delivery records
-- ============================================================================

CREATE TABLE IF NOT EXISTS webhooks (
  id SERIAL PRIMARY KEY,
  bot_id TEXT NOT NULL,
  event TEXT NOT NULL,                     -- e.g. 'message.sent', 'bot.started', 'tool.error'
  url TEXT NOT NULL,                       -- Destination URL
  method TEXT NOT NULL DEFAULT 'POST',     -- HTTP method (POST, PUT, PATCH, etc.)
  headers JSONB DEFAULT '{}'::jsonb,       -- Request headers
  payload JSONB NOT NULL,                  -- Request body payload

  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'sending' | 'success' | 'failed'
  attempts INTEGER NOT NULL DEFAULT 0,     -- Number of delivery attempts so far
  max_attempts INTEGER NOT NULL DEFAULT 3, -- Maximum delivery attempts before marking failed
  last_attempt_at TIMESTAMPTZ,             -- When the last delivery attempt was made

  response_code INTEGER,                   -- HTTP response status code from last attempt
  response_body TEXT,                      -- HTTP response body from last attempt
  error TEXT,                              -- Error message if delivery failed

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT wh_status_check CHECK (status IN ('pending', 'sending', 'success', 'failed')),
  CONSTRAINT wh_method_check CHECK (method IN ('POST', 'PUT', 'PATCH', 'DELETE')),
  CONSTRAINT wh_attempts_check CHECK (attempts >= 0),
  CONSTRAINT wh_max_attempts_check CHECK (max_attempts >= 1)
);

COMMENT ON TABLE webhooks IS 'Outbound webhook delivery records for bot event notifications';
COMMENT ON COLUMN webhooks.id IS 'Auto-incrementing webhook delivery identifier';
COMMENT ON COLUMN webhooks.bot_id IS 'Bot that triggered this webhook event';
COMMENT ON COLUMN webhooks.event IS 'Event type (e.g., message.sent, bot.started, tool.error)';
COMMENT ON COLUMN webhooks.url IS 'Destination URL for the webhook delivery';
COMMENT ON COLUMN webhooks.method IS 'HTTP method: POST, PUT, PATCH, or DELETE';
COMMENT ON COLUMN webhooks.headers IS 'JSONB request headers (Authorization, Content-Type, etc.)';
COMMENT ON COLUMN webhooks.payload IS 'JSONB request body payload sent to the webhook URL';
COMMENT ON COLUMN webhooks.status IS 'Delivery lifecycle: pending -> sending -> success/failed';
COMMENT ON COLUMN webhooks.attempts IS 'Number of delivery attempts made so far';
COMMENT ON COLUMN webhooks.max_attempts IS 'Maximum attempts before marking as failed (default 3)';
COMMENT ON COLUMN webhooks.last_attempt_at IS 'Timestamp of the most recent delivery attempt';
COMMENT ON COLUMN webhooks.response_code IS 'HTTP response status code from the last attempt';
COMMENT ON COLUMN webhooks.response_body IS 'HTTP response body from the last attempt';
COMMENT ON COLUMN webhooks.error IS 'Error message if the delivery failed (timeout, network, etc.)';
COMMENT ON COLUMN webhooks.created_at IS 'When the webhook delivery was enqueued';

-- ============================================================================
-- Indexes for efficient webhook operations
-- ============================================================================

-- Composite index for finding webhooks by bot and delivery status
CREATE INDEX IF NOT EXISTS idx_wh_bot_status ON webhooks(bot_id, status);

-- Index for chronological ordering and cleanup queries
CREATE INDEX IF NOT EXISTS idx_wh_created_at ON webhooks(created_at);

-- Partial index for fast pending/sending webhook lookup (worker hot path)
CREATE INDEX IF NOT EXISTS idx_wh_pending ON webhooks(created_at ASC)
  WHERE status IN ('pending', 'sending');

-- ============================================================================
-- LISTEN/NOTIFY Trigger - Real-time notification on new webhooks
-- ============================================================================

CREATE OR REPLACE FUNCTION notify_new_webhook()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('webhook_queue', json_build_object(
    'webhook_id', NEW.id,
    'bot_id', NEW.bot_id,
    'event', NEW.event
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION notify_new_webhook() IS 'Notify listeners when a new webhook is enqueued for delivery';

-- Drop existing trigger if it exists for idempotency
DROP TRIGGER IF EXISTS webhook_queue_notify ON webhooks;

CREATE TRIGGER webhook_queue_notify
  AFTER INSERT ON webhooks
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_webhook();

-- ============================================================================
-- Record this migration
-- ============================================================================

INSERT INTO schema_migrations (version, name)
VALUES (7, '007_webhooks.sql')
ON CONFLICT (version) DO NOTHING;
