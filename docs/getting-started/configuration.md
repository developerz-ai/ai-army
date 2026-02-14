# Configuration Reference

Complete guide to configuring AI Army and your bots.

## Overview

AI Army uses a two-level configuration system:

1. **Main Configuration** (`config.json`) - Global settings, providers, channels
2. **Bot Configuration** (`bots/{bot-id}/config.json`) - Per-bot settings

## Main Configuration (`config.json`)

### Complete Example

```json
{
  "defaults": {
    "model": {
      "provider": "anthropic",
      "model": "claude-sonnet-4-5"
    },
    "sandbox": {
      "type": "docker",
      "image": "node:22-slim",
      "memory": "512m",
      "cpus": "1.0"
    },
    "concurrency": {
      "maxConcurrent": 10,
      "perBot": 3
    }
  },
  "providers": {
    "anthropic": {
      "type": "anthropic",
      "apiKey": "${ANTHROPIC_API_KEY}",
      "baseURL": "https://api.anthropic.com"
    },
    "openai": {
      "type": "openai",
      "apiKey": "${OPENAI_API_KEY}",
      "organization": "${OPENAI_ORG_ID}"
    }
  },
  "channels": {
    "slack": {
      "type": "slack",
      "token": "${SLACK_BOT_TOKEN}",
      "signingSecret": "${SLACK_SIGNING_SECRET}",
      "bots": ["support", "assistant"]
    },
    "discord": {
      "type": "discord",
      "token": "${DISCORD_BOT_TOKEN}",
      "bots": ["moderator"]
    }
  },
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
      "env": {
        "NODE_ENV": "production"
      }
    }
  },
  "database": {
    "url": "${DATABASE_URL}",
    "pool": {
      "min": 2,
      "max": 10
    }
  },
  "api": {
    "port": 3000,
    "host": "0.0.0.0",
    "cors": {
      "origins": ["http://localhost:3000"],
      "credentials": true
    },
    "auth": {
      "tokens": [
        {
          "token": "${API_TOKEN}",
          "role": "admin"
        }
      ]
    },
    "rateLimit": {
      "max": 100,
      "windowMs": 60000
    }
  },
  "monitoring": {
    "enabled": true,
    "healthCheck": {
      "interval": 30000
    },
    "metrics": {
      "enabled": true,
      "interval": 60000
    }
  },
  "webhooks": {
    "enabled": true,
    "endpoints": [
      {
        "url": "https://myapp.com/webhook",
        "events": ["bot.started", "bot.error"],
        "secret": "${WEBHOOK_SECRET}"
      }
    ]
  },
  "workers": {
    "enabled": false,
    "mode": "distributed",
    "nodes": []
  }
}
```

### Defaults Section

Configure default settings inherited by all bots:

#### `defaults.model`

Default AI model configuration:

```json
{
  "defaults": {
    "model": {
      "provider": "anthropic",
      "model": "claude-sonnet-4-5",
      "temperature": 0.7,
      "maxTokens": 4096
    }
  }
}
```

**Options:**
- `provider` (string) - Provider ID from `providers` section
- `model` (string) - Model name/ID
- `temperature` (number, optional) - Creativity level (0.0-1.0)
- `maxTokens` (number, optional) - Maximum response tokens

#### `defaults.sandbox`

Default sandbox/container configuration:

```json
{
  "defaults": {
    "sandbox": {
      "type": "docker",
      "image": "node:22-slim",
      "memory": "512m",
      "cpus": "1.0",
      "network": "bridge",
      "volumes": []
    }
  }
}
```

**Options:**
- `type` (string) - Sandbox type: `"docker"` (default), `"incus"`, or `"just-bash"`
- `image` (string) - Docker image name (used when `type` is "docker")
- `incusImage` (string, optional) - Incus image alias (used when `type` is "incus")
- `memory` (string) - Memory limit (e.g., "512m", "1g")
- `cpus` (string) - CPU limit (e.g., "0.5", "2.0")
- `network` (string) - Network mode ("bridge", "host", "none")
- `volumes` (array) - Volume mounts (e.g., `["/host/path:/container/path"]`)

#### `defaults.concurrency`

Default concurrency limits:

```json
{
  "defaults": {
    "concurrency": {
      "maxConcurrent": 10,
      "perBot": 3
    }
  }
}
```

**Options:**
- `maxConcurrent` (number) - System-wide max concurrent requests
- `perBot` (number) - Max concurrent requests per bot

### Providers Section

Configure AI providers (Anthropic, OpenAI, etc.):

#### Anthropic

