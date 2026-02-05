# Deployment Strategy - Scale from 1 VPS to Many

## Overview

**Start simple, scale when needed.**

The deployment model:
1. **Day 1**: Deploy everything to a single VPS
2. **Growing**: Add more VPS machines as workers when you need capacity
3. **Production**: Multiple VPS machines, all connected via PostgreSQL

Same configuration, same code. Just add more machines.

## Phase 1: Single VPS

Deploy the entire stack on one VPS:

```
┌─────────────────────────────────────────────────┐
│              VPS (8GB RAM, 4 CPU)                │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │PostgreSQL│  │  Master  │  │    Bots      │  │
│  │          │  │  Server  │  │  (Docker)    │  │
│  │          │  │          │  │  - work      │  │
│  │          │  │          │  │  - family    │  │
│  │          │  │          │  │  - devops    │  │
│  └──────────┘  └──────────┘  └──────────────┘  │
│                                                  │
│  /data/postgres/     /data/bots/                │
└─────────────────────────────────────────────────┘
       ↑
       │ HTTPS
       │
   Users (Slack/Discord/REST)
```

### Single VPS Setup

```bash
# On VPS (Ubuntu 24.04)
ssh user@your-vps.com

# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Clone repository
git clone https://github.com/yourorg/ai-assistants-army.git
cd ai-assistants-army

# Setup environment
cp .env.example .env
vim .env  # Add your keys

# Start everything
docker-compose up -d

# That's it!
```

### docker-compose.yml (Single VPS)

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
    restart: unless-stopped

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
    ports:
      - "3000:3000"
    restart: unless-stopped

volumes:
  postgres_data:
```

**Capacity**: Can run 3-5 bots comfortably on 8GB RAM.

## Phase 2: Add Worker VPS

When you hit resource limits, add worker VPS:

```
┌─────────────────────────────┐
│      Master VPS              │
│  ┌──────────┐  ┌──────────┐ │
│  │PostgreSQL│  │  Master  │ │
│  └──────────┘  └──────────┘ │
└─────────────────────────────┘
         │
         │ PostgreSQL connection
         │
    ┌────┴────┬────────────┐
    │         │            │
    ▼         ▼            ▼
┌─────────┐ ┌─────────┐ ┌─────────┐
│Worker 1 │ │Worker 2 │ │Worker 3 │
│(local)  │ │(remote) │ │(remote) │
│         │ │         │ │         │
│Bot A,B  │ │Bot C,D  │ │Bot E,F  │
└─────────┘ └─────────┘ └─────────┘
```

### Master VPS

```bash
# On master VPS
cd ai-assistants-army

# Update docker-compose to expose PostgreSQL
vim docker-compose.yml
# Change PostgreSQL port to: "5432:5432"

# Restart
docker-compose up -d
```

### Worker VPS Setup

On each new worker VPS:

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Create worker directory
mkdir ai-army-worker
cd ai-army-worker

# Create docker-compose.yml for worker
cat > docker-compose.yml << 'EOF'
version: '3.8'

services:
  worker:
    image: yourorg/ai-army-worker:latest
    environment:
      WORKER_ID: ${WORKER_ID}
      DATABASE_URL: ${DATABASE_URL}
    volumes:
      - /data/bots:/app/data
      - /var/run/docker.sock:/var/run/docker.sock
    restart: unless-stopped
EOF

# Configure worker
cat > .env << EOF
WORKER_ID=worker-vps-2
DATABASE_URL=postgres://ai_army:PASSWORD@master-vps-ip:5432/ai_army
EOF

# Start worker
docker-compose up -d
```

The worker:
1. Connects to master's PostgreSQL
2. Registers itself in `workers` table
3. Polls `tasks` queue for work
4. Spins up bot containers as needed

### Worker Registration

Worker auto-registers on startup:

```typescript
// Worker startup
async function registerWorker() {
  await db.query(`
    INSERT INTO workers (id, type, host, status, max_containers)
    VALUES ($1, 'remote', $2, 'connected', $3)
    ON CONFLICT (id) DO UPDATE
    SET status = 'connected', last_heartbeat_at = NOW()
  `, [WORKER_ID, os.hostname(), MAX_CONTAINERS]);

  // Heartbeat every 30 seconds
  setInterval(async () => {
    await db.query(`
      UPDATE workers
      SET last_heartbeat_at = NOW()
      WHERE id = $1
    `, [WORKER_ID]);
  }, 30000);
}
```

