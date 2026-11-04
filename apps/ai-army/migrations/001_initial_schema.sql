-- AI Assistants Army - Initial Database Schema
-- Migration 001: Core tables for bots, sessions, tool_calls, and schema_migrations
--
-- PostgreSQL 18+ required
-- Run with: psql -d database_name -f 001_initial_schema.sql

-- ============================================================================
-- Schema Migrations Table (must be first for migration tracking)
-- ============================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  executed_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE schema_migrations IS 'Tracks database migration versions';
COMMENT ON COLUMN schema_migrations.version IS 'Migration version number (001, 002, etc.)';
COMMENT ON COLUMN schema_migrations.name IS 'Migration file name for reference';
COMMENT ON COLUMN schema_migrations.executed_at IS 'When the migration was applied';

-- ============================================================================
-- Bots Table - Bot definitions and runtime status
-- ============================================================================

CREATE TABLE IF NOT EXISTS bots (
  id TEXT PRIMARY KEY,
  template_id TEXT,                    -- NULL if not from template
  name TEXT NOT NULL,
  description TEXT,

  config JSONB NOT NULL,               -- Full bot configuration
  soul_content TEXT,                   -- Cached soul.md content

  status TEXT NOT NULL DEFAULT 'stopped',  -- 'starting' | 'running' | 'stopped' | 'error'
  worker_id TEXT,                      -- Which worker is running this bot
  container_id TEXT,                   -- Docker container ID

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_active_at TIMESTAMPTZ,

  stats JSONB DEFAULT '{}'::jsonb,     -- Messages processed, tool calls, etc.

  CONSTRAINT bots_status_check CHECK (status IN ('starting', 'running', 'stopped', 'error'))
);

COMMENT ON TABLE bots IS 'Bot definitions and their current runtime status';
COMMENT ON COLUMN bots.id IS 'Unique bot identifier (e.g., support-agent, code-reviewer)';
COMMENT ON COLUMN bots.template_id IS 'Reference to template if bot was created from one';
COMMENT ON COLUMN bots.config IS 'Full JSONB configuration including model, tools, restrictions';
COMMENT ON COLUMN bots.soul_content IS 'Cached content of the bot soul.md personality file';
COMMENT ON COLUMN bots.status IS 'Current lifecycle status of the bot';
COMMENT ON COLUMN bots.worker_id IS 'ID of the worker server running this bot container';
COMMENT ON COLUMN bots.container_id IS 'Docker container ID when running';
COMMENT ON COLUMN bots.stats IS 'Runtime statistics (messages_count, tool_calls_count, etc.)';

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_bots_status ON bots(status);
CREATE INDEX IF NOT EXISTS idx_bots_template ON bots(template_id);
CREATE INDEX IF NOT EXISTS idx_bots_worker ON bots(worker_id);
CREATE INDEX IF NOT EXISTS idx_bots_last_active ON bots(last_active_at);

-- ============================================================================
-- Sessions Table - Conversation histories
-- ============================================================================

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,                 -- Format: botId:channelType:channelId:userId
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,

  user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  channel_type TEXT NOT NULL,          -- 'slack' | 'discord' | 'rest'

  messages JSONB[] DEFAULT ARRAY[]::jsonb[],  -- Array of message objects

  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_message_at TIMESTAMPTZ DEFAULT NOW(),

  compaction_count INTEGER DEFAULT 0,  -- How many times session was compacted
  token_count INTEGER DEFAULT 0,       -- Estimated token count for compaction trigger

  CONSTRAINT sessions_channel_type_check CHECK (channel_type IN ('slack', 'discord', 'rest'))
);