```json
{
  "providers": {
    "anthropic": {
      "type": "anthropic",
      "apiKey": "${ANTHROPIC_API_KEY}",
      "baseURL": "https://api.anthropic.com",
      "defaultHeaders": {}
    }
  }
}
```

**Options:**
- `type` (string) - Must be "anthropic"
- `apiKey` (string) - API key (use `${VAR}` for env vars)
- `baseURL` (string, optional) - Custom API endpoint
- `defaultHeaders` (object, optional) - Additional HTTP headers

#### OpenAI

```json
{
  "providers": {
    "openai": {
      "type": "openai",
      "apiKey": "${OPENAI_API_KEY}",
      "organization": "${OPENAI_ORG_ID}",
      "baseURL": "https://api.openai.com/v1"
    }
  }
}
```

**Options:**
- `type` (string) - Must be "openai"
- `apiKey` (string) - API key
- `organization` (string, optional) - Organization ID
- `baseURL` (string, optional) - Custom API endpoint (for Azure, etc.)

### Channels Section

Configure communication channels (Slack, Discord, REST API):

#### Slack

```json
{
  "channels": {
    "slack": {
      "type": "slack",
      "token": "${SLACK_BOT_TOKEN}",
      "signingSecret": "${SLACK_SIGNING_SECRET}",
      "appToken": "${SLACK_APP_TOKEN}",
      "socketMode": true,
      "bots": ["support", "assistant"]
    }
  }
}
```

**Options:**
- `type` (string) - Must be "slack"
- `token` (string) - Bot token (starts with `xoxb-`)
- `signingSecret` (string) - Signing secret for webhook verification
- `appToken` (string, optional) - App-level token for Socket Mode
- `socketMode` (boolean, optional) - Use Socket Mode (vs webhooks)
- `bots` (array) - Bot IDs to connect to this channel

#### Discord

```json
{
  "channels": {
    "discord": {
      "type": "discord",
      "token": "${DISCORD_BOT_TOKEN}",
      "intents": ["GUILDS", "GUILD_MESSAGES", "MESSAGE_CONTENT"],
      "bots": ["moderator", "assistant"]
    }
  }
}
```

**Options:**
- `type` (string) - Must be "discord"
- `token` (string) - Bot token
- `intents` (array, optional) - Gateway intents (default: all necessary intents)
- `bots` (array) - Bot IDs to connect to this channel

#### REST API

REST API is always available on the configured port. See `api` section below.

### MCP Servers Section

Configure Model Context Protocol (MCP) servers for additional tools:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
      "env": {
        "NODE_ENV": "production"
      }
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

**Options:**
- `command` (string) - Command to execute
- `args` (array) - Command arguments
- `env` (object, optional) - Environment variables for the process

### Database Section

Configure PostgreSQL database connection:

```json
{
  "database": {
    "url": "${DATABASE_URL}",
    "pool": {
      "min": 2,
      "max": 10,
      "idleTimeoutMillis": 30000
    },
    "ssl": {
      "rejectUnauthorized": false
    }
  }
}
```

**Options:**
- `url` (string) - PostgreSQL connection URL
- `pool.min` (number) - Minimum pool connections
- `pool.max` (number) - Maximum pool connections
- `pool.idleTimeoutMillis` (number) - Idle connection timeout
- `ssl` (object, optional) - SSL configuration

### API Section

Configure REST API server:

```json
{
  "api": {
    "port": 3000,
    "host": "0.0.0.0",
    "cors": {
      "origins": ["http://localhost:3000", "https://myapp.com"],
      "credentials": true,
      "methods": ["GET", "POST", "PUT", "DELETE"],
      "headers": ["Content-Type", "Authorization"]
    },
    "auth": {
      "tokens": [
        {
          "token": "${API_TOKEN}",
          "role": "admin",
          "description": "Main admin token"
        },
        {
          "token": "${READONLY_TOKEN}",
          "role": "readonly",
          "description": "Read-only access"
        }
      ]
    },
    "rateLimit": {
      "max": 100,
      "windowMs": 60000,
      "bypassIps": ["127.0.0.1"]
    }
  }
}
```

**Options:**
- `port` (number) - Server port
- `host` (string) - Bind address
- `cors.origins` (array) - Allowed origins
- `cors.credentials` (boolean) - Allow credentials
- `cors.methods` (array) - Allowed HTTP methods
- `cors.headers` (array) - Allowed headers
- `auth.tokens` (array) - API authentication tokens
- `rateLimit.max` (number) - Max requests per window
- `rateLimit.windowMs` (number) - Rate limit window (milliseconds)
- `rateLimit.bypassIps` (array) - IPs that bypass rate limiting