Master assigns bots to workers based on capacity:

```typescript
// Bot assignment
async function assignBotToWorker(botId) {
  const worker = await db.query(`
    SELECT * FROM workers
    WHERE status = 'connected'
    ORDER BY current_containers ASC
    LIMIT 1
  `);

  if (worker.rows.length === 0) {
    throw new Error('No workers available');
  }

  await db.query(`
    UPDATE bots SET worker_id = $1 WHERE id = $2
  `, [worker.rows[0].id, botId]);

  return worker.rows[0];
}
```

## Phase 3: Production (Multiple Masters)

For high availability, run multiple master servers:

```
┌─────────────┐  ┌─────────────┐
│  Master 1   │  │  Master 2   │
│  (Primary)  │  │  (Backup)   │
└─────────────┘  └─────────────┘
        │                │
        └────────┬───────┘
                 │
         ┌───────────────┐
         │   PostgreSQL  │
         │   (Shared)    │
         └───────────────┘
                 │
    ┌────────────┼────────────┐
    │            │            │
┌─────────┐ ┌─────────┐ ┌─────────┐
│Worker 1 │ │Worker 2 │ │Worker N │
└─────────┘ └─────────┘ └─────────┘
```

Both masters:
- Connect to same PostgreSQL
- Listen to same channels (Slack/Discord)
- Process different sessions (no collision via locks)
- Share task queue

## Scaling Rules

### When to Add Worker VPS

Add a worker when:
- CPU usage > 80% sustained
- Memory usage > 80%
- Message queue depth > 50
- Response latency > 10 seconds

### When to Add Master VPS

Add a master when:
- Channel message rate > 100/second
- REST API requests > 1000/minute
- Need high availability (failover)

### Worker Sizing

| Worker Size | Bot Capacity | Use Case |
|-------------|--------------|----------|
| 2GB RAM, 2 CPU | 2-3 bots | Light use |
| 4GB RAM, 4 CPU | 5-8 bots | Standard |
| 8GB RAM, 8 CPU | 10-15 bots | Heavy use |
| 16GB RAM, 16 CPU | 20-30 bots | High volume |

## Deployment Checklist

### Single VPS Deployment

- [ ] Provision VPS (Ubuntu 24.04, 8GB RAM minimum)
- [ ] Install Docker and Docker Compose
- [ ] Clone repository
- [ ] Configure `.env` with secrets
- [ ] Create bot configs in `bots/*/config.json`
- [ ] Create soul files in `bots/*/soul.md`
- [ ] Run `docker-compose up -d`
- [ ] Check health: `curl localhost:3000/health`
- [ ] Configure firewall (ports 80, 443, 5432 if needed)
- [ ] Setup SSL with Let's Encrypt
- [ ] Configure DNS

### Adding Worker VPS

- [ ] Provision new VPS
- [ ] Install Docker
- [ ] Create worker docker-compose.yml
- [ ] Configure DATABASE_URL to point to master
- [ ] Set unique WORKER_ID
- [ ] Start worker: `docker-compose up -d`
- [ ] Verify in master: Check `workers` table

### PostgreSQL Setup

If using managed PostgreSQL (DigitalOcean, AWS RDS):

```json
{
  "database": {
    "url": "postgres://user:pass@managed-db.example.com:5432/ai_army",
    "ssl": true
  }
}
```

Benefits:
- Automated backups
- High availability
- Scaling without managing DB yourself
- Better performance

## Network Configuration

### Firewall Rules

**Master VPS:**
- `22` (SSH) - from your IP only
- `80` (HTTP) - from anywhere
- `443` (HTTPS) - from anywhere
- `5432` (PostgreSQL) - from worker VPS IPs only
- `3000` (API) - from anywhere or via nginx proxy

**Worker VPS:**
- `22` (SSH) - from your IP only
- Outbound to master:5432 (PostgreSQL)

### VPN Alternative

For better security, connect all VPS via VPN (Tailscale, WireGuard):

