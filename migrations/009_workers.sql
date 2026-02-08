-- AI Assistants Army - Workers Schema
-- Migration 009: Workers table for distributed worker node management
--
-- Tracks worker nodes (local and remote) that run bot containers.
-- Each worker has a type, capacity, current load, health status,
-- and heartbeat tracking for distributed deployment.
--
-- PostgreSQL 18+ required
-- Run with: psql -d database_name -f 009_workers.sql

-- ============================================================================
-- Workers Table - Distributed worker node registry
-- ============================================================================

CREATE TABLE IF NOT EXISTS workers (
  id TEXT PRIMARY KEY,
  host TEXT NOT NULL,
  type TEXT NOT NULL,                           -- 'local' | 'remote'
  max_containers INT NOT NULL DEFAULT 10,
  current_load INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'healthy',       -- 'healthy' | 'degraded' | 'offline'
  last_heartbeat TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT workers_type_check CHECK (type IN ('local', 'remote')),
  CONSTRAINT workers_status_check CHECK (status IN ('healthy', 'degraded', 'offline')),
  CONSTRAINT workers_max_containers_check CHECK (max_containers >= 1),
  CONSTRAINT workers_current_load_check CHECK (current_load >= 0),
  CONSTRAINT workers_load_capacity_check CHECK (current_load <= max_containers)
);

COMMENT ON TABLE workers IS 'Distributed worker node registry for bot container orchestration';
COMMENT ON COLUMN workers.id IS 'Unique worker identifier (e.g., local, gpu-server, worker-us-east-1)';
COMMENT ON COLUMN workers.host IS 'Worker hostname or IP address (e.g., localhost, 192.168.1.100)';
COMMENT ON COLUMN workers.type IS 'Worker type: local (same machine) or remote (SSH tunnel)';
COMMENT ON COLUMN workers.max_containers IS 'Maximum number of bot containers this worker can run';
COMMENT ON COLUMN workers.current_load IS 'Number of bot containers currently running on this worker';
COMMENT ON COLUMN workers.status IS 'Health status: healthy, degraded, or offline';
COMMENT ON COLUMN workers.last_heartbeat IS 'Timestamp of the last successful heartbeat from this worker';
COMMENT ON COLUMN workers.created_at IS 'When the worker was first registered';
COMMENT ON COLUMN workers.updated_at IS 'When the worker record was last modified';

-- ============================================================================
-- Indexes for worker queries
-- ============================================================================

-- Status filtering: find healthy/degraded/offline workers
CREATE INDEX IF NOT EXISTS idx_workers_status ON workers(status);

-- Heartbeat monitoring: detect stale workers
CREATE INDEX IF NOT EXISTS idx_workers_heartbeat ON workers(last_heartbeat);

-- Type filtering: find local vs remote workers
CREATE INDEX IF NOT EXISTS idx_workers_type ON workers(type);

-- Load balancing: find workers with available capacity
CREATE INDEX IF NOT EXISTS idx_workers_available ON workers(current_load, max_containers)
  WHERE status = 'healthy';

-- ============================================================================
-- Update Trigger - Automatically update updated_at timestamp
-- ============================================================================

-- Reuse update_updated_at_column() function from 001_initial_schema.sql

-- Drop existing trigger if it exists for idempotency
DROP TRIGGER IF EXISTS workers_updated_at ON workers;

CREATE TRIGGER workers_updated_at
  BEFORE UPDATE ON workers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- LISTEN/NOTIFY Trigger - Real-time notification on worker changes
-- ============================================================================

CREATE OR REPLACE FUNCTION notify_worker_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM pg_notify('worker_changes', json_build_object(
      'action', TG_OP,
      'worker_id', OLD.id,
      'status', OLD.status
    )::text);
    RETURN OLD;
  ELSE
    PERFORM pg_notify('worker_changes', json_build_object(
      'action', TG_OP,
      'worker_id', NEW.id,
      'status', NEW.status
    )::text);
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION notify_worker_change() IS 'Notify listeners of worker status or configuration changes';

-- Drop existing trigger if it exists for idempotency
DROP TRIGGER IF EXISTS worker_change_trigger ON workers;

CREATE TRIGGER worker_change_trigger
  AFTER INSERT OR UPDATE OR DELETE ON workers
  FOR EACH ROW
  EXECUTE FUNCTION notify_worker_change();

-- ============================================================================
-- Record this migration
-- ============================================================================

INSERT INTO schema_migrations (version, name)
VALUES (9, '009_workers.sql')
ON CONFLICT (version) DO NOTHING;
