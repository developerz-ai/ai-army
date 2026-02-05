# Templates and Instances - Deploy Same Bot Multiple Times

## Overview

Instead of configuring each bot individually, you can define a **bot template** and deploy it **multiple times** as instances.

This is useful for:
- **Horizontal scaling**: Same bot, multiple instances for load balancing
- **Per-team deployment**: Same bot type, one instance per team
- **Per-customer deployment**: SaaS model, one bot instance per customer
- **Environment separation**: Dev/staging/production instances
- **Geographic distribution**: Regional instances of the same bot

## Bot Templates

Define a bot template once, instantiate many times.

### Template Definition

```json
{
  "templates": {
    "support-agent": {
      "soul": "./templates/support-agent/soul.md",
      "provider": "anthropic",
      "model": "claude-sonnet-4-5",
      "fallbacks": ["claude-haiku-4-5"],

      "workspace": {
        "root": "./data/{instance}",
        "mounts": {}
      },

      "sandbox": {
        "type": "docker",
        "image": "node:22-slim",
        "packages": ["git", "ripgrep"]
      },

      "tools": ["bash", "readFile", "writeFile", "webSearch"],
      "mcpServers": ["github", "linear"],
      "skills": ["./skills/ticket-triage"],

      "restrictions": {
        "dmAllowed": true
      }
    },

    "code-reviewer": {
      "soul": "./templates/code-reviewer/soul.md",
      "provider": "anthropic",
      "model": "claude-sonnet-4-5",

      "workspace": {
        "root": "./data/{instance}",
        "mounts": {
          "/repos": { "path": "{repos_path}", "readOnly": true }
        }
      },

      "sandbox": {
        "type": "docker",
        "dockerfile": "./templates/code-reviewer/Dockerfile"
      },

      "tools": ["bash", "readFile", "glob", "grep"],
      "mcpServers": ["github"],
      "skills": ["./skills/code-review"]
    }
  }
}
```

## Instances

Deploy instances of a template:

### Approach 1: Explicit Instances

```json
{
  "instances": [
    {
      "template": "support-agent",
      "name": "support-team-frontend",
      "channel": "slack-main",
      "overrides": {
        "restrictions": {
          "allowedChannels": ["#frontend-support"]
        }
      }
    },
    {
      "template": "support-agent",
      "name": "support-team-backend",
      "channel": "slack-main",
      "overrides": {
        "restrictions": {
          "allowedChannels": ["#backend-support"]
        }
      }
    },
    {
      "template": "support-agent",
      "name": "support-team-mobile",
      "channel": "slack-main",
      "overrides": {
        "restrictions": {
          "allowedChannels": ["#mobile-support"]
        }
      }
    }
  ]
}
```

### Approach 2: Dynamic Instances (Per-Team)

```json
{
  "dynamicInstances": {
    "support-per-team": {
      "template": "support-agent",
      "deploymentStrategy": "per-slack-channel",
      "channelPattern": "#*-support",
      "nameTemplate": "support-{channel}",
      "overrides": {
        "restrictions": {
          "allowedChannels": ["{channel}"]
        }
      }
    }
  }
}
```

This automatically creates bot instances when matching channels are found:
- `#frontend-support` → bot named `support-frontend-support`
- `#backend-support` → bot named `support-backend-support`
- `#mobile-support` → bot named `support-mobile-support`

### Approach 3: Dynamic Instances (Per-Customer)

For SaaS deployments:

```json
{
  "dynamicInstances": {
    "customer-bots": {
      "template": "support-agent",
      "deploymentStrategy": "per-record",
      "dataSource": {
        "type": "postgres",
        "query": "SELECT id, name, slack_token FROM customers WHERE active = true"
      },
      "nameTemplate": "customer-{id}",
      "overrides": {
        "channel": {
          "type": "slack",
          "botToken": "{slack_token}"
        },
        "workspace": {
          "root": "./data/customers/{id}"
        }
      }
    }
  }
}
```

This reads from a database and creates one bot instance per customer.

## Template Variables

Templates can use variables that are replaced per instance:

| Variable | Description | Example |
|----------|-------------|---------|
| `{instance}` | Instance name | `support-team-frontend` |
| `{template}` | Template name | `support-agent` |
| `{channel}` | Channel name/ID | `#frontend-support` |
| `{team}` | Team identifier | `frontend` |
| `{customer_id}` | Customer ID | `acme-corp` |
| `{repos_path}` | Custom path | `/home/user/repos` |

### Example with Variables