```
All VPS in private network: 10.0.0.0/24
Master: 10.0.0.1
Worker 1: 10.0.0.2
Worker 2: 10.0.0.3
```

PostgreSQL only listens on private network. Workers connect via private IPs.

## Cost Estimation

### Single VPS (Starting)

| Provider | Plan | Specs | Cost |
|----------|------|-------|------|
| DigitalOcean | Droplet | 8GB RAM, 4 CPU | $48/month |
| Hetzner | CX31 | 8GB RAM, 2 CPU | €8.50/month |
| Linode | Dedicated | 8GB RAM, 4 CPU | $36/month |

### Scaling (10 bots, high volume)

```
Master VPS:     $48/month  (8GB RAM)
PostgreSQL:     $15/month  (managed)
Worker VPS 1:   $24/month  (4GB RAM)
Worker VPS 2:   $24/month  (4GB RAM)
─────────────────────────────────────
Total:          $111/month
```

Plus AI provider costs (Anthropic, OpenRouter, etc.).

## Zero-Downtime Deployments

### Strategy: Rolling Update

With multiple masters:

```bash
# Update master 1
ssh master-1
cd ai-assistants-army
git pull
docker-compose build
docker-compose up -d

# Wait 1 minute, verify health
curl localhost:3000/health

# Update master 2
ssh master-2
# ... repeat
```

### Strategy: Blue-Green

```bash
# Deploy to "green" environment
docker-compose -f docker-compose.green.yml up -d

# Test green
curl localhost:3001/health

# Switch load balancer
vim nginx.conf  # Point to green
docker-compose restart nginx

# Shutdown blue
docker-compose -f docker-compose.blue.yml down
```

## Monitoring Across VPS

Use Grafana to monitor all VPS from one dashboard:

```yaml
# On each VPS, run node-exporter
docker run -d \
  --name=node-exporter \
  --net="host" \
  prom/node-exporter

# On master, Prometheus scrapes all workers
# prometheus.yml
scrape_configs:
  - job_name: 'masters'
    static_configs:
      - targets: ['master-1:9090', 'master-2:9090']

  - job_name: 'workers'
    static_configs:
      - targets: ['worker-1:9100', 'worker-2:9100', 'worker-3:9100']
```

## Backup & Disaster Recovery

### Automated Backups

```bash
# On master VPS, backup script
#!/bin/bash
# backup.sh

# Backup PostgreSQL
docker-compose exec -T postgres pg_dump -U ai_army ai_army | \
  gzip > /backups/postgres_$(date +%Y%m%d).sql.gz

# Backup bot workspaces
tar czf /backups/bots_$(date +%Y%m%d).tar.gz /data/bots/

# Upload to S3/Backblaze
rclone copy /backups/ remote:ai-army-backups/

# Keep last 30 days
find /backups -name "*.gz" -mtime +30 -delete
```

Run daily via cron:
```
0 2 * * * /root/ai-army/backup.sh
```

### Disaster Recovery

If master VPS dies:

1. **Provision new VPS**
2. **Install Docker**
3. **Clone repo**
4. **Restore database**: `gunzip < postgres_backup.sql.gz | psql`
5. **Restore bot data**: `tar xzf bots_backup.tar.gz -C /`
6. **Update DNS** to point to new master
7. **Start**: `docker-compose up -d`

Workers automatically reconnect to new master (same PostgreSQL).

## Geographic Distribution

Deploy master + workers in different regions:

```
┌─────────────────┐
│  Master (US)    │
│  PostgreSQL     │
└─────────────────┘
         │
    ┌────┼────┬────────┐
    │    │    │        │
    ▼    ▼    ▼        ▼
┌────┐ ┌────┐ ┌────┐ ┌────┐
│US-1│ │US-2│ │EU-1│ │AP-1│
└────┘ └────┘ └────┘ └────┘
```

Route users to nearest worker for low latency.

## Cloud Provider Options

### Option 1: DigitalOcean

**Pros:**
- Simple droplets
- Managed PostgreSQL available
- Private networking built-in
- Good documentation

**Cons:**
- More expensive than Hetzner

### Option 2: Hetzner