### Monitoring Section

Configure health checks and metrics:

```json
{
  "monitoring": {
    "enabled": true,
    "healthCheck": {
      "interval": 30000,
      "timeout": 5000
    },
    "metrics": {
      "enabled": true,
      "interval": 60000,
      "retention": 86400000
    },
    "alerts": {
      "enabled": true,
      "channels": ["slack"],
      "thresholds": {
        "errorRate": 0.1,
        "responseTime": 5000
      }
    }
  }
}
```

### Webhooks Section

Configure outbound webhooks for events:

```json
{
  "webhooks": {
    "enabled": true,
    "retries": 3,
    "timeout": 5000,
    "endpoints": [
      {
        "url": "https://myapp.com/webhook",
        "events": ["bot.started", "bot.stopped", "bot.error", "message.received"],
        "secret": "${WEBHOOK_SECRET}",
        "headers": {
          "X-Custom-Header": "value"
        }
      }
    ]
  }
}
```

**Available Events:**
- `bot.started` - Bot has started
- `bot.stopped` - Bot has stopped
- `bot.error` - Bot encountered an error
- `message.received` - Bot received a message
- `message.sent` - Bot sent a response
- `session.created` - New session created
- `session.ended` - Session ended

## Bot Configuration (`bots/{bot-id}/config.json`)

### Complete Example

```json
{
  "id": "helper",
  "soul": "./soul.md",
  "provider": "anthropic",
  "model": "claude-sonnet-4-5",
  "temperature": 0.7,
  "maxTokens": 4096,
  "tools": [
    "bash",
    "readFile",
    "writeFile",
    "listDirectory"
  ],
  "mcpServers": ["filesystem", "github"],
  "sandbox": {
    "image": "node:22-slim",
    "memory": "1g",
    "cpus": "2.0"
  },
  "concurrency": {
    "maxConcurrent": 5
  },
  "systemPrompt": "Additional system instructions...",
  "metadata": {
    "team": "engineering",
    "cost-center": "dev-tools"
  }
}
```

### Required Fields

- **`id`** (string) - Unique bot identifier (must match directory name)
- **`soul`** (string) - Path to personality file (usually `./soul.md`)

### Model Configuration

Override default model settings:

```json
{
  "provider": "openai",
  "model": "gpt-4-turbo-preview",
  "temperature": 0.5,
  "maxTokens": 8192
}
```

### Tools Configuration

Specify available tools:

```json
{
  "tools": [
    "bash",
    "readFile",
    "writeFile",
    "listDirectory",
    "./tools/custom-tool.js"
  ]
}
```

**Built-in Tools:**
- `bash` - Execute shell commands
- `readFile` - Read file contents
- `writeFile` - Write file contents
- `listDirectory` - List directory contents

**Custom Tools:**
- Provide path to custom tool module (relative to bot directory or absolute)

### MCP Servers

Specify which MCP servers this bot can use:

```json
{
  "mcpServers": ["filesystem", "github", "slack"]
}
```

These must be defined in the main `config.json` `mcpServers` section.

### Sandbox Overrides

Override default sandbox settings:

```json
{
  "sandbox": {
    "image": "python:3.11-slim",
    "memory": "2g",
    "cpus": "4.0",
    "volumes": ["/data:/workspace/data:ro"]
  }
}
```

#### Docker Configuration (Default)

Use Docker containers (most common):

```json
{
  "sandbox": {
    "type": "docker",
    "image": "node:22-slim",
    "memory": "2g",
    "cpus": 2
  }
}
```

#### Incus Configuration

Use Incus (LXC) containers for stronger isolation and system-level access:

```json
{
  "sandbox": {
    "type": "incus",
    "incusImage": "images:ubuntu/24.04/cloud",
    "memory": "2g",
    "cpus": 2
  }
}
```

**Incus Options:**
- `type` (string) - Must be "incus"
- `incusImage` (string, optional) - Incus image alias (e.g., `images:ubuntu/24.04/cloud`, `images:alpine/3.20`)
  - Default: `images:ubuntu/24.04/cloud`
  - Common images: `images:debian/bookworm`, `images:alpine/3.20`
  - List available: `incus image list images:`
- `incusProfile` (string, optional) - Incus profile name for advanced configuration
- `memory` (string) - Memory limit (e.g., "512m", "1g", "2g")
- `cpus` (number) - CPU count
- `dockerAccess` (boolean, optional) - Enable Docker inside the Incus container

**Example: Bot with Docker Access Inside Incus**