COMMENT ON TABLE sessions IS 'Conversation sessions between users and bots';
COMMENT ON COLUMN sessions.id IS 'Session key format: botId:channelType:channelId:userId';
COMMENT ON COLUMN sessions.bot_id IS 'Reference to the bot handling this session';
COMMENT ON COLUMN sessions.user_id IS 'User identifier from the channel (e.g., Slack user ID)';
COMMENT ON COLUMN sessions.channel_id IS 'Channel identifier (e.g., Slack channel ID)';
COMMENT ON COLUMN sessions.channel_type IS 'Type of channel: slack, discord, or rest';
COMMENT ON COLUMN sessions.messages IS 'Array of message objects with role, content, timestamp';
COMMENT ON COLUMN sessions.compaction_count IS 'Number of times old messages were summarized';
COMMENT ON COLUMN sessions.token_count IS 'Estimated token count for context window management';

-- Indexes for session queries
CREATE INDEX IF NOT EXISTS idx_sessions_bot ON sessions(bot_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_last_message ON sessions(last_message_at);
CREATE INDEX IF NOT EXISTS idx_sessions_channel ON sessions(channel_type, channel_id);

-- ============================================================================
-- Tool Calls Table - Audit log of all tool executions
-- ============================================================================

CREATE TABLE IF NOT EXISTS tool_calls (
  id BIGSERIAL PRIMARY KEY,
  bot_id TEXT NOT NULL,                -- Intentionally not FK for performance
  session_id TEXT,                     -- Can be NULL for background tasks

  tool_name TEXT NOT NULL,
  parameters JSONB,
  result JSONB,

  success BOOLEAN,
  error TEXT,
  duration_ms INTEGER,

  executed_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE tool_calls IS 'Audit log of all tool executions for debugging and analytics';
COMMENT ON COLUMN tool_calls.bot_id IS 'Bot that initiated the tool call';
COMMENT ON COLUMN tool_calls.session_id IS 'Session context (NULL for background tasks)';
COMMENT ON COLUMN tool_calls.tool_name IS 'Name of the tool executed (bash, readFile, etc.)';
COMMENT ON COLUMN tool_calls.parameters IS 'Parameters passed to the tool';
COMMENT ON COLUMN tool_calls.result IS 'Result returned by the tool';
COMMENT ON COLUMN tool_calls.success IS 'Whether the tool execution succeeded';
COMMENT ON COLUMN tool_calls.error IS 'Error message if execution failed';
COMMENT ON COLUMN tool_calls.duration_ms IS 'Execution time in milliseconds';

-- Indexes for analytics and debugging
CREATE INDEX IF NOT EXISTS idx_tool_calls_bot ON tool_calls(bot_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_tool_calls_tool ON tool_calls(tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_executed ON tool_calls(executed_at);
CREATE INDEX IF NOT EXISTS idx_tool_calls_success ON tool_calls(success) WHERE success = false;

-- ============================================================================
-- Update Triggers - Automatically update updated_at timestamp
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_updated_at_column() IS 'Trigger function to auto-update updated_at';

-- Drop existing trigger if it exists for idempotency
DROP TRIGGER IF EXISTS bots_updated_at ON bots;

CREATE TRIGGER bots_updated_at
  BEFORE UPDATE ON bots
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- LISTEN/NOTIFY Triggers for Real-Time Updates
-- ============================================================================

CREATE OR REPLACE FUNCTION notify_bot_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM pg_notify('bot_changes', json_build_object(
      'action', TG_OP,
      'bot_id', OLD.id
    )::text);
    RETURN OLD;
  ELSE
    PERFORM pg_notify('bot_changes', json_build_object(
      'action', TG_OP,
      'bot_id', NEW.id
    )::text);
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION notify_bot_change() IS 'Notify listeners of bot configuration changes';

-- Drop existing trigger if it exists for idempotency
DROP TRIGGER IF EXISTS bot_change_trigger ON bots;

CREATE TRIGGER bot_change_trigger
  AFTER INSERT OR UPDATE OR DELETE ON bots
  FOR EACH ROW
  EXECUTE FUNCTION notify_bot_change();

-- ============================================================================
-- Record this migration
-- ============================================================================

INSERT INTO schema_migrations (version, name)
VALUES (1, '001_initial_schema.sql')
ON CONFLICT (version) DO NOTHING;
