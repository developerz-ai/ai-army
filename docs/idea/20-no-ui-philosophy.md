# No UI Philosophy - Configuration, Not Interface

## Overview

**AI Assistants Army has ZERO user interface.**

No web dashboard. No admin panel. No settings page. No monitoring UI.

**Everything is:**
- Configuration files (JSON, Markdown, Dockerfiles)
- REST API endpoints (for programmatic access)
- Database (PostgreSQL for orchestration)
- Logs (stdout, files, PostgreSQL)

## Why No UI?

### 1. Version Control

UIs produce clicks. Config files produce commits.

With config files:
- `git diff` shows exactly what changed
- `git blame` shows who changed it
- `git revert` undoes changes
- Pull requests for bot changes
- Code review for configuration

With UIs:
- Changes happen through clicks
- No audit trail
- Hard to replicate across environments
- Can't review before deploying

### 2. Reproducibility

Config files → deterministic deployments

```bash
# Dev environment
git clone repo
cp .env.example .env
docker-compose up -d
# Exact same bots as production
```

With UIs, replicating configuration requires screenshots, documentation, or manual clicking.

### 3. Automation

Config files → CI/CD pipelines

```yaml
# .github/workflows/deploy.yml
- name: Validate config
  run: npx ai-army validate

- name: Deploy
  run: cap production deploy
```

Can't automate UI clicks.

### 4. Infrastructure as Code

Everything is code:

```
my-ai-army/
├── config.json              # Bot configuration
├── bots/*/soul.md           # Bot personalities
├── docker-compose.yml       # Infrastructure
├── terraform/               # Cloud resources
└── migrations/              # Database schema
```

Check it all into git. Deploy anywhere.

### 5. Simplicity

**UI requires:**
- Frontend framework (React, Vue, etc.)
- Backend API for UI
- Authentication for UI
- UI state management
- Forms, validation, error handling
- Responsive design
- Security (CSRF, XSS, etc.)

**Config files require:**
- Text editor

### 6. Flexibility

Users choose their own tools:
- Text editor: vim, VS Code, nano, whatever
- Deployment: Docker Compose, Kubernetes, Capistrano, Ansible
- Monitoring: Grafana, Datadog, CloudWatch, custom
- Secrets: Bitwarden, 1Password, AWS Secrets Manager, .env files

Framework doesn't force opinions.

## What Instead of UI?

### Configuration → JSON/Markdown Files

Instead of clicking through a "Create Bot" form, you create a directory:

```
bots/my-bot/
├── config.json
├── soul.md
└── Dockerfile (optional)
```

### Monitoring → REST API + External Tools

Instead of a built-in dashboard, query the REST API:

```bash
# Get bot status
curl localhost:3000/api/bots

# Get queue depth
curl localhost:3000/api/queue/status

# Get metrics
curl localhost:3000/api/metrics
```

Feed this into your monitoring tool:
- Grafana (query PostgreSQL directly)
- Datadog
- CloudWatch
- Custom dashboard

### Logs → stdout + PostgreSQL

Instead of a log viewer UI:

```bash
# Docker Compose logs
docker-compose logs -f master

# Or query database
psql -c "SELECT * FROM tool_calls WHERE bot_id = 'work' ORDER BY executed_at DESC LIMIT 10"

# Or your log aggregator
# Loki, Elasticsearch, CloudWatch, Papertrail
```

### Analytics → SQL Queries

Instead of an analytics dashboard:

```sql
-- Most active bots
SELECT bot_id, COUNT(*) as messages
FROM message_queue
WHERE completed_at > NOW() - INTERVAL '24 hours'
GROUP BY bot_id;

-- Tool usage
SELECT tool_name, COUNT(*) as calls
FROM tool_calls
WHERE executed_at > NOW() - INTERVAL '7 days'
GROUP BY tool_name
ORDER BY calls DESC;

-- Error rate
SELECT
  bot_id,
  COUNT(*) FILTER (WHERE success = false)::float / COUNT(*) * 100 as error_rate
FROM tool_calls
GROUP BY bot_id;
```

Feed into Grafana, Metabase, or your BI tool.

### Management → CLI Commands

Instead of clicking "Restart Bot":

```bash
# CLI
npx ai-army restart work-bot

# Or API
curl -X POST localhost:3000/api/bots/work-bot/restart

# Or Docker
docker-compose restart master

# Or systemd
sudo systemctl restart ai-army
```

## REST API for Programmatic Access

For automation and integrations:

### Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/bots` | List all bots |
| GET | `/api/bots/{id}` | Get bot details |
| POST | `/api/bots/{id}/message` | Send message to bot |
| GET | `/api/bots/{id}/status` | Get bot health |
| POST | `/api/bots/{id}/restart` | Restart bot |
| GET | `/api/queue/status` | Queue depth, wait times |
| GET | `/api/workers` | Worker status |
| GET | `/api/metrics` | System metrics |
| GET | `/api/health` | Overall health check |

### Example: Send Message

```bash
curl -X POST http://localhost:3000/api/bots/work/message \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${API_KEY}" \
  -d '{
    "message": "Review PR #42",
    "sessionId": "user-123"
  }'
```

### Example: Get Status

