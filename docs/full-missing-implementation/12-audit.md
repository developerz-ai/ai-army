# Missing: Audit Logging

**Status:** ❌ Not Implemented
**Priority:** Low
**Design Doc:** Mentioned in [docs/idea/13-database-and-orchestration.md](../idea/13-database-and-orchestration.md)

## What's Missing

### 1. Audit Logger

```javascript
// src/audit/audit-logger.js - NOT IMPLEMENTED
class AuditLogger {
  async log(event) {
    await this.storage.insertAuditLog({
      event_type: event.type,
      actor: event.actor,
      resource: event.resource,
      action: event.action,
      metadata: event.metadata,
      timestamp: new Date()
    });
  }

  async query(filters) {
    // Query audit logs by filters
  }

  async exportLogs(startDate, endDate) {
    // Export logs for compliance
  }
}
```

### 2. Database Schema

```sql
CREATE TABLE audit_log (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  actor_type TEXT DEFAULT 'user',
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  action TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  ip_address TEXT,
  user_agent TEXT,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  INDEX idx_actor (actor),
  INDEX idx_resource (resource_type, resource_id),
  INDEX idx_timestamp (timestamp)
);
```

### 3. Event Types to Log

**Bot operations:**
- `bot.created`
- `bot.started`
- `bot.stopped`
- `bot.deleted`
- `bot.config_updated`
- `bot.soul_updated`

**Message operations:**
- `message.received`
- `message.sent`
- `message.queued`
- `message.failed`

**Tool operations:**
- `tool.executed`
- `tool.failed`

**Admin operations:**
- `config.reloaded`
- `instance.created`
- `instance.deleted`
- `worker.registered`
- `worker.unregistered`

**Security events:**
- `auth.login_success`
- `auth.login_failed`
- `auth.token_created`
- `auth.unauthorized_access`

### 4. Audit Context

**Track who/what/when/where:**
```javascript
const auditContext = {
  actor: 'user123',
  actorType: 'user',
  ipAddress: '192.168.1.100',
  userAgent: 'Mozilla/5.0...',
  resourceType: 'bot',
  resourceId: 'work-bot',
  action: 'started',
  metadata: {
    previousStatus: 'stopped',
    newStatus: 'running'
  }
};
```

### 5. Query Interface

```javascript
// Query audit logs
const logs = await auditLogger.query({
  actor: 'user123',
  startDate: '2026-02-01',
  endDate: '2026-02-06',
  eventTypes: ['bot.started', 'bot.stopped'],
  limit: 100
});
```

### 6. API Endpoints

**Not implemented:**
```javascript
// GET /api/audit - Query audit logs
// GET /api/audit/export - Export logs (CSV/JSON)
// GET /api/audit/stats - Audit statistics
```

**Example:**
```bash
curl "http://localhost:3000/api/audit?actor=user123&limit=50"
```

### 7. Retention Policy

**Auto-delete old logs:**
```javascript
class AuditRetention {
  async cleanOldLogs(retentionDays) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);

    await this.storage.query(`
      DELETE FROM audit_log
      WHERE timestamp < $1
    `, [cutoff]);
  }
}
```

**Configuration:**
```json
{
  "audit": {
    "enabled": true,
    "retention": {
      "enabled": true,
      "days": 90
    },
    "export": {
      "enabled": true,
      "schedule": "0 0 1 * *",
      "format": "json",
      "destination": "s3://bucket/audit-logs/"
    }
  }
}
```

### 8. Compliance Features

**GDPR/SOC2 requirements:**
- User consent tracking
- Data access logs
- Deletion logs
- Export capabilities
- Immutable audit trail

## Current State

**What Works:**
- Nothing related to audit logging

**What Doesn't Work:**
- No audit trail
- No event logging
- No compliance support
- No audit queries

## Implementation Path

### Step 1: Database Schema
1. Create `audit_log` table
2. Create indexes
3. Test insertions

### Step 2: Audit Logger
1. Implement `AuditLogger` class
2. Add `log()` method
3. Test logging
4. Wire into Orchestrator

### Step 3: Event Instrumentation
1. Add audit logs to BotManager
2. Add audit logs to MessageProcessor
3. Add audit logs to Orchestrator
4. Add audit logs to API endpoints

### Step 4: Query Interface
1. Implement query filters
2. Add pagination
3. Test queries
4. Optimize performance

### Step 5: API Endpoints
1. Create AuditRouter
2. Implement query endpoint
3. Implement export endpoint
4. Add authentication

### Step 6: Retention
1. Implement retention policy
2. Schedule cleanup job
3. Test old log deletion
4. Document retention settings

### Step 7: Export
1. Implement CSV export
2. Implement JSON export
3. Support S3/file destinations
4. Test export functionality

## Files to Create

```
src/audit/audit-logger.js
src/audit/audit-retention.js
src/audit/audit-exporter.js
src/api/routers/audit-router.js
test/unit/audit-logger.test.js
test/integration/audit-logging.test.js
migrations/018_audit_log.sql
```

## Configuration Example

```json
{
  "audit": {
    "enabled": true,
    "events": {
      "bot": true,
      "message": true,
      "tool": true,
      "admin": true,
      "security": true
    },
    "retention": {
      "enabled": true,
      "days": 90
    },
    "export": {
      "enabled": true,
      "format": "json",
      "destination": "file:///var/log/ai-army/audit"
    }
  }
}
```

## Query Examples

```javascript
// Get all bot operations by a user
await auditLogger.query({
  actor: 'user123',
  resourceType: 'bot',
  limit: 50
});

// Get all failed operations
await auditLogger.query({
  action: 'failed',
  startDate: '2026-02-01'
});

// Get security events
await auditLogger.query({
  eventTypes: [
    'auth.login_failed',
    'auth.unauthorized_access'
  ]
});
```

## Dependencies

- PostgreSQL (already exists)
- CSV library (if exporting CSV)

## Compliance Benefits

1. **SOC 2**: Audit trail for all operations
2. **GDPR**: Track data access and deletions
3. **HIPAA**: Log access to sensitive data
4. **ISO 27001**: Security event logging

## Complexity: Low
- Straightforward database logging
- Simple query interface
- Well-defined event types
- Not critical for MVP
