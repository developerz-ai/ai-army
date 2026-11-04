-- AI Assistants Army - Instances Schema
-- Migration 006: Instances table for deployed template instances
--
-- Each instance is a running or configured copy of a template, with
-- instance-specific overrides for variables, restrictions, channels,
-- and workspace configuration.
--
-- PostgreSQL 18+ required
-- Run with: psql -d database_name -f 006_instances.sql

-- ============================================================================
-- Instances Table - Deployed instances of bot templates
-- ============================================================================

CREATE TABLE IF NOT EXISTS instances (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  name TEXT,

  overrides JSONB DEFAULT '{}'::jsonb,  -- Instance-specific config overrides (variables, restrictions, etc.)

  status TEXT NOT NULL DEFAULT 'stopped',  -- 'starting' | 'running' | 'stopped' | 'error'

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT instances_status_check CHECK (status IN ('starting', 'running', 'stopped', 'error'))
);

COMMENT ON TABLE instances IS 'Deployed instances of bot templates with per-instance overrides';
COMMENT ON COLUMN instances.id IS 'Unique instance identifier (e.g., support-agent-team-a)';
COMMENT ON COLUMN instances.template_id IS 'Reference to the template this instance was created from';
COMMENT ON COLUMN instances.name IS 'Human-readable instance name';
COMMENT ON COLUMN instances.overrides IS 'Instance-specific JSONB overrides: variables, restrictions, channel, workspace, sandbox';
COMMENT ON COLUMN instances.status IS 'Current lifecycle status: starting, running, stopped, or error';
COMMENT ON COLUMN instances.created_at IS 'When the instance was first created';
COMMENT ON COLUMN instances.updated_at IS 'When the instance was last modified';

-- ============================================================================
-- Indexes for instance queries
-- ============================================================================

-- Template lookup: find all instances of a template
CREATE INDEX IF NOT EXISTS idx_instances_template ON instances(template_id);

-- Status filtering: find running/stopped/error instances
CREATE INDEX IF NOT EXISTS idx_instances_status ON instances(status);

-- Name lookup for CLI and API queries
CREATE INDEX IF NOT EXISTS idx_instances_name ON instances(name);

-- Creation time ordering
CREATE INDEX IF NOT EXISTS idx_instances_created ON instances(created_at);

-- Composite index: find instances of a specific template with a specific status
CREATE INDEX IF NOT EXISTS idx_instances_template_status ON instances(template_id, status);

-- ============================================================================
-- Update Trigger - Automatically update updated_at timestamp
-- ============================================================================

-- Reuse update_updated_at_column() function from 001_initial_schema.sql

-- Drop existing trigger if it exists for idempotency
DROP TRIGGER IF EXISTS instances_updated_at ON instances;

CREATE TRIGGER instances_updated_at
  BEFORE UPDATE ON instances
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- LISTEN/NOTIFY Trigger - Real-time notification on instance changes
-- ============================================================================

CREATE OR REPLACE FUNCTION notify_instance_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM pg_notify('instance_changes', json_build_object(
      'action', TG_OP,
      'instance_id', OLD.id,
      'template_id', OLD.template_id
    )::text);
    RETURN OLD;
  ELSE
    PERFORM pg_notify('instance_changes', json_build_object(
      'action', TG_OP,
      'instance_id', NEW.id,
      'template_id', NEW.template_id
    )::text);
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION notify_instance_change() IS 'Notify listeners of instance configuration or status changes';

-- Drop existing trigger if it exists for idempotency
DROP TRIGGER IF EXISTS instance_change_trigger ON instances;

CREATE TRIGGER instance_change_trigger
  AFTER INSERT OR UPDATE OR DELETE ON instances
  FOR EACH ROW
  EXECUTE FUNCTION notify_instance_change();

-- ============================================================================
-- Record this migration
-- ============================================================================

INSERT INTO schema_migrations (version, name)
VALUES (6, '006_instances.sql')
ON CONFLICT (version) DO NOTHING;