```bash
curl http://localhost:3000/api/bots/work/status

# Response:
{
  "id": "work",
  "status": "running",
  "sessions": 5,
  "queueDepth": 2,
  "uptime": 86400,
  "worker": "local",
  "container": "abc123"
}
```

## Observability

### Logs

Everything goes to stdout (12-factor app):

```bash
# View logs
docker-compose logs -f

# Filter by bot
docker-compose logs -f master | grep "\[work\]"

# Save to file
docker-compose logs > logs.txt
```

Forward to your log aggregator:
- Grafana Loki
- Elasticsearch
- CloudWatch Logs
- Papertrail

### Metrics

Export to Prometheus:

```
GET /metrics

# Output (Prometheus format):
ai_army_bots_total 5
ai_army_bots_running 5
ai_army_messages_processed_total{bot="work"} 1234
ai_army_messages_processed_total{bot="support"} 5678
ai_army_queue_depth{bot="work"} 2
ai_army_tool_calls_total{tool="bash",bot="work"} 890
```

### Traces

Use OpenTelemetry:

```javascript
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('ai-army');

const span = tracer.startSpan('process_message');
// ... process message ...
span.end();
```

Export to Jaeger, Zipkin, or your APM tool.

## Configuration Management

### Local Development

```bash
# Edit config
vim bots/support/soul.md

# Restart
docker-compose restart master

# Test
curl -X POST localhost:3000/api/bots/support/message \
  -d '{"message": "test"}'
```

### Production

```bash
# Edit config
vim bots/support/soul.md

# Commit
git commit -am "Update support bot personality"
git push

# Deploy (CI/CD auto-deploys)
# Or manual:
ssh vps
cd /opt/ai-army
git pull
docker-compose up -d
```

## Debugging

### Check Bot Status

```bash
# Via API
curl localhost:3000/api/bots/work/status

# Via database
psql -c "SELECT * FROM bots WHERE id = 'work'"

# Via Docker
docker ps | grep ai-army-work
```

### Check Logs

```bash
# Application logs
docker-compose logs -f master

# Bot-specific logs
docker-compose logs -f master | grep "\[work\]"

# PostgreSQL logs
docker-compose logs postgres
```

### Check Queue

```bash
# Via API
curl localhost:3000/api/queue/status

# Via database
psql -c "SELECT * FROM message_queue WHERE status = 'queued'"
```

### Check Session

```bash
# Via database
psql -c "SELECT * FROM sessions WHERE id = 'work:slack:C123:U456'"

# View conversation
psql -c "
  SELECT
    msg->>'role' as role,
    msg->>'content' as content
  FROM sessions, unnest(messages) as msg
  WHERE id = 'work:slack:C123:U456'
"
```

## When Users Want a UI

If users want a dashboard, they build their own:

### Option 1: Grafana

Query PostgreSQL directly:

```sql
-- Grafana panel: Active bots
SELECT status, COUNT(*) FROM bots GROUP BY status;

-- Grafana panel: Messages per hour
SELECT
  date_trunc('hour', last_message_at) as hour,
  COUNT(*) as messages
FROM sessions
GROUP BY hour;
```

### Option 2: Custom Dashboard

Build with their preferred stack:

```javascript
// dashboard/app.js
import express from 'express';
import pg from 'pg';

const app = express();
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });

app.get('/dashboard', async (req, res) => {
  const bots = await db.query('SELECT * FROM bots');
  const queueDepth = await db.query('SELECT COUNT(*) FROM message_queue WHERE status = "queued"');

  res.json({
    bots: bots.rows,
    queueDepth: queueDepth.rows[0].count
  });
});

app.listen(3001);
```

### Option 3: Existing Tools

Use off-the-shelf tools:
- Metabase (SQL dashboards)
- Retool (internal tools)
- Superset (data viz)
- Custom React app

All query PostgreSQL directly.

## Benefits of No UI

### Security

No UI = No UI vulnerabilities:
- No XSS attacks
- No CSRF attacks
- No session hijacking
- No clickjacking
- No auth bypass

### Performance

No rendering overhead:
- No React reconciliation
- No DOM updates
- No client-side state
- Pure API/database operations

### Maintenance

No UI = No UI maintenance:
- No frontend deps to update
- No browser compatibility
- No responsive design
- No accessibility concerns

### Deployment

Simpler deployments:
- No asset compilation
- No CDN for static files
- Smaller Docker images
- Faster builds

## The Unix Philosophy

**Do one thing well:**

Framework handles orchestration. Users handle presentation.

- Want a dashboard? Build it or use Grafana.
- Want alerts? Use webhooks to PagerDuty.
- Want logs? Use Loki or CloudWatch.
- Want metrics? Use Prometheus.

Framework stays focused. Users compose tools.

## Summary

**No UI means:**

✅ Everything in version control
✅ Reproducible deployments
✅ CI/CD friendly
✅ Tool-agnostic
✅ Simpler, more secure
✅ Focus on orchestration, not presentation

❌ No clicking through settings
❌ No visual bot builder
❌ No monitoring dashboard

**Users who want UIs:** Build their own or use existing tools (Grafana, Metabase, etc.) that query the PostgreSQL database and REST API.

**Philosophy:** Provide the engine, not the dashboard. Users compose their own stack.
