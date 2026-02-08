-- AI Assistants Army - Channel Metrics Schema
-- Migration 008: Channel metrics table for tracking channel performance
--
-- Stores per-channel usage metrics aggregated over time intervals.
-- Each row represents a snapshot of channel activity for a given timestamp,
-- tracking messages received/sent, error counts, and average response time.
--
-- PostgreSQL 18+ required
-- Run with: psql -d database_name -f 008_channel_metrics.sql

-- ============================================================================
-- Channel Metrics Table - Per-channel performance tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS channel_metrics (
  id SERIAL PRIMARY KEY,
  channel_name TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  messages_received INTEGER NOT NULL DEFAULT 0,
  messages_sent INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  avg_response_time_ms INTEGER,

  CONSTRAINT cm_messages_received_check CHECK (messages_received >= 0),
  CONSTRAINT cm_messages_sent_check CHECK (messages_sent >= 0),
  CONSTRAINT cm_errors_check CHECK (errors >= 0),
  CONSTRAINT cm_avg_response_time_check CHECK (avg_response_time_ms IS NULL OR avg_response_time_ms >= 0)
);

COMMENT ON TABLE channel_metrics IS 'Per-channel performance metrics aggregated over time intervals';
COMMENT ON COLUMN channel_metrics.id IS 'Auto-incrementing metric record identifier';
COMMENT ON COLUMN channel_metrics.channel_name IS 'Channel name matching the config key (e.g., slack-main, discord-public)';
COMMENT ON COLUMN channel_metrics.timestamp IS 'When this metric snapshot was recorded';
COMMENT ON COLUMN channel_metrics.messages_received IS 'Number of inbound messages received during this interval';
COMMENT ON COLUMN channel_metrics.messages_sent IS 'Number of outbound messages sent during this interval';
COMMENT ON COLUMN channel_metrics.errors IS 'Number of errors encountered during this interval';
COMMENT ON COLUMN channel_metrics.avg_response_time_ms IS 'Average response time in milliseconds (NULL if no messages processed)';

-- ============================================================================
-- Indexes for efficient metric queries
-- ============================================================================

-- Composite unique index for upsert support (one row per channel per timestamp)
CREATE UNIQUE INDEX IF NOT EXISTS idx_cm_channel_timestamp
  ON channel_metrics(channel_name, timestamp);

-- Index for time-range queries across all channels
CREATE INDEX IF NOT EXISTS idx_cm_timestamp ON channel_metrics(timestamp DESC);

-- Index for per-channel lookups ordered by time
CREATE INDEX IF NOT EXISTS idx_cm_channel_name ON channel_metrics(channel_name, timestamp DESC);

-- ============================================================================
-- Record this migration
-- ============================================================================

INSERT INTO schema_migrations (version, name)
VALUES (8, '008_channel_metrics.sql')
ON CONFLICT (version) DO NOTHING;
