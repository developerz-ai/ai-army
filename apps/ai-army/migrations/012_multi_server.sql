-- AI Assistants Army - Multi-Server Schema Enhancement
-- Migration 012: Server tracking, worker assignments, and worker metrics
--
-- Adds infrastructure for multi-server deployments:
-- - servers table for tracking deployment targets
-- - Enhanced worker columns for assignment tracking and health
-- - assignments table for worker task tracking
-- - worker_metrics table for resource monitoring
-- - worker_activity table for audit trail of worker operations
--
-- PostgreSQL 18+ required
-- Run with: psql -d database_name -f 012_multi_server.sql

-- ============================================================================
-- Servers Table - Deployment target registry
-- ============================================================================

CREATE TABLE IF NOT EXISTS servers (
  id TEXT PRIMARY KEY,
  host TEXT NOT NULL,
  ssh_user TEXT,
  ssh_key_encrypted TEXT,
  max_workers INT NOT NULL DEFAULT 10,
  current_workers INT NOT NULL DEFAULT 0,
  labels TEXT[],
  status TEXT NOT NULL DEFAULT 'online',       -- 'online' | 'offline' | 'maintenance'
  docker_version TEXT,
  last_heartbeat TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT servers_status_check CHECK (status IN ('online', 'offline', 'maintenance')),
  CONSTRAINT servers_max_workers_check CHECK (max_workers >= 1),
  CONSTRAINT servers_current_workers_check CHECK (current_workers >= 0),
  CONSTRAINT servers_workers_capacity_check CHECK (current_workers <= max_workers)
);

COMMENT ON TABLE servers IS 'Registry of deployment target servers for multi-server orchestration';
COMMENT ON COLUMN servers.id IS 'Unique server identifier (e.g., vps-1, gpu-server, prod-east-1)';
COMMENT ON COLUMN servers.host IS 'Server hostname or IP address (e.g., 178.128.45.10)';
COMMENT ON COLUMN servers.ssh_user IS 'SSH username for remote server access';
COMMENT ON COLUMN servers.ssh_key_encrypted IS 'Encrypted SSH private key for authentication';
COMMENT ON COLUMN servers.max_workers IS 'Maximum number of workers this server can host';
COMMENT ON COLUMN servers.current_workers IS 'Number of workers currently running on this server';
COMMENT ON COLUMN servers.labels IS 'Array of labels for server selection (e.g., gpu, high-memory)';
COMMENT ON COLUMN servers.status IS 'Server availability status: online, offline, or maintenance';
COMMENT ON COLUMN servers.docker_version IS 'Docker version installed on the server';
COMMENT ON COLUMN servers.last_heartbeat IS 'Timestamp of the last successful heartbeat from this server';
COMMENT ON COLUMN servers.created_at IS 'When the server was first registered';
COMMENT ON COLUMN servers.updated_at IS 'When the server record was last modified';

-- ============================================================================
-- Indexes for server queries
-- ============================================================================

-- Status filtering: find online/offline/maintenance servers
CREATE INDEX IF NOT EXISTS idx_servers_status ON servers(status);

-- Heartbeat monitoring: detect stale servers
CREATE INDEX IF NOT EXISTS idx_servers_heartbeat ON servers(last_heartbeat);

-- Load balancing: find servers with available capacity
CREATE INDEX IF NOT EXISTS idx_servers_available ON servers(current_workers, max_workers)
  WHERE status = 'online';

-- ============================================================================
-- Server Update Trigger
-- ============================================================================

-- Reuse update_updated_at_column() function from 001_initial_schema.sql

-- Drop existing trigger if it exists for idempotency
DROP TRIGGER IF EXISTS servers_updated_at ON servers;

CREATE TRIGGER servers_updated_at
  BEFORE UPDATE ON servers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Server LISTEN/NOTIFY Trigger
-- ============================================================================

CREATE OR REPLACE FUNCTION notify_server_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM pg_notify('server_changes', json_build_object(
      'action', TG_OP,
      'server_id', OLD.id,
      'status', OLD.status
    )::text);
    RETURN OLD;
  ELSE
    PERFORM pg_notify('server_changes', json_build_object(
      'action', TG_OP,
      'server_id', NEW.id,
      'status', NEW.status
    )::text);
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION notify_server_change() IS 'Notify listeners of server status or configuration changes';