**Pros:**
- Very cheap (€8.50/month for 8GB RAM)
- Fast servers
- European data centers

**Cons:**
- No managed PostgreSQL (run your own)
- Limited to Europe

### Option 3: AWS/GCP/Azure

**Pros:**
- Full ecosystem (managed DB, load balancers, monitoring)
- Global regions
- Enterprise features

**Cons:**
- Complex pricing
- Overkill for most use cases

### Option 4: Hybrid

```
Master: Hetzner (cheap, reliable)
PostgreSQL: DigitalOcean Managed DB (backups, HA)
Workers: Hetzner (cheap capacity)
```

Best of both worlds.

## Infrastructure as Code

Define everything in Terraform:

```hcl
# terraform/main.tf

# Master VPS
resource "digitalocean_droplet" "master" {
  name   = "ai-army-master"
  size   = "s-2vcpu-4gb"
  image  = "ubuntu-24-04-x64"
  region = "nyc3"

  user_data = file("cloud-init-master.yml")
}

# Managed PostgreSQL
resource "digitalocean_database_cluster" "postgres" {
  name       = "ai-army-db"
  engine     = "pg"
  version    = "16"
  size       = "db-s-1vcpu-1gb"
  region     = "nyc3"
  node_count = 1
}

# Worker VPS (count = 2)
resource "digitalocean_droplet" "workers" {
  count  = 2
  name   = "ai-army-worker-${count.index + 1}"
  size   = "s-2vcpu-4gb"
  image  = "ubuntu-24-04-x64"
  region = "nyc3"

  user_data = templatefile("cloud-init-worker.yml", {
    worker_id    = "worker-${count.index + 1}"
    database_url = digitalocean_database_cluster.postgres.uri
  })
}
```

Deploy infrastructure:
```bash
terraform init
terraform plan
terraform apply
```

Destroy when done:
```bash
terraform destroy
```

## Auto-Scaling Workers

Automatically add/remove workers based on load:

### Using Cloud Auto-Scaling

```hcl
# AWS Auto Scaling Group
resource "aws_autoscaling_group" "workers" {
  min_size = 1
  max_size = 10
  desired_capacity = 2

  launch_template {
    id = aws_launch_template.worker.id
  }

  # Scale up when queue depth > 50
  # Scale down when queue depth < 10
}
```

### Using Custom Logic

```typescript
// src/autoscaler/index.ts
export class AutoScaler {
  async checkAndScale() {
    const queueDepth = await this.getQueueDepth();
    const workerCount = await this.getWorkerCount();

    if (queueDepth > 50 && workerCount < 10) {
      await this.scaleUp();
    } else if (queueDepth < 10 && workerCount > 2) {
      await this.scaleDown();
    }
  }

  async scaleUp() {
    // Provision new VPS via cloud API
    // Or wake up pre-provisioned worker
  }

  async scaleDown() {
    // Find idle worker
    // Drain its tasks
    // Shut it down
  }
}
```

## Migration Between VPS

Moving from one VPS to another:

```bash
# On old VPS
docker-compose exec postgres pg_dump -U ai_army ai_army > backup.sql
tar czf bots.tar.gz /data/bots/

# Transfer
scp backup.sql new-vps:/tmp/
scp bots.tar.gz new-vps:/tmp/

# On new VPS
cat /tmp/backup.sql | docker-compose exec -T postgres psql -U ai_army
tar xzf /tmp/bots.tar.gz -C /

# Update DNS
# Update worker configs to point to new master

# Start
docker-compose up -d
```

## Summary

**Deployment path:**

1. **Start**: Single VPS, 3-5 bots, docker-compose
2. **Grow**: Add worker VPS machines, connect via PostgreSQL
3. **Scale**: Multiple masters, multiple workers, load balancing
4. **Production**: Managed DB, monitoring, auto-scaling

**Key principle:** Same config, same code, just more machines.

**Easy to:**
- Deploy: `docker-compose up -d`
- Add capacity: Spin up new worker VPS
- Monitor: Grafana dashboard across all machines
- Backup: PostgreSQL dumps + bot data archives
- Migrate: Backup, restore, update DNS

Start with $50/month single VPS, scale to hundreds of bots across multiple regions when needed.
