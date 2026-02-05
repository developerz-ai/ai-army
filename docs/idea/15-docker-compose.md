# Docker Compose - Easy Deployment

## Overview

Deploy the entire **AI Assistants Army** with a single command:

```bash
docker-compose up -d
```

This starts:
- PostgreSQL database
- Master server(s)
- Worker server(s) (optional)
- Supporting services (Redis, monitoring)

## Basic docker-compose.yml

### Minimal Setup (1 server)

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: ai_army
      POSTGRES_USER: ai_army
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./migrations:/docker-entrypoint-initdb.d
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ai_army"]
      interval: 10s
      timeout: 5s
      retries: 5

  master:
    build: .
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgres://ai_army:${DB_PASSWORD}@postgres:5432/ai_army
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      SLACK_BOT_TOKEN: ${SLACK_BOT_TOKEN}
      SLACK_APP_TOKEN: ${SLACK_APP_TOKEN}
    volumes:
      - ./config:/app/config:ro
      - ./bots:/app/bots:ro
      - ./skills:/app/skills:ro
      - bot_data:/app/data
      - /var/run/docker.sock:/var/run/docker.sock  # Access to Docker
    ports:
      - "3000:3000"  # REST API
    restart: unless-stopped

volumes:
  postgres_data:
  bot_data:
```

### Full Setup (Master + Workers)

```yaml
version: '3.8'

services:
  # Database
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: ai_army
      POSTGRES_USER: ai_army
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./migrations:/docker-entrypoint-initdb.d
    networks:
      - ai_army_net
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ai_army"]
      interval: 10s

  # Redis (optional - for caching/pubsub)
  redis:
    image: redis:7-alpine
    networks:
      - ai_army_net
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s

  # Master server
  master:
    build:
      context: .
      dockerfile: Dockerfile.master
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      NODE_ENV: production
      DATABASE_URL: postgres://ai_army:${DB_PASSWORD}@postgres:5432/ai_army
      REDIS_URL: redis://redis:6379

      # Secrets
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      OPENROUTER_API_KEY: ${OPENROUTER_API_KEY}
      SLACK_BOT_TOKEN: ${SLACK_BOT_TOKEN}
      SLACK_APP_TOKEN: ${SLACK_APP_TOKEN}
      DISCORD_BOT_TOKEN: ${DISCORD_BOT_TOKEN}
      GITHUB_TOKEN: ${GITHUB_TOKEN}

      # Bitwarden (optional)
      BW_ACCESS_TOKEN: ${BW_ACCESS_TOKEN}
      BW_ORG_ID: ${BW_ORG_ID}
    volumes:
      - ./config:/app/config:ro
      - ./bots:/app/bots:ro
      - ./skills:/app/skills:ro
      - bot_data:/app/data
      - /var/run/docker.sock:/var/run/docker.sock
    ports:
      - "3000:3000"
    networks:
      - ai_army_net
    restart: unless-stopped

  # Worker (local)
  worker-local:
    build:
      context: .
      dockerfile: Dockerfile.worker
    depends_on:
      - master
    environment:
      WORKER_ID: local
      MASTER_URL: http://master:3000
      DATABASE_URL: postgres://ai_army:${DB_PASSWORD}@postgres:5432/ai_army
    volumes:
      - bot_data:/app/data
      - /var/run/docker.sock:/var/run/docker.sock
    networks:
      - ai_army_net
    restart: unless-stopped

  # Monitoring (optional)
  prometheus:
    image: prom/prometheus:latest
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus_data:/prometheus
    ports:
      - "9090:9090"
    networks:
      - ai_army_net

  grafana:
    image: grafana/grafana:latest
    depends_on:
      - prometheus
    environment:
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_PASSWORD}
    volumes:
      - grafana_data:/var/lib/grafana
      - ./monitoring/grafana/dashboards:/etc/grafana/provisioning/dashboards
    ports:
      - "3001:3000"
    networks:
      - ai_army_net

networks:
  ai_army_net:
    driver: bridge

volumes:
  postgres_data:
  bot_data:
  prometheus_data:
  grafana_data:
```

## Dockerfile Examples

### Dockerfile.master

```dockerfile
FROM node:22-slim

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci --production

# Copy application
COPY src ./src
COPY tsconfig.json ./

