-- AI Assistants Army - Audit Log Schema
-- Migration 011: Audit logging table for tracking all system events
--
-- Stores audit trail entries for bot operations, message handling, tool
-- execution, admin operations, and security events. Supports compliance
-- requirements (SOC 2, GDPR) by providing immutable event records with
-- actor, resource, and contextual metadata.
--
-- PostgreSQL 18+ required
-- Run with: psql -d database_name -f 011_audit_log.sql

-- ============================================================================
-- Audit Log Table - Immutable event trail for compliance and debugging
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  actor_type TEXT NOT NULL DEFAULT 'user',
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  action TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  ip_address TEXT,
  user_agent TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT al_event_type_check CHECK (event_type <> ''),
  CONSTRAINT al_actor_check CHECK (actor <> ''),
  CONSTRAINT al_actor_type_check CHECK (actor_type <> ''),
  CONSTRAINT al_resource_type_check CHECK (resource_type <> ''),
  CONSTRAINT al_action_check CHECK (action <> '')
);

COMMENT ON TABLE audit_log IS 'Immutable audit trail for all system events';
COMMENT ON COLUMN audit_log.id IS 'Auto-incrementing audit record identifier';
COMMENT ON COLUMN audit_log.event_type IS 'Dot-namespaced event type (e.g., bot.created, auth.login_failed)';
COMMENT ON COLUMN audit_log.actor IS 'Who performed the action (user ID, bot name, or system identifier)';
COMMENT ON COLUMN audit_log.actor_type IS 'Type of actor (user, bot, system, api)';
COMMENT ON COLUMN audit_log.resource_type IS 'Type of resource affected (bot, message, tool, config, instance, worker)';
COMMENT ON COLUMN audit_log.resource_id IS 'Identifier of the specific resource affected';
COMMENT ON COLUMN audit_log.action IS 'Action performed (created, started, stopped, deleted, updated, etc.)';
COMMENT ON COLUMN audit_log.metadata IS 'Additional contextual data as JSON (previous/new values, error details, etc.)';
COMMENT ON COLUMN audit_log.ip_address IS 'IP address of the request origin (if applicable)';
COMMENT ON COLUMN audit_log.user_agent IS 'User-Agent header from the request (if applicable)';
COMMENT ON COLUMN audit_log.timestamp IS 'When the event occurred';

-- ============================================================================
-- Indexes for efficient audit log queries
-- ============================================================================

-- Index for actor-based lookups (who did what)
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor, timestamp DESC);

-- Composite index for resource-based lookups (what happened to a resource)
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_log(resource_type, resource_id, timestamp DESC);

-- Index for time-range queries across all events
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp DESC);

-- Index for event type filtering
CREATE INDEX IF NOT EXISTS idx_audit_event_type ON audit_log(event_type, timestamp DESC);

-- ============================================================================
-- Record this migration
-- ============================================================================

INSERT INTO schema_migrations (version, name)
VALUES (11, '011_audit_log.sql')
ON CONFLICT (version) DO NOTHING;