Template:
```json
{
  "soul": "./templates/{template}/soul.md",
  "workspace": {
    "root": "./data/{instance}",
    "mounts": {
      "/repos": { "path": "{repos_path}", "readOnly": true }
    }
  }
}
```

Instance:
```json
{
  "template": "code-reviewer",
  "name": "reviewer-frontend",
  "variables": {
    "repos_path": "/home/user/acme-frontend"
  }
}
```

Result:
```json
{
  "soul": "./templates/code-reviewer/soul.md",
  "workspace": {
    "root": "./data/reviewer-frontend",
    "mounts": {
      "/repos": { "path": "/home/user/acme-frontend", "readOnly": true }
    }
  }
}
```

## Load Balancing Multiple Instances

When you have multiple instances of the same template, distribute load:

### Round-Robin

```json
{
  "instances": [
    { "template": "support-agent", "name": "support-1", "worker": "local" },
    { "template": "support-agent", "name": "support-2", "worker": "worker-1" },
    { "template": "support-agent", "name": "support-3", "worker": "worker-2" }
  ],
  "loadBalancing": {
    "strategy": "round-robin",
    "pool": ["support-1", "support-2", "support-3"]
  }
}
```

### Least Loaded

```json
{
  "loadBalancing": {
    "strategy": "least-loaded",
    "pool": ["support-1", "support-2", "support-3"],
    "metric": "active-sessions"
  }
}
```

### Sticky Sessions

```json
{
  "loadBalancing": {
    "strategy": "sticky",
    "pool": ["support-1", "support-2", "support-3"],
    "stickyKey": "userId"  // Same user always goes to same instance
  }
}
```

## Use Cases

### 1. Horizontal Scaling

Deploy 3 instances of the same support bot to handle high message volume:

```json
{
  "templates": {
    "support": { /* template config */ }
  },
  "instances": [
    { "template": "support", "name": "support-1", "channel": "slack-main" },
    { "template": "support", "name": "support-2", "channel": "slack-main" },
    { "template": "support", "name": "support-3", "channel": "slack-main" }
  ],
  "loadBalancing": {
    "strategy": "least-loaded",
    "pool": ["support-1", "support-2", "support-3"]
  }
}
```

All 3 instances listen to the same Slack workspace, but the orchestrator distributes messages between them.

### 2. Per-Team Bots

Deploy one instance per team, each with isolated workspace:

```json
{
  "templates": {
    "team-assistant": { /* template */ }
  },
  "instances": [
    {
      "template": "team-assistant",
      "name": "team-frontend",
      "overrides": {
        "restrictions": {
          "allowedChannels": ["#frontend", "#frontend-dev"]
        },
        "workspace": {
          "mounts": {
            "/repos": { "path": "/repos/frontend", "readOnly": true }
          }
        }
      }
    },
    {
      "template": "team-assistant",
      "name": "team-backend",
      "overrides": {
        "restrictions": {
          "allowedChannels": ["#backend", "#backend-dev"]
        },
        "workspace": {
          "mounts": {
            "/repos": { "path": "/repos/backend", "readOnly": true }
          }
        }
      }
    }
  ]
}
```

### 3. Environment Separation

Dev, staging, production instances:

```json
{
  "templates": {
    "devops-bot": { /* template */ }
  },
  "instances": [
    {
      "template": "devops-bot",
      "name": "devops-dev",
      "channel": "slack-dev",
      "overrides": {
        "sandbox": {
          "network": { "allowedDomains": ["dev.acme.com"] }
        }
      }
    },
    {
      "template": "devops-bot",
      "name": "devops-staging",
      "channel": "slack-staging",
      "overrides": {
        "sandbox": {
          "network": { "allowedDomains": ["staging.acme.com"] }
        }
      }
    },
    {
      "template": "devops-bot",
      "name": "devops-prod",
      "channel": "slack-prod",
      "overrides": {
        "sandbox": {
          "network": { "allowedDomains": ["prod.acme.com"] }
        },
        "restrictions": {
          "allowedUsers": ["alice", "bob"]  // Only senior devs
        }
      }
    }
  ]
}
```

### 4. Per-Customer SaaS

Multi-tenant SaaS where each customer gets their own bot:

```json
{
  "templates": {
    "customer-assistant": {
      "soul": "./templates/customer-assistant/soul.md",
      "provider": "openrouter",
      "model": "openrouter/auto",
      "workspace": {
        "root": "./data/customers/{customer_id}"
      },
      "mcpServers": ["filesystem"],
      "restrictions": {
        "allowedUsers": ["{customer_users}"]
      }
    }
  },

  "dynamicInstances": {
    "customers": {
      "template": "customer-assistant",
      "deploymentStrategy": "per-record",
      "dataSource": {
        "type": "postgres",
        "connectionString": "${DATABASE_URL}",
        "query": "SELECT id, name, slack_token, allowed_users FROM customers WHERE active = true",
        "pollInterval": 60000
      },
      "nameTemplate": "customer-{id}",
      "variables": {
        "customer_id": "{id}",
        "customer_users": "{allowed_users}"
      },
      "overrides": {
        "channel": {
          "type": "slack",
          "botToken": "{slack_token}"
        }
      }
    }
  }
}
```

The system polls the database every minute and:
- Creates new instances for new customers
- Removes instances for deactivated customers
- Updates instances if customer config changes

### 5. Geographic Distribution

Deploy regional instances with different workers:

```json
{
  "templates": {
    "support": { /* template */ }
  },
  "instances": [
    {
      "template": "support",
      "name": "support-us-east",
      "worker": "us-east-1",
      "overrides": {
        "workspace": { "root": "/data/support-us-east" }
      }
    },
    {
      "template": "support",
      "name": "support-eu-west",
      "worker": "eu-west-1",
      "overrides": {
        "workspace": { "root": "/data/support-eu-west" }
      }
    },
    {
      "template": "support",
      "name": "support-ap-south",
      "worker": "ap-south-1",
      "overrides": {
        "workspace": { "root": "/data/support-ap-south" }
      }
    }
  ],
  "routing": {
    "strategy": "geo-proximity",
    "fallback": "support-us-east"
  }
}
```

## Instance Management

### Lifecycle

**Create instance:**
1. Load template
2. Apply variable substitution
3. Merge overrides
4. Initialize workspace
5. Build/pull container
6. Start container
7. Connect to channel

**Update instance:**
1. Detect config change
2. Gracefully stop old container
3. Preserve workspace
4. Start new container with updated config

**Remove instance:**
1. Disconnect from channel
2. Stop container
3. Archive or delete workspace

### Instance State

Each instance maintains state:

```json
{
  "instanceId": "support-team-frontend",
  "template": "support-agent",
  "status": "running",  // starting | running | stopped | error
  "created": "2026-02-05T10:00:00Z",
  "worker": "local",
  "containerId": "abc123def456",
  "stats": {
    "messagesProcessed": 1543,
    "sessionsActive": 12,
    "toolCallsTotal": 8234,
    "uptime": 86400000
  }
}
```

## Template Directory Structure

Templates live in their own directory:

```
templates/
├── support-agent/
│   ├── template.json    # Template configuration
│   ├── soul.md          # Base personality
│   ├── Dockerfile       # Custom container (optional)
│   └── skills/          # Template-specific skills
│       └── ticket-triage/
│
├── code-reviewer/
│   ├── template.json
│   ├── soul.md
│   └── Dockerfile
│
└── devops-bot/
    ├── template.json
    ├── soul.md
    └── Dockerfile
```

## Configuration Examples

### Simple: 3 Instances of Same Bot

```json
{
  "templates": {
    "worker": {
      "soul": "./templates/worker/soul.md",
      "provider": "anthropic",
      "model": "claude-haiku-4-5",
      "tools": ["bash", "readFile"],
      "workspace": { "root": "./data/{instance}" }
    }
  },

  "instances": [
    { "template": "worker", "name": "worker-1", "channel": "slack-main" },
    { "template": "worker", "name": "worker-2", "channel": "slack-main" },
    { "template": "worker", "name": "worker-3", "channel": "slack-main" }
  ],

  "loadBalancing": {
    "strategy": "round-robin",
    "pool": ["worker-1", "worker-2", "worker-3"]
  }
}
```

### Per-Team with Overrides