-- Drop existing trigger if it exists for idempotency
DROP TRIGGER IF EXISTS server_change_trigger ON servers;

CREATE TRIGGER server_change_trigger
  AFTER INSERT OR UPDATE OR DELETE ON servers
  FOR EACH ROW
  EXECUTE FUNCTION notify_server_change();

-- ============================================================================
-- Enhance Workers Table - Add server tracking and assignment stats
-- ============================================================================

-- Add server_id column linking workers to their deployment server
ALTER TABLE workers ADD COLUMN IF NOT EXISTS server_id TEXT;

-- Add health check tracking
ALTER TABLE workers ADD COLUMN IF NOT EXISTS last_health_check TIMESTAMPTZ;

-- Add current assignment tracking
ALTER TABLE workers ADD COLUMN IF NOT EXISTS current_assignment_id TEXT;

-- Add cumulative assignment stats
ALTER TABLE workers ADD COLUMN IF NOT EXISTS total_assignments INT DEFAULT 0;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS total_errors INT DEFAULT 0;
ALTER TABLE workers ADD COLUMN IF NOT EXISTS avg_completion_time_ms INT;

COMMENT ON COLUMN workers.server_id IS 'ID of the server hosting this worker (references servers.id)';
COMMENT ON COLUMN workers.last_health_check IS 'Timestamp of the last health check for this worker';
COMMENT ON COLUMN workers.current_assignment_id IS 'ID of the assignment this worker is currently executing';
COMMENT ON COLUMN workers.total_assignments IS 'Total number of assignments completed by this worker';
COMMENT ON COLUMN workers.total_errors IS 'Total number of errors encountered by this worker';
COMMENT ON COLUMN workers.avg_completion_time_ms IS 'Average assignment completion time in milliseconds';

-- Index for server-based worker lookups
CREATE INDEX IF NOT EXISTS idx_workers_server_id ON workers(server_id);

-- ============================================================================
-- Add server_id to bots table for server tracking
-- ============================================================================

ALTER TABLE bots ADD COLUMN IF NOT EXISTS server_id TEXT;

COMMENT ON COLUMN bots.server_id IS 'ID of the server where this bot is deployed';

-- Index for server-based bot lookups
CREATE INDEX IF NOT EXISTS idx_bots_server_id ON bots(server_id);

-- ============================================================================
-- Assignments Table - Worker task tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  worker_id TEXT REFERENCES workers(id) ON DELETE SET NULL,
  task TEXT NOT NULL,
  context JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',      -- 'pending' | 'in_progress' | 'completed' | 'failed'
  result TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT assignments_status_check CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  CONSTRAINT assignments_duration_check CHECK (duration_ms IS NULL OR duration_ms >= 0)
);

COMMENT ON TABLE assignments IS 'Worker task assignments for tracking distributed work';
COMMENT ON COLUMN assignments.id IS 'Unique assignment identifier';
COMMENT ON COLUMN assignments.worker_id IS 'Worker executing this assignment';
COMMENT ON COLUMN assignments.task IS 'Description of the task to be performed';
COMMENT ON COLUMN assignments.context IS 'Additional context and parameters for the task as JSON';
COMMENT ON COLUMN assignments.status IS 'Assignment lifecycle status: pending, in_progress, completed, or failed';
COMMENT ON COLUMN assignments.result IS 'Result or output from the completed assignment';
COMMENT ON COLUMN assignments.started_at IS 'When the worker began executing this assignment';
COMMENT ON COLUMN assignments.completed_at IS 'When the assignment was completed or failed';
COMMENT ON COLUMN assignments.duration_ms IS 'Time taken to complete the assignment in milliseconds';
COMMENT ON COLUMN assignments.created_at IS 'When the assignment was created';
COMMENT ON COLUMN assignments.updated_at IS 'When the assignment record was last modified';

-- ============================================================================
-- Indexes for assignment queries
-- ============================================================================

-- Worker-based lookups: find assignments for a specific worker
CREATE INDEX IF NOT EXISTS idx_assignments_worker_id ON assignments(worker_id);

-- Status filtering: find pending/in_progress/completed/failed assignments
CREATE INDEX IF NOT EXISTS idx_assignments_status ON assignments(status);

