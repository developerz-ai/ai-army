# Architecture - Master/Worker Distributed System

## Overview

The system uses a **1 master, N workers** architecture where:
- **Master Server**: Handles configuration, orchestration, channel connections, session management
- **Worker Servers**: Run Docker containers with bot execution environments

Workers can be:
- Local (same machine as master)
- Remote (connected via SSH tunnel)

## Master Server Responsibilities

```javascript
// Master server components
{
  configLoader: "Load and validate JSON configs",
  secretsManager: "Fetch secrets from Bitwarden",
  channelManager: "Manage Slack/Discord connections",
  sessionManager: "Track per-user sessions",
  workerPool: "Manage worker connections",
  botOrchestrator: "Route messages to correct bot/worker",
  mcpManager: "Spawn and manage MCP servers"
}
```

### Flow Diagram

```
User Message (Slack/Discord)
        │
        ▼
┌───────────────────┐
│  Channel Adapter  │  (Slack Bolt / Discord.js)
└───────────────────┘
        │
        ▼
┌───────────────────┐
│  Session Manager  │  Find/create user session
└───────────────────┘
        │
        ▼
┌───────────────────┐
│  Bot Orchestrator │  Route to correct bot config
└───────────────────┘
        │
        ▼
┌───────────────────┐
│   Worker Pool     │  Select available worker
└───────────────────┘
        │
        ▼
┌───────────────────┐
│  AI SDK Agent     │  Call LLM, handle tool loop
└───────────────────┘
        │
        ▼
┌───────────────────┐
│  Docker Executor  │  Execute tools in sandbox
└───────────────────┘
        │
        ▼
Response back to user
```

## Worker Configuration

### config/workers.json

```json
{
  "workers": [
    {
      "id": "local",
      "type": "local",
      "maxContainers": 5,
      "dataPath": "/data/bots"
    },
    {
      "id": "gpu-server",
      "type": "remote",
      "host": "192.168.1.100",
      "port": 22,
      "user": "deploy",
      "keyPath": "~/.ssh/id_rsa",
      "maxContainers": 10,
      "dataPath": "/home/deploy/ai-army/data"
    },
    {
      "id": "cloud-worker",
      "type": "remote",
      "host": "worker.example.com",
      "port": 22,
      "user": "ubuntu",
      "keyPath": "${SSH_KEY_PATH}",
      "maxContainers": 20,
      "dataPath": "/opt/ai-army/data"
    }
  ],

  "assignment": {
    "default": "local",
    "rules": [
      {
        "botPattern": "devops-*",
        "worker": "gpu-server"
      },
      {
        "botPattern": "*-heavy",
        "worker": "cloud-worker"
      }
    ]
  }
}
```

## SSH Tunnel Management

For remote workers, the master establishes SSH tunnels to Docker daemons:

```javascript
// src/worker/ssh-tunnel.ts
import { Client } from 'ssh2';

export async function createWorkerTunnel(config) {
  const conn = new Client();

  return new Promise((resolve, reject) => {
    conn.on('ready', () => {
      // Forward local port to remote Docker socket
      conn.forwardOut(
        '127.0.0.1',
        0,  // random local port
        '/var/run/docker.sock',
        0,
        (err, stream) => {
          if (err) reject(err);
          resolve({
            connection: conn,
            dockerHost: `tcp://127.0.0.1:${localPort}`
          });
        }
      );
    });

    conn.connect({
      host: config.host,
      port: config.port,
      username: config.user,
      privateKey: fs.readFileSync(config.keyPath)
    });
  });
}
```

## Docker Container Lifecycle

### Container Creation

```javascript
// src/execution/docker-manager.ts
import Docker from 'dockerode';

export async function createBotContainer(botConfig, worker) {
  const docker = new Docker({ host: worker.dockerHost });

  const container = await docker.createContainer({
    Image: botConfig.sandbox.image || 'node:22-slim',
    name: `ai-army-${botConfig.id}`,
    Cmd: ['tail', '-f', '/dev/null'],  // Keep alive
    HostConfig: {
      Binds: [
        `${worker.dataPath}/${botConfig.id}:/home/agent:rw`,
        ...Object.entries(botConfig.workspace?.mounts || {}).map(
          ([mountPath, config]) => `${config.path}:${mountPath}:${config.readOnly ? 'ro' : 'rw'}`
        )
      ],
      Memory: parseMemory(botConfig.sandbox.maxMemory || '1g'),
      NanoCPUs: (botConfig.sandbox.maxCpu || 1) * 1e9,
      NetworkMode: botConfig.sandbox.network?.allowedDomains?.includes('*')
        ? 'bridge'
        : 'none'
    },
    WorkingDir: '/home/agent'
  });

  await container.start();

  // Install packages if specified
  if (botConfig.sandbox.packages?.length) {
    await execInContainer(container,
      `apt-get update && apt-get install -y ${botConfig.sandbox.packages.join(' ')}`
    );
  }

  return container;
}
```

### Container Pool Management

```javascript
// src/worker/container-pool.ts
export class ContainerPool {
  private containers = new Map();

