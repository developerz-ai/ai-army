# 🚀 Deployment Guide

Guide for deploying AI Assistants Army from development to production.

## Deployment Paths

```
Day 1     → Single VPS (Master + Worker)
Week 2    → Add Worker VPS
Month 3   → Multiple Masters (HA)
Scale     → Auto-scaling workers
```

## Prerequisites

- ✅ Docker installed
- ✅ PostgreSQL 16+ accessible
- ✅ Node.js 22+ installed
- ✅ Git repository ready
- ✅ API keys for AI providers

## Quick Start (Single VPS)

### 1. Clone Repository

```bash
git clone git@github.com:your-org/my-ai-army.git
cd my-ai-army
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment

```bash
cp .env.example .env
vim .env
```

Add your keys:
```bash
DATABASE_URL=postgresql://ai_army:password@localhost:5432/ai_army
ANTHROPIC_API_KEY=sk-ant-...
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
```

### 4. Create Bot Configuration

```bash
mkdir -p bots/my-bot
```

`bots/my-bot/config.json`:
```json
{
  "id": "my-bot",
  "soul": "./soul.md",
  "provider": "anthropic",
  "model": "claude-sonnet-4-5",
  "channel": "slack-main"
}
```

`bots/my-bot/soul.md`:
```markdown
# My Bot

You are a helpful assistant.
```

### 5. Deploy with Docker Compose

```bash
docker-compose up -d
```

### 6. Verify

```bash
# Check status
docker-compose ps

# Check logs
docker-compose logs -f

# Test bot in Slack
```

## Docker Compose Deployment

### `docker-compose.yml`

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
      - postgres-data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ai_army"]
      interval: 10s
      timeout: 5s
      retries: 5

  master:
    build: .
    command: npm start
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://ai_army:${DB_PASSWORD}@postgres:5432/ai_army
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      SLACK_BOT_TOKEN: ${SLACK_BOT_TOKEN}
      SLACK_APP_TOKEN: ${SLACK_APP_TOKEN}
    volumes:
      - ./config.json:/app/config.json
      - ./bots:/app/bots
      - ./data:/app/data
      - /var/run/docker.sock:/var/run/docker.sock  # For container management
    ports:
      - "3000:3000"  # REST API (if enabled)
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped

volumes:
  postgres-data:
```

### `Dockerfile`

```dockerfile
FROM node:22-slim

# Install dependencies for Docker and PostgreSQL client
RUN apt-get update && apt-get install -y \
    docker.io \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --production

# Copy application code
COPY . .

# Create data directory
RUN mkdir -p /app/data

EXPOSE 3000

CMD ["npm", "start"]
```

### Commands

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f master

# Restart master
docker-compose restart master

# Stop all services
docker-compose down

# Stop and remove volumes (⚠️ deletes data)
docker-compose down -v
```

## Systemd Service (Alternative)

### `/etc/systemd/system/ai-army.service`

```ini
[Unit]
Description=AI Assistants Army
After=network.target postgresql.service docker.service
Requires=postgresql.service docker.service

[Service]
Type=simple
User=ai-army
WorkingDirectory=/opt/ai-army
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10

Environment="NODE_ENV=production"
EnvironmentFile=/opt/ai-army/.env

# Logging
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

### Setup

```bash
# Create user
sudo useradd -r -s /bin/bash -d /opt/ai-army ai-army

# Install application
sudo mkdir -p /opt/ai-army
sudo chown ai-army:ai-army /opt/ai-army
sudo -u ai-army git clone <repo> /opt/ai-army
cd /opt/ai-army
sudo -u ai-army npm install

# Configure
sudo -u ai-army cp .env.example .env
sudo -u ai-army vim .env

# Add user to docker group
sudo usermod -aG docker ai-army

# Install service
sudo cp ai-army.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable ai-army
sudo systemctl start ai-army

# Check status
sudo systemctl status ai-army
sudo journalctl -u ai-army -f
```

## Adding Worker Servers

### Worker Configuration

Add to `workers.json`:

```json
{
  "workers": [
    {
      "id": "local",
      "type": "local",
      "maxContainers": 5,
      "dataPath": "/app/data"
    },
    {
      "id": "worker-1",
      "type": "remote",
      "host": "192.168.1.100",
      "port": 22,
      "user": "deploy",
      "keyPath": "/home/ai-army/.ssh/id_rsa",
      "maxContainers": 10,
      "dataPath": "/home/deploy/ai-army/data"
    }
  ]
}
```

### Worker Server Setup

On worker machine:

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Create user
sudo useradd -r -s /bin/bash -d /home/deploy deploy
sudo usermod -aG docker deploy

# Setup SSH key
sudo -u deploy mkdir -p /home/deploy/.ssh
sudo -u deploy ssh-keygen -t rsa -b 4096 -N "" -f /home/deploy/.ssh/id_rsa

# Copy public key to master
cat /home/deploy/.ssh/id_rsa.pub
# Add to master's authorized_keys

# Create data directory
sudo -u deploy mkdir -p /home/deploy/ai-army/data
```

On master:

```bash
# Copy worker private key
mkdir -p ~/.ssh
vim ~/.ssh/worker-1.key  # Paste private key
chmod 600 ~/.ssh/worker-1.key

# Test connection
ssh -i ~/.ssh/worker-1.key deploy@192.168.1.100

# Update workers.json with keyPath
```

## High Availability (Multiple Masters)

### Architecture

```
                Load Balancer (HAProxy/nginx)
                           |
        +------------------+------------------+
        |                  |                  |
    Master 1          Master 2           Master 3
   (Slack)           (Discord)           (REST)
        |                  |                  |
        +------------------+------------------+
                           |
                   PostgreSQL (RDS)
                           |
        +------------------+------------------+
        |                  |                  |
    Worker 1           Worker 2           Worker N