```json
{
  "sandbox": {
    "type": "incus",
    "incusImage": "images:ubuntu/24.04/cloud",
    "memory": "4g",
    "cpus": 4,
    "dockerAccess": true
  }
}
```

When `dockerAccess: true`, the bot can run Docker and docker-compose commands inside the Incus container. This requires more resources but enables full project setup capabilities.

#### Just-Bash Configuration

Use no container (execute directly in parent process):

```json
{
  "sandbox": {
    "type": "just-bash"
  }
}
```

> **Note:** Just-bash is useful for testing and local development but not recommended for production.

### Concurrency Limits

Set bot-specific concurrency:

```json
{
  "concurrency": {
    "maxConcurrent": 3
  }
}
```

### Additional Options

- **`systemPrompt`** (string, optional) - Additional system instructions
- **`metadata`** (object, optional) - Custom metadata for tracking/organization

## Environment Variables

Use `${VAR_NAME}` syntax in config files to reference environment variables:

```json
{
  "apiKey": "${ANTHROPIC_API_KEY}",
  "token": "${SLACK_BOT_TOKEN}"
}
```

### Recommended `.env` Structure

```bash
# AI Providers
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
OPENAI_ORG_ID=org-...

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/ai_army

# API
API_PORT=3000
API_TOKEN=your-secure-token
READONLY_TOKEN=another-token

# Channels
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_APP_TOKEN=xapp-...
DISCORD_BOT_TOKEN=...

# MCP & Tools
GITHUB_TOKEN=ghp_...

# Webhooks
WEBHOOK_SECRET=your-webhook-secret

# Monitoring
ALERT_SLACK_WEBHOOK=https://hooks.slack.com/...

# Logging
LOG_LEVEL=info
NODE_ENV=production
```

## Configuration Validation

Validate your configuration:

```bash
npx ai-army validate
```

This checks:
- ✅ JSON syntax is valid
- ✅ Required fields are present
- ✅ Referenced files exist (soul.md, tools, etc.)
- ✅ Environment variables are set
- ✅ Provider configurations are valid
- ✅ Bot IDs are unique
- ✅ Channel bot references exist

## Configuration Hot Reload

AI Army supports hot reloading configuration without restart:

```bash
npx ai-army reload
```

Or via API:

```bash
curl -X POST http://localhost:3000/api/admin/reload \
  -H "Authorization: Bearer ${API_TOKEN}"
```

**What gets reloaded:**
- ✅ Bot configurations
- ✅ Bot personalities (soul.md)
- ✅ Provider settings
- ✅ Channel configurations
- ❌ Database settings (requires restart)
- ❌ API server settings (requires restart)

## Best Practices

### Security

1. **Never commit secrets** - Use environment variables
2. **Rotate tokens regularly** - Update API keys periodically
3. **Use strong tokens** - Generate with `openssl rand -hex 32`
4. **Limit permissions** - Use readonly tokens where possible
5. **Enable rate limiting** - Prevent abuse

### Performance

1. **Set appropriate concurrency limits** - Avoid overwhelming AI APIs
2. **Configure resource limits** - Prevent containers from consuming too much memory
3. **Use connection pooling** - Database pool settings affect performance
4. **Enable monitoring** - Track metrics to identify bottlenecks

### Organization

1. **Use descriptive bot IDs** - `code-reviewer` not `bot1`
2. **Add metadata** - Track teams, cost centers, etc.
3. **Document in soul.md** - Clearly define bot purpose and capabilities
4. **Version control** - Commit config files (except `.env`)

## Troubleshooting

### Configuration Validation Fails

Run with verbose output:

```bash
npx ai-army validate --verbose
```

### Environment Variable Not Found

Check variable is set:

```bash
echo $ANTHROPIC_API_KEY
```

Or add to `.env` file.

### Bot Not Loading

1. Check bot ID matches directory name
2. Verify soul.md file exists
3. Ensure JSON syntax is valid
4. Run `npx ai-army validate`

## Examples

### Minimal Configuration

```json
{
  "defaults": {
    "model": {
      "provider": "anthropic",
      "model": "claude-sonnet-4-5"
    }
  },
  "providers": {
    "anthropic": {
      "type": "anthropic",
      "apiKey": "${ANTHROPIC_API_KEY}"
    }
  }
}
```

### Production Configuration

See [Deployment Guide](../deployment.md) for production-ready examples.

## Further Reading

- [First Bot Tutorial](first-bot.md) - Create your first bot
- [Orchestrator API](../api/orchestrator.md) - Programmatic control
- [REST API Reference](../api/rest-api.md) - HTTP API endpoints
- [Development Guide](../development.md) - Local development setup