# Build TypeScript
RUN npm run build

# Run migrations on startup
COPY migrations ./migrations
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
```

### docker-entrypoint.sh

```bash
#!/bin/bash
set -e

echo "Waiting for database..."
until pg_isready -h postgres -p 5432 -U ai_army; do
  sleep 1
done

echo "Running migrations..."
npm run migrate

echo "Starting master server..."
exec "$@"
```

### Dockerfile.worker

```dockerfile
FROM node:22-slim

WORKDIR /app

# Install Docker CLI (worker manages containers)
RUN apt-get update && apt-get install -y \
    docker.io \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --production

COPY src ./src
RUN npm run build

CMD ["node", "dist/worker.js"]
```

## Environment Variables

### .env file

```bash
# Database
DB_PASSWORD=your_secure_password

# AI Providers
ANTHROPIC_API_KEY=sk-ant-...
OPENROUTER_API_KEY=sk-or-...

# Channels
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
DISCORD_BOT_TOKEN=...

# Integrations
GITHUB_TOKEN=ghp_...
LINEAR_API_KEY=lin_api_...
NOTION_TOKEN=secret_...

# Secrets Manager (optional)
BW_ACCESS_TOKEN=...
BW_ORG_ID=...

# Monitoring (optional)
GRAFANA_PASSWORD=admin
```

### .env.example

Commit this (without actual values):

```bash
# Database
DB_PASSWORD=

# AI Providers
ANTHROPIC_API_KEY=
OPENROUTER_API_KEY=

# Channels - Slack
SLACK_BOT_TOKEN=
SLACK_APP_TOKEN=

# Channels - Discord
DISCORD_BOT_TOKEN=