  async getContainer(botId) {
    if (!this.containers.has(botId)) {
      const container = await this.createContainer(botId);
      this.containers.set(botId, container);
    }
    return this.containers.get(botId);
  }

  async recycleContainer(botId) {
    const container = this.containers.get(botId);
    if (container) {
      await container.stop();
      await container.remove();
      this.containers.delete(botId);
    }
  }

  async healthCheck() {
    for (const [botId, container] of this.containers) {
      const info = await container.inspect();
      if (!info.State.Running) {
        console.log(`Container ${botId} not running, recreating...`);
        await this.recycleContainer(botId);
        await this.getContainer(botId);
      }
    }
  }
}
```

## Session Management

Sessions are keyed as `botId:channelType:channelId:userId`:

```javascript
// src/session/session-manager.ts
export class SessionManager {
  private sessions = new Map();
  private storage: SessionStorage;

  constructor(storage: SessionStorage) {
    this.storage = storage;
  }

  getSessionKey(botId, channel, userId) {
    return `${botId}:${channel.type}:${channel.id}:${userId}`;
  }

  async getSession(botId, channel, userId) {
    const key = this.getSessionKey(botId, channel, userId);

    if (!this.sessions.has(key)) {
      // Load from disk or create new
      const existing = await this.storage.load(key);
      this.sessions.set(key, existing || {
        key,
        messages: [],
        created: Date.now(),
        lastActive: Date.now()
      });
    }

    return this.sessions.get(key);
  }

  async appendMessage(session, role, content) {
    session.messages.push({ role, content, timestamp: Date.now() });
    session.lastActive = Date.now();

    // Check if compaction needed
    if (this.needsCompaction(session)) {
      await this.compact(session);
    }

    await this.storage.save(session);
  }

  async compact(session) {
    // Summarize old messages, flush to memory file
    const summary = await this.summarizeOldMessages(session);
    await this.flushToMemory(session, summary);
    session.messages = session.messages.slice(-10);  // Keep last 10
  }
}
```

## Scaling Considerations

### Horizontal Scaling

```
┌─────────────────────────────────────────────────────────┐
│                    Load Balancer                         │
│                   (HAProxy/nginx)                        │
└─────────────────────────────────────────────────────────┘
              │                       │
              ▼                       ▼
┌─────────────────────┐   ┌─────────────────────┐
│    Master Node 1    │   │    Master Node 2    │
│  (Slack channels)   │   │  (Discord channels) │
└─────────────────────┘   └─────────────────────┘
              │                       │
              └───────────┬───────────┘
                          │
              ┌───────────┴───────────┐
              │      Redis/Queue      │
              │   (shared sessions)   │
              └───────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
        ▼                 ▼                 ▼
   ┌─────────┐       ┌─────────┐       ┌─────────┐
   │ Worker 1│       │ Worker 2│       │ Worker N│
   └─────────┘       └─────────┘       └─────────┘
```

### Session Storage Options

| Storage | Use Case |
|---------|----------|
| File (JSONL) | Single master, simple setup |
| Redis | Multi-master, session sharing |
| SQLite | Single master, queryable |
| PostgreSQL | Production, multi-master |

## Health Monitoring

```javascript
// src/orchestrator/health.ts
export class HealthMonitor {
  async checkAll() {
    return {
      master: await this.checkMaster(),
      workers: await Promise.all(
        this.workers.map(w => this.checkWorker(w))
      ),
      channels: await this.checkChannels(),
      mcpServers: await this.checkMcpServers()
    };
  }

  async checkWorker(worker) {
    try {
      const docker = new Docker({ host: worker.dockerHost });
      await docker.ping();
      const containers = await docker.listContainers();
      return {
        id: worker.id,
        status: 'healthy',
        containers: containers.length,
        maxContainers: worker.maxContainers
      };
    } catch (err) {
      return { id: worker.id, status: 'unhealthy', error: err.message };
    }
  }
}
```