-- Time-based queries: find recent assignments
CREATE INDEX IF NOT EXISTS idx_assignments_started_at ON assignments(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_assignments_completed_at ON assignments(completed_at DESC);

-- Composite: find active assignments for a worker
CREATE INDEX IF NOT EXISTS idx_assignments_worker_status ON assignments(worker_id, status)
  WHERE status IN ('pending', 'in_progress');

-- ============================================================================
-- Assignment Update Trigger
-- ============================================================================

-- Drop existing trigger if it exists for idempotency
DROP TRIGGER IF EXISTS assignments_updated_at ON assignments;

CREATE TRIGGER assignments_updated_at
  BEFORE UPDATE ON assignments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Worker Metrics Table - Resource monitoring time-series data
-- ============================================================================

CREATE TABLE IF NOT EXISTS worker_metrics (
  id SERIAL PRIMARY KEY,
  worker_id TEXT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cpu_usage NUMERIC,
  memory_usage NUMERIC,
  disk_usage NUMERIC,
  active BOOLEAN NOT NULL DEFAULT true
);

COMMENT ON TABLE worker_metrics IS 'Time-series resource metrics for worker monitoring';
COMMENT ON COLUMN worker_metrics.id IS 'Auto-incrementing metric record identifier';
COMMENT ON COLUMN worker_metrics.worker_id IS 'Worker this metric belongs to';
COMMENT ON COLUMN worker_metrics.timestamp IS 'When this metric was recorded';
COMMENT ON COLUMN worker_metrics.cpu_usage IS 'CPU usage percentage (0-100)';
COMMENT ON COLUMN worker_metrics.memory_usage IS 'Memory usage percentage (0-100)';
COMMENT ON COLUMN worker_metrics.disk_usage IS 'Disk usage percentage (0-100)';
COMMENT ON COLUMN worker_metrics.active IS 'Whether the worker was active at this point';

-- ============================================================================
-- Indexes for worker metrics queries
-- ============================================================================

-- Worker-based lookups with time ordering
CREATE INDEX IF NOT EXISTS idx_worker_metrics_worker_time ON worker_metrics(worker_id, timestamp DESC);

-- Time-range queries across all workers
CREATE INDEX IF NOT EXISTS idx_worker_metrics_timestamp ON worker_metrics(timestamp DESC);

-- Active worker filtering
CREATE INDEX IF NOT EXISTS idx_worker_metrics_active ON worker_metrics(worker_id, active)
  WHERE active = true;

-- ============================================================================
-- Worker Activity Table - Audit trail for worker operations
-- ============================================================================

CREATE TABLE IF NOT EXISTS worker_activity (
  id SERIAL PRIMARY KEY,
  worker_id TEXT NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL,                 -- 'tool_execution' | 'file_change' | 'git_operation' | 'assignment'
  details JSONB DEFAULT '{}'::jsonb,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT wa_activity_type_check CHECK (activity_type <> '')
);

COMMENT ON TABLE worker_activity IS 'Audit trail of worker operations and activities';
COMMENT ON COLUMN worker_activity.id IS 'Auto-incrementing activity record identifier';
COMMENT ON COLUMN worker_activity.worker_id IS 'Worker that performed the activity';
COMMENT ON COLUMN worker_activity.activity_type IS 'Type of activity (tool_execution, file_change, git_operation, assignment)';
COMMENT ON COLUMN worker_activity.details IS 'Activity-specific details as JSON';
COMMENT ON COLUMN worker_activity.timestamp IS 'When the activity occurred';

-- ============================================================================
-- Indexes for worker activity queries
-- ============================================================================

-- Worker-based lookups with time ordering
CREATE INDEX IF NOT EXISTS idx_worker_activity_worker_time ON worker_activity(worker_id, timestamp DESC);

-- Activity type filtering
CREATE INDEX IF NOT EXISTS idx_worker_activity_type ON worker_activity(activity_type, timestamp DESC);

-- Time-range queries across all workers
CREATE INDEX IF NOT EXISTS idx_worker_activity_timestamp ON worker_activity(timestamp DESC);

-- ============================================================================
-- Record this migration
-- ============================================================================

INSERT INTO schema_migrations (version, name)
VALUES (12, '012_multi_server.sql')
ON CONFLICT (version) DO NOTHING;