# Integrations
GITHUB_TOKEN=
```

## Database Migrations

```
migrations/
├── 001_initial_schema.sql
├── 002_add_templates.sql
├── 003_add_restrictions.sql
└── 004_add_metrics.sql
```

### 001_initial_schema.sql

```sql
CREATE TABLE IF NOT EXISTS bots (
  id TEXT PRIMARY KEY,
  template_id TEXT,
  name TEXT NOT NULL,
  config JSONB NOT NULL,
  status TEXT NOT NULL,
  worker_id TEXT,
  container_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  channel_type TEXT NOT NULL,
  messages JSONB[] DEFAULT ARRAY[]::jsonb[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_message_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES bots(id),
  task TEXT NOT NULL,
  status TEXT NOT NULL,
  priority INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bots_status ON bots(status);
CREATE INDEX idx_sessions_bot ON sessions(bot_id);
CREATE INDEX idx_tasks_status ON tasks(status, priority DESC);
```

## Deployment Commands

### First Time Setup

```bash
# 1. Clone repository
git clone https://github.com/yourorg/ai-assistants-army.git
cd ai-assistants-army

# 2. Copy env template
cp .env.example .env
vim .env  # Fill in your secrets

# 3. Create bot configs
mkdir -p config/bots/my-first-bot
cat > config/bots/my-first-bot/config.json << EOF
{
  "soul": "./soul.md",
  "provider": "anthropic",
  "model": "claude-sonnet-4-5",
  "channel": {"type": "slack", "botToken": "\${SLACK_BOT_TOKEN}"}
}
EOF

cat > config/bots/my-first-bot/soul.md << EOF
You are a helpful assistant.
EOF

# 4. Start everything
docker-compose up -d

# 5. Check logs
docker-compose logs -f master
```

### Daily Operations

```bash
# View logs
docker-compose logs -f master

# Restart a service
docker-compose restart master

# Scale workers
docker-compose up -d --scale worker-local=3

# Update configuration
vim config/bots/work/config.json
docker-compose restart master  # Hot reload

# Check database
docker-compose exec postgres psql -U ai_army -d ai_army
```

### Updates

```bash
# Pull latest code
git pull

# Rebuild containers
docker-compose build

# Restart (graceful)
docker-compose up -d

# Or zero-downtime with multiple masters:
docker-compose up -d --no-deps --build master-2
# Wait for health check
docker-compose up -d --no-deps --build master-1
```

## Production docker-compose.yml

For production, use Docker Swarm or Kubernetes, but here's a production-ready compose file:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: ai_army
      POSTGRES_USER: ai_army
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - /data/postgres:/var/lib/postgresql/data
      - ./migrations:/docker-entrypoint-initdb.d
    networks:
      - ai_army_net
    deploy:
      resources:
        limits:
          memory: 4G
        reservations:
          memory: 2G
    logging:
      driver: "json-file"
      options:
        max-size: "100m"
        max-file: "3"

  master:
    build: .
    depends_on:
      - postgres
    environment:
      DATABASE_URL: postgres://ai_army:${DB_PASSWORD}@postgres:5432/ai_army
    volumes:
      - ./config:/app/config:ro
      - ./bots:/app/bots:ro
      - /data/bots:/app/data
      - /var/run/docker.sock:/var/run/docker.sock
    networks:
      - ai_army_net
    deploy:
      replicas: 2  # Multiple masters for HA
      resources:
        limits:
          memory: 2G
      restart_policy:
        condition: on-failure
        max_attempts: 3
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  nginx:
    image: nginx:alpine
    depends_on:
      - master
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    ports:
      - "80:80"
      - "443:443"
    networks:
      - ai_army_net

networks:
  ai_army_net:
    driver: overlay  # For Docker Swarm

volumes:
  postgres_data:
    driver: local
```

## Remote Workers via Docker Compose

Workers can run on different machines:

**worker-machine/docker-compose.yml:**

```yaml
version: '3.8'

services:
  worker:
    image: yourorg/ai-army-worker:latest
    environment:
      WORKER_ID: gpu-server-1
      MASTER_URL: https://master.example.com
      WORKER_TOKEN: ${WORKER_TOKEN}
    volumes:
      - /data/bots:/app/data
      - /var/run/docker.sock:/var/run/docker.sock
    restart: unless-stopped
```

Workers register with master on startup, pull tasks from PostgreSQL queue.

## Scaling with Docker Compose

### Horizontal Scaling

```bash
# Scale workers
docker-compose up -d --scale worker=5

# Scale masters (requires load balancer)
docker-compose up -d --scale master=3
```

### Resource Limits

```yaml
services:
  master:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 4G
        reservations:
          cpus: '1'
          memory: 2G
```

## Monitoring Stack

Add Prometheus + Grafana:

```yaml
services:
  prometheus:
    image: prom/prometheus:latest
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus_data:/prometheus
    ports:
      - "9090:9090"
    networks:
      - ai_army_net
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'

  grafana:
    image: grafana/grafana:latest
    depends_on:
      - prometheus
    environment:
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_PASSWORD}
      GF_INSTALL_PLUGINS: grafana-piechart-panel
    volumes:
      - grafana_data:/var/lib/grafana
      - ./monitoring/grafana/dashboards:/etc/grafana/provisioning/dashboards
      - ./monitoring/grafana/datasources:/etc/grafana/provisioning/datasources
    ports:
      - "3001:3000"
    networks:
      - ai_army_net

  node-exporter:
    image: prom/node-exporter:latest
    volumes:
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /:/rootfs:ro
    command:
      - '--path.procfs=/host/proc'
      - '--path.sysfs=/host/sys'
      - '--collector.filesystem.mount-points-exclude=^/(sys|proc|dev|host|etc)($$|/)'
    networks:
      - ai_army_net
```

## Complete Production Stack

```yaml
version: '3.8'

services:
  # Core
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: ai_army
      POSTGRES_USER: ai_army
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./migrations:/docker-entrypoint-initdb.d
    networks:
      - ai_army_net

  redis:
    image: redis:7-alpine
    networks:
      - ai_army_net

  # Application
  master:
    build: .
    depends_on:
      - postgres
      - redis
    environment:
      DATABASE_URL: postgres://ai_army:${DB_PASSWORD}@postgres:5432/ai_army
      REDIS_URL: redis://redis:6379
    volumes:
      - ./config:/app/config:ro
      - ./bots:/app/bots:ro
      - /data/bots:/app/data
      - /var/run/docker.sock:/var/run/docker.sock
    networks:
      - ai_army_net
    deploy:
      replicas: 2
      restart_policy:
        condition: on-failure

  worker:
    build:
      context: .
      dockerfile: Dockerfile.worker
    depends_on:
      - postgres
    environment:
      DATABASE_URL: postgres://ai_army:${DB_PASSWORD}@postgres:5432/ai_army
    volumes:
      - /data/bots:/app/data
      - /var/run/docker.sock:/var/run/docker.sock
    networks:
      - ai_army_net
    deploy:
      replicas: 3
      restart_policy:
        condition: on-failure

  # Load Balancer
  nginx:
    image: nginx:alpine
    depends_on:
      - master
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/nginx/ssl:ro
    ports:
      - "80:80"
      - "443:443"
    networks:
      - ai_army_net

  # Monitoring
  prometheus:
    image: prom/prometheus:latest
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus_data:/prometheus
    networks:
      - ai_army_net

  grafana:
    image: grafana/grafana:latest
    environment:
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_PASSWORD}
    volumes:
      - grafana_data:/var/lib/grafana
      - ./monitoring/grafana:/etc/grafana/provisioning
    ports:
      - "3001:3000"
    networks:
      - ai_army_net

  # Logging
  loki:
    image: grafana/loki:latest
    volumes:
      - loki_data:/loki
    networks:
      - ai_army_net

  promtail:
    image: grafana/promtail:latest
    volumes:
      - /var/log:/var/log:ro
      - ./monitoring/promtail.yml:/etc/promtail/config.yml
    networks:
      - ai_army_net

networks:
  ai_army_net:
    driver: bridge

volumes:
  postgres_data:
  prometheus_data:
  grafana_data:
  loki_data:
```

## Backup Strategy

### Database Backups

```yaml
services:
  backup:
    image: postgres:16
    depends_on:
      - postgres
    environment:
      PGPASSWORD: ${DB_PASSWORD}
    volumes:
      - ./backups:/backups
    entrypoint: |
      bash -c 'while true; do
        pg_dump -h postgres -U ai_army ai_army > /backups/backup_$$(date +%Y%m%d_%H%M%S).sql
        find /backups -name "backup_*.sql" -mtime +7 -delete
        sleep 86400
      done'
```

### Bot Data Backups

```bash
# Backup bot workspaces
docker run --rm -v bot_data:/data -v $(pwd)/backups:/backups \
  alpine tar czf /backups/bot_data_$(date +%Y%m%d).tar.gz /data
```

## Health Checks

### Master Health Endpoint

```javascript
// src/api/health.ts
app.get('/health', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    database: await checkDatabase(),
    bots: await getBotStatus(),
    workers: await getWorkerStatus()
  };

  const isHealthy = health.database.connected &&
                    health.bots.running > 0;

  res.status(isHealthy ? 200 : 503).json(health);
});
```

### Docker Healthcheck

```yaml
services:
  master:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
```

## Quick Start Script

```bash
#!/bin/bash
# setup.sh - Interactive setup

echo "AI Assistants Army - Setup"
echo ""

# Check prerequisites
command -v docker >/dev/null 2>&1 || { echo "Docker required"; exit 1; }
command -v docker-compose >/dev/null 2>&1 || { echo "Docker Compose required"; exit 1; }

# Generate secure passwords
DB_PASSWORD=$(openssl rand -base64 32)
GRAFANA_PASSWORD=$(openssl rand -base64 16)

# Create .env
cat > .env << EOF
DB_PASSWORD=${DB_PASSWORD}
GRAFANA_PASSWORD=${GRAFANA_PASSWORD}
ANTHROPIC_API_KEY=
SLACK_BOT_TOKEN=
SLACK_APP_TOKEN=
EOF

echo "✓ Created .env file"
echo ""
echo "Next steps:"
echo "1. Edit .env and add your API keys"
echo "2. Create your first bot config in config/bots/"
echo "3. Run: docker-compose up -d"
echo "4. Check logs: docker-compose logs -f"
```

## Summary

**Docker Compose makes deployment simple:**

1. One command to start everything: `docker-compose up -d`
2. PostgreSQL for shared state and orchestration
3. Easy to scale: `docker-compose up -d --scale worker=5`
4. Easy to monitor: Built-in Prometheus + Grafana
5. Easy to backup: PostgreSQL dumps + volume backups
6. Easy to update: `git pull && docker-compose up -d --build`

**Start local, deploy anywhere:**
- Development: `docker-compose up` on laptop
- Production: Same file on cloud VM
- High availability: Multiple masters + workers
