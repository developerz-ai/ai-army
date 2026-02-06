# Missing: Worker Distribution

**Status:** ❌ Not Implemented
**Priority:** High
**Design Doc:** [docs/idea/01-architecture.md](../idea/01-architecture.md)

## What's Missing

### 1. Worker Registry
```javascript
// src/core/worker-registry.js - NOT IMPLEMENTED
class WorkerRegistry {
  async registerWorker(config)
  async unregisterWorker(workerId)
  async listWorkers()
  async getAvailableWorker(botId)
}
```

**Database Table:**
```sql
CREATE TABLE workers (
  id TEXT PRIMARY KEY,
  host TEXT NOT NULL,
  type TEXT NOT NULL, -- 'local' | 'remote'
  max_containers INT DEFAULT 10,
  current_load INT DEFAULT 0,
  status TEXT DEFAULT 'healthy',
  last_heartbeat TIMESTAMPTZ
);
```

### 2. SSH Tunnel Manager
```javascript
// src/worker/ssh-tunnel.js - NOT IMPLEMENTED
class SSHTunnelManager {
  async createTunnel(workerConfig)
  async closeTunnel(workerId)
  async healthCheck(workerId)
}
```

**Requirements:**
- SSH2 dependency exists but not used
- Forward local port to remote Docker socket
- Handle connection failures and reconnection
- Keep-alive for long-running tunnels

### 3. Worker Assignment
```javascript
// src/core/worker-assigner.js - NOT IMPLEMENTED
class WorkerAssigner {
  async assignBot(botId, workerPreference)
  async rebalance()
  async failover(failedWorkerId)
}
```

**Assignment Logic:**
- Pattern-based assignment (e.g., `devops-*` → GPU worker)
- Load balancing across workers
- Affinity for stateful bots
- Failover when worker goes down

### 4. Configuration Support

**workers.json** - Not supported:
```json
{
  "workers": [
    {
      "id": "local",
      "type": "local",
      "maxContainers": 5
    },
    {
      "id": "gpu-server",
      "type": "remote",
      "host": "192.168.1.100",
      "user": "deploy",
      "keyPath": "~/.ssh/id_rsa",
      "maxContainers": 10
    }
  ]
}
```

## Current State

**What Works:**
- Local Docker container management via `ContainerPool`
- Single-machine orchestration

**What Doesn't Work:**
- Remote worker connections
- Distributed bot deployment
- Worker health monitoring
- Load balancing across machines

## Implementation Path

### Step 1: Worker Registry
1. Create database migration for `workers` table
2. Implement `WorkerRegistry` class
3. Add worker registration in `Orchestrator.start()`
4. Create CLI command: `ai-army workers list`

### Step 2: SSH Tunnels
1. Implement `SSHTunnelManager` using ssh2
2. Test tunnel creation/teardown
3. Add tunnel health checks
4. Handle reconnection logic

### Step 3: Remote Docker Support
1. Extend `ContainerPool` to accept Docker host override
2. Route container operations through tunnels
3. Test remote container creation

### Step 4: Worker Assignment
1. Implement `WorkerAssigner` with pattern matching
2. Update `BotManager.startBot()` to use assignment
3. Add worker preference to bot config
4. Implement load balancing

### Step 5: Integration
1. Wire `WorkerRegistry` into `Orchestrator`
2. Add worker status to `StatusCommand`
3. Test multi-worker deployment
4. Document remote worker setup

## Files to Create

```
src/core/worker-registry.js
src/core/worker-assigner.js
src/worker/ssh-tunnel.js
src/worker/docker-proxy.js
test/unit/worker-registry.test.js
test/integration/remote-worker.test.js
migrations/011_workers.sql
```

## Dependencies

- ✅ ssh2 (already in package.json)
- ✅ dockerode (already in package.json)
- ✅ PostgreSQL storage (already implemented)

## Complexity: High
- Network programming (SSH tunnels)
- Distributed system concerns
- Failure handling and recovery
- Testing requires real remote machines
