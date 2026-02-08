-- AI Assistants Army - Templates Schema
-- Migration 005: Templates table for reusable bot configurations
--
-- Templates enable deploying the same bot multiple times with different
-- configurations, supporting horizontal scaling, per-team deployment,
-- per-customer SaaS models, and environment separation.
--
-- PostgreSQL 18+ required
-- Run with: psql -d database_name -f 005_templates.sql

-- ============================================================================
-- Templates Table - Reusable bot configuration definitions
-- ============================================================================

CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,

  config JSONB NOT NULL,                -- Full template configuration (model, tools, etc.)
  soul_template TEXT,                   -- Template soul.md content with {{variable}} placeholders

  version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE templates IS 'Reusable bot configuration templates for multi-instance deployment';
COMMENT ON COLUMN templates.id IS 'Unique template identifier (e.g., support-agent, code-reviewer)';
COMMENT ON COLUMN templates.name IS 'Human-readable template name';
COMMENT ON COLUMN templates.description IS 'What this template is for';
COMMENT ON COLUMN templates.config IS 'Full JSONB configuration: provider, model, tools, mcpServers, restrictions, workspace, sandbox';
COMMENT ON COLUMN templates.soul_template IS 'Soul.md content with {{variable}} placeholders for per-instance customization';
COMMENT ON COLUMN templates.version IS 'Template version number for tracking configuration updates';
COMMENT ON COLUMN templates.created_at IS 'When the template was first created';
COMMENT ON COLUMN templates.updated_at IS 'When the template was last modified';

-- ============================================================================
-- Indexes for template queries
-- ============================================================================

-- Name lookup for CLI and API queries
CREATE INDEX IF NOT EXISTS idx_templates_name ON templates(name);

-- Version tracking for template updates
CREATE INDEX IF NOT EXISTS idx_templates_version ON templates(version);

-- Creation time ordering
CREATE INDEX IF NOT EXISTS idx_templates_created ON templates(created_at);

-- ============================================================================
-- Update Trigger - Automatically update updated_at timestamp
-- ============================================================================

-- Reuse update_updated_at_column() function from 001_initial_schema.sql

-- Drop existing trigger if it exists for idempotency
DROP TRIGGER IF EXISTS templates_updated_at ON templates;

CREATE TRIGGER templates_updated_at
  BEFORE UPDATE ON templates
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Record this migration
-- ============================================================================

INSERT INTO schema_migrations (version, name)
VALUES (5, '005_templates.sql')
ON CONFLICT (version) DO NOTHING;