```json
{
  "templates": {
    "team-assistant": {
      "soul": "./templates/team-assistant/soul.md",
      "provider": "anthropic",
      "model": "claude-sonnet-4-5",
      "tools": ["bash", "readFile", "writeFile", "grep"],
      "mcpServers": ["github"],
      "workspace": { "root": "./data/{instance}" }
    }
  },

  "instances": [
    {
      "template": "team-assistant",
      "name": "team-frontend",
      "channel": "slack-main",
      "variables": {
        "team_name": "Frontend Team",
        "repos_path": "/repos/frontend"
      },
      "overrides": {
        "restrictions": {
          "allowedChannels": ["#frontend"],
          "allowedUsers": ["alice", "carol"]
        },
        "workspace": {
          "mounts": {
            "/repos": { "path": "/repos/frontend", "readOnly": true }
          }
        }
      }
    },
    {
      "template": "team-assistant",
      "name": "team-backend",
      "channel": "slack-main",
      "variables": {
        "team_name": "Backend Team",
        "repos_path": "/repos/backend"
      },
      "overrides": {
        "restrictions": {
          "allowedChannels": ["#backend"],
          "allowedUsers": ["bob", "dave"]
        },
        "workspace": {
          "mounts": {
            "/repos": { "path": "/repos/backend", "readOnly": true }
          }
        }
      }
    }
  ]
}
```

### Auto-Scaling Instances

Automatically scale based on load:

```json
{
  "autoScaling": {
    "template": "support-agent",
    "minInstances": 2,
    "maxInstances": 10,
    "metrics": {
      "type": "queue-depth",
      "scaleUpThreshold": 50,    // Scale up if 50+ messages queued
      "scaleDownThreshold": 10   // Scale down if < 10 messages queued
    },
    "cooldown": 300000  // 5 minutes between scaling actions
  }
}
```

## Template Inheritance

Templates can inherit from other templates:

```json
{
  "templates": {
    "base-assistant": {
      "provider": "anthropic",
      "model": "claude-sonnet-4-5",
      "tools": ["bash", "readFile", "writeFile"],
      "sandbox": {
        "type": "docker",
        "image": "node:22-slim"
      }
    },

    "support-agent": {
      "extends": "base-assistant",
      "soul": "./templates/support/soul.md",
      "mcpServers": ["linear", "github"],
      "skills": ["./skills/ticket-triage"]
    },

    "code-reviewer": {
      "extends": "base-assistant",
      "soul": "./templates/code-reviewer/soul.md",
      "mcpServers": ["github"],
      "skills": ["./skills/code-review"],
      "overrides": {
        "tools": ["bash", "readFile", "grep"]  // No writeFile
      }
    }
  }
}
```

## Benefits

### Resource Efficiency

Single template definition:
- Shared Docker images (built once)
- Shared soul.md content (loaded once)
- Shared skills (single copy)
- Configuration DRY (don't repeat yourself)

### Easy Updates

Update the template, all instances get updated:

```bash
# Update template soul.md
vim templates/support-agent/soul.md

# Restart all instances (graceful rolling restart)
npm run restart -- --template support-agent
```

### Testing & Staging

Test template changes before deploying:

```json
{
  "instances": [
    { "template": "support-agent", "name": "support-prod", "channel": "slack-main" },
    { "template": "support-agent-v2", "name": "support-staging", "channel": "slack-dev" }
  ]
}
```

Test v2 in staging channel, then promote to production by changing the template reference.

## Instance Discovery

List running instances via API:

```
GET /api/instances

Response:
{
  "instances": [
    {
      "name": "support-1",
      "template": "support-agent",
      "status": "running",
      "worker": "local",
      "sessions": 5,
      "uptime": 86400
    },
    {
      "name": "support-2",
      "template": "support-agent",
      "status": "running",
      "worker": "worker-1",
      "sessions": 3,
      "uptime": 86400
    }
  ]
}
```

## Canary Deployments

Deploy new version to a subset of instances:

```json
{
  "templates": {
    "support-v1": { /* old version */ },
    "support-v2": { /* new version */ }
  },

  "instances": [
    { "template": "support-v2", "name": "support-canary", "weight": 10 },
    { "template": "support-v1", "name": "support-1", "weight": 45 },
    { "template": "support-v1", "name": "support-2", "weight": 45 }
  ],

  "loadBalancing": {
    "strategy": "weighted",
    "canaryMonitoring": {
      "errorRateThreshold": 0.05,  // Rollback if >5% errors
      "latencyThreshold": 5000     // Rollback if >5s average
    }
  }
}
```

- 10% of traffic goes to new version (canary)
- 90% goes to old version
- If canary performs well, promote to 100%

## Summary

Templates enable:
- **Deploy once, run many** - Same bot configuration, multiple instances
- **Easy scaling** - Add instances without copy-pasting config
- **Easy updates** - Change template, all instances updated
- **Specialization** - Override per instance (different channels, users, workspaces)
- **Auto-scaling** - Create/destroy instances based on load
- **Multi-tenancy** - Per-customer or per-team instances

This is essential for production deployments where you need multiple identical bots or want to scale horizontally.
