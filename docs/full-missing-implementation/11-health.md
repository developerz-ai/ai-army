# Missing: Health Monitoring

**Status:** ❌ Not Implemented
**Priority:** Low
**Design Doc:** [docs/idea/01-architecture.md](../idea/01-architecture.md) (Health section)

## What's Missing

### 1. Health Monitor

```javascript
// src/monitoring/health-monitor.js - NOT IMPLEMENTED
class HealthMonitor {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    this.checks = new Map();
    this.status = new Map();
  }

  registerCheck(name, checkFn, intervalMs) {
    this.checks.set(name, {
      fn: checkFn,
      interval: intervalMs
    });
  }

  async runChecks() {
    const results = {};
    for (const [name, check] of this.checks) {
      results[name] = await check.fn();
    }
    return results;
  }

  async start() {
    // Run checks periodically
  }
}
```

### 2. Health Checks

**System checks:**
```javascript
async checkDatabase() {
  try {
    await storage.query('SELECT 1');
    return { status: 'healthy', latency: 5 };
  } catch (err) {
    return { status: 'unhealthy', error: err.message };
  }
}

async checkBots() {
  const bots = botManager.listBots();
  const running = bots.filter(b => b.status === 'running').length;
  return {
    status: running > 0 ? 'healthy' : 'degraded',
    running,
    total: bots.length
  };
}

async checkChannels() {
  const channels = Array.from(orchestrator.channels.values());
  const healthy = channels.filter(c => c.isConnected?.()).length;
  return {
    status: healthy === channels.length ? 'healthy' : 'degraded',
    healthy,
    total: channels.length
  };
}

async checkWorkers() {
  // Check if workers are reachable
  // Check Docker connectivity
  // Check container health
}

async checkMCP() {
  // Check if MCP servers are running
  // Check if tools are available
}
```

### 3. Health Endpoint

```javascript
// GET /health
{
  "status": "healthy",  // healthy | degraded | unhealthy
  "timestamp": "2026-02-06T10:30:00Z",
  "uptime": 86400,
  "checks": {
    "database": {
      "status": "healthy",
      "latency": 5
    },
    "bots": {
      "status": "healthy",
      "running": 4,
      "total": 5
    },
    "channels": {
      "status": "healthy",
      "connected": 3,
      "total": 3
    },
    "workers": {
      "status": "healthy",
      "available": 2,
      "total": 2
    }
  }
}
```

### 4. Alerting

**Not implemented:**
```javascript
class Alerter {
  async alert(check, status) {
    if (status === 'unhealthy') {
      // Send alert to configured channels
      // Email, Slack, PagerDuty, etc.
    }
  }
}
```

**Configuration:**
```json
{
  "monitoring": {
    "enabled": true,
    "interval": 30000,
    "alerts": {
      "slack": {
        "webhook": "${SLACK_ALERT_WEBHOOK}",
        "channel": "#ops-alerts"
      },
      "email": {
        "to": "ops@example.com",
        "from": "alerts@example.com"
      }
    }
  }
}
```

### 5. Metrics Collection

**Time-series metrics:**
```sql
CREATE TABLE health_metrics (
  component TEXT NOT NULL,
  metric TEXT NOT NULL,
  value FLOAT NOT NULL,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (component, metric, timestamp)
);
```

**Tracked metrics:**
- Database latency
- Bot response times
- Queue depths
- Container CPU/memory
- Channel message rates

### 6. Dashboard Data

**Aggregate metrics for dashboard:**
```javascript
async getDashboardData() {
  return {
    uptime: this.getUptime(),
    bots: this.getBotStats(),
    messages: this.getMessageStats(),
    queue: this.getQueueStats(),
    errors: this.getErrorStats(),
    performance: this.getPerformanceStats()
  };
}
```

## Current State

**What Works:**
- Basic status in `Orchestrator.getStatus()`
- CLI `status` command

**What Doesn't Work:**
- Continuous health monitoring
- Health checks per component
- Alerting on unhealthy state
- Metrics collection
- Dashboard API
- Historical health data

## Implementation Path

### Step 1: Health Monitor Core
1. Create `HealthMonitor` class
2. Register built-in checks
3. Run checks periodically
4. Store results

### Step 2: Component Checks
1. Implement database health check
2. Implement bot health check
3. Implement channel health check
4. Implement worker health check

### Step 3: Health Endpoint
1. Add `/health` endpoint to API
2. Return aggregated health status
3. Test health endpoint
4. Add to load balancer checks

### Step 4: Metrics Storage
1. Create health_metrics table
2. Store check results
3. Query for historical data
4. Add retention policy

### Step 5: Alerting
1. Implement Alerter class
2. Support Slack webhooks
3. Support email alerts
4. Test alert delivery

### Step 6: Dashboard API
1. Create dashboard data endpoint
2. Aggregate metrics
3. Return time-series data
4. Test dashboard queries

## Files to Create

```
src/monitoring/health-monitor.js
src/monitoring/health-checks.js
src/monitoring/alerter.js
src/monitoring/metrics-collector.js
src/api/routers/health-router.js
test/unit/health-monitor.test.js
migrations/017_health_metrics.sql
```

## Configuration Example

```json
{
  "monitoring": {
    "enabled": true,
    "interval": 30000,
    "checks": {
      "database": { "enabled": true, "timeout": 5000 },
      "bots": { "enabled": true },
      "channels": { "enabled": true },
      "workers": { "enabled": true }
    },
    "alerts": {
      "thresholds": {
        "bot_error_rate": 0.1,
        "queue_depth": 100,
        "response_time_ms": 10000
      },
      "channels": {
        "slack": {
          "webhook": "${SLACK_ALERT_WEBHOOK}"
        }
      }
    }
  }
}
```

## Dependencies

- PostgreSQL (already exists)
- Fetch for webhooks (built-in)
- Email library (nodemailer)

## Complexity: Low-Medium
- Simple health checks
- Straightforward alerting
- Well-defined scope
- Nice-to-have, not critical