```

### Load Balancer Configuration

#### HAProxy (`/etc/haproxy/haproxy.cfg`)

```
frontend ai_army_frontend
    bind *:80
    mode http

    # Route based on hostname
    acl is_slack hdr(host) -i slack.ai-army.example.com
    acl is_discord hdr(host) -i discord.ai-army.example.com
    acl is_api hdr(host) -i api.ai-army.example.com

    use_backend slack_backend if is_slack
    use_backend discord_backend if is_discord
    use_backend api_backend if is_api

backend slack_backend
    mode http
    balance roundrobin
    server master1 10.0.1.10:3000 check

backend discord_backend
    mode http
    balance roundrobin
    server master2 10.0.1.11:3000 check

backend api_backend
    mode http
    balance roundrobin
    server master3 10.0.1.12:3000 check
    server master4 10.0.1.13:3000 check
```

#### nginx

```nginx
upstream slack_backend {
    server 10.0.1.10:3000;
}

upstream discord_backend {
    server 10.0.1.11:3000;
}

upstream api_backend {
    least_conn;
    server 10.0.1.12:3000;
    server 10.0.1.13:3000;
}

server {
    listen 80;
    server_name slack.ai-army.example.com;
    location / {
        proxy_pass http://slack_backend;
    }
}

server {
    listen 80;
    server_name discord.ai-army.example.com;
    location / {
        proxy_pass http://discord_backend;
    }
}

server {
    listen 80;
    server_name api.ai-army.example.com;
    location / {
        proxy_pass http://api_backend;
    }
}
```

### Shared PostgreSQL

Use managed database:

```bash
# AWS RDS
DATABASE_URL=postgresql://user:pass@ai-army.abc123.us-east-1.rds.amazonaws.com:5432/ai_army

# Google Cloud SQL
DATABASE_URL=postgresql://user:pass@/ai_army?host=/cloudsql/project:region:instance

# Digital Ocean Managed Database
DATABASE_URL=postgresql://user:pass@db-postgresql-nyc1-12345.ondigitalocean.com:25060/ai_army?sslmode=require
```

## Production Checklist

### Security

- [ ] Use HTTPS everywhere
- [ ] Rotate API keys regularly
- [ ] Use secret manager (not .env in prod)
- [ ] Enable firewall (only necessary ports)
- [ ] Use SSH keys (not passwords)
- [ ] Enable Docker socket permissions
- [ ] Set up fail2ban
- [ ] Enable audit logging

### Monitoring

- [ ] Set up health checks
- [ ] Configure alerting (PagerDuty, etc.)
- [ ] Set up log aggregation (Loki, CloudWatch)
- [ ] Monitor metrics (Prometheus, Datadog)
- [ ] Set up uptime monitoring
- [ ] Track error rates
- [ ] Monitor queue depths

### Backup

- [ ] Database backups (daily)
- [ ] Bot workspace backups (weekly)
- [ ] Configuration backups (git)
- [ ] Test restore procedures
- [ ] Offsite backup storage

### Performance

- [ ] Enable PostgreSQL connection pooling
- [ ] Set appropriate container limits
- [ ] Configure session compaction
- [ ] Set up CDN (if using REST API)
- [ ] Enable database indexes
- [ ] Monitor slow queries

## Scaling Strategies

### Vertical Scaling

```yaml
# Increase resources per container
services:
  master:
    deploy:
      resources:
        limits:
          cpus: '4.0'
          memory: 8G
        reservations:
          cpus: '2.0'
          memory: 4G
```

### Horizontal Scaling (Workers)

```bash
# Add more worker VPS machines
# Update workers.json with new workers
# Workers automatically join pool
```

### Database Scaling

```bash
# Read replicas for analytics
DATABASE_URL=postgresql://primary/ai_army
DATABASE_REPLICA_URL=postgresql://replica/ai_army

# Use replica for read queries
const analytics = await db_replica.query('SELECT ...');
```

## Monitoring & Alerting

### Health Endpoints

```javascript
// GET /health
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime": 86400,
  "components": {
    "database": "healthy",
    "workers": "healthy",
    "bots": "healthy"
  }
}

// GET /metrics (Prometheus format)
ai_army_bots_total 5
ai_army_messages_processed_total{bot="support"} 1234
ai_army_queue_depth{bot="support"} 2
```

### Alerting Rules

```yaml
# PagerDuty integration
alerts:
  - name: "High Error Rate"
    condition: error_rate > 0.05
    severity: critical

  - name: "Queue Depth High"
    condition: queue_depth > 100
    severity: warning

  - name: "Worker Down"
    condition: worker_status != "healthy"
    severity: critical
```

## Troubleshooting

### Common Issues

#### Master Won't Start

```bash
# Check logs
docker-compose logs master

# Common causes:
- Database connection failed
- Invalid configuration
- Missing environment variables
```

#### Bot Container Won't Start

```bash
# Check container logs
docker logs ai-army-{bot-id}

# Common causes:
- Image not found
- Resource limits too low
- Mount path doesn't exist
```

#### Worker Connection Failed

```bash
# Test SSH connection
ssh -i ~/.ssh/worker.key deploy@worker-host

# Check Docker socket
ssh -i ~/.ssh/worker.key deploy@worker-host docker ps

# Check firewall
ssh -i ~/.ssh/worker.key deploy@worker-host sudo ufw status
```

## Next Steps

- 📖 See [Configuration Guide](./configuration.md) for config options
- 🏗️ See [Architecture Guide](./architecture.md) for system design
- 💻 See [Development Guide](./development.md) for local development
