-- AI Assistants Army - Health Metrics Schema
-- Migration 010: Health metrics table for time-series monitoring data
--
-- Stores per-component health metrics over time, enabling historical
-- trend analysis, dashboards, and retention-based cleanup.
-- Each row captures a single metric value for a given component at a point in time.
--
-- PostgreSQL 18+ required
-- Run with: psql -d database_name -f 010_health_metrics.sql

-- ============================================================================
-- Health Metrics Table - Per-component time-series health data
-- ============================================================================

CREATE TABLE IF NOT EXISTS health_metrics (
  id SERIAL PRIMARY KEY,
  component TEXT NOT NULL,
  metric TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT hm_component_check CHECK (component <> ''),
  CONSTRAINT hm_metric_check CHECK (metric <> '')
);

COMMENT ON TABLE health_metrics IS 'Time-series health metrics for system components';
COMMENT ON COLUMN health_metrics.id IS 'Auto-incrementing metric record identifier';
COMMENT ON COLUMN health_metrics.component IS 'Component name (e.g., database, bots, channels, workers)';
COMMENT ON COLUMN health_metrics.metric IS 'Metric name (e.g., latency_ms, error_rate, queue_depth)';
COMMENT ON COLUMN health_metrics.value IS 'Numeric metric value';
COMMENT ON COLUMN health_metrics.timestamp IS 'When this metric was recorded';

-- ============================================================================
-- Indexes for efficient metric queries
-- ============================================================================

-- Composite index for component+metric lookups ordered by time (most common query)
CREATE INDEX IF NOT EXISTS idx_hm_component_metric_ts
  ON health_metrics(component, metric, timestamp DESC);

-- Index for time-range queries across all components
CREATE INDEX IF NOT EXISTS idx_hm_timestamp ON health_metrics(timestamp DESC);

-- Index for per-component lookups ordered by time
CREATE INDEX IF NOT EXISTS idx_hm_component_ts ON health_metrics(component, timestamp DESC);

-- ============================================================================
-- Record this migration
-- ============================================================================

INSERT INTO schema_migrations (version, name)
VALUES (10, '010_health_metrics.sql')
ON CONFLICT (version) DO NOTHING;
