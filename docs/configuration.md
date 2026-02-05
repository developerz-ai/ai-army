# ⚙️ Configuration Guide

Complete reference for configuring AI Assistants Army.

## Configuration Files

```
my-ai-army/
├── config.json              # Main configuration
├── .env                     # Secrets (gitignored)
└── bots/
    ├── support-bot/
    │   ├── config.json      # Bot-specific config
    │   └── soul.md          # Bot personality
    └── code-reviewer/
        ├── config.json
        └── soul.md
```

## Main Configuration (`config.json`)

### Minimal Example

```json
{
  "providers": {
    "anthropic": {
      "type": "anthropic",
      "apiKey": "${ANTHROPIC_API_KEY}"
    }
  },
  "channels": {
    "slack-main": {
      "type": "slack",
      "botToken": "${SLACK_BOT_TOKEN}",
      "appToken": "${SLACK_APP_TOKEN}"
    }
  }
}
```

### Complete Example

```json
{
  "$schema": "./schema/config.schema.json",

  "defaults": {
    "model": {
      "provider": "anthropic",
      "model": "claude-sonnet-4-5",
      "fallbacks": ["claude-haiku-4-5"],
      "temperature": 0.7,
      "maxTokens": 4096
    },
    "sandbox": {
      "type": "docker",
      "image": "node:22-slim",
      "maxMemory": "1g",
      "maxCpu": 1,
      "network": {
        "mode": "bridge"
      }
    },
    "tools": ["bash", "readFile", "writeFile", "glob", "grep"],
    "maxSteps": 30,
    "compaction": {
      "enabled": true,
      "threshold": 50000,
      "flushBeforeCompact": true
    }
  },

  "providers": {
    "anthropic": {
      "type": "anthropic",
      "apiKey": "${ANTHROPIC_API_KEY}",
      "baseUrl": "https://api.anthropic.com"
    },
    "openrouter": {
      "type": "openrouter",
      "apiKey": "${OPENROUTER_API_KEY}",
      "baseUrl": "https://openrouter.ai/api/v1"
    },
    "openai": {
      "type": "openai",
      "apiKey": "${OPENAI_API_KEY}",
      "baseUrl": "https://api.openai.com/v1"
    },
    "ollama": {
      "type": "custom",
      "baseUrl": "http://localhost:11434/v1",
      "apiKey": "ollama"
    }
  },

  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    },
    "notion": {
      "command": "npx",
      "args": ["-y", "@notionhq/mcp"],
      "env": {
        "NOTION_TOKEN": "${NOTION_TOKEN}"
      }
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/data/shared"]
    }
  },

  "channels": {
    "slack-main": {
      "type": "slack",
      "botToken": "${SLACK_BOT_TOKEN}",
      "appToken": "${SLACK_APP_TOKEN}",
      "signingSecret": "${SLACK_SIGNING_SECRET}"
    },
    "discord-main": {
      "type": "discord",
      "botToken": "${DISCORD_BOT_TOKEN}",
      "guildIds": ["123456789"]
    },
    "rest-api": {
      "type": "rest",
      "port": 3000,
      "apiKey": "${REST_API_KEY}"
    }
  },

  "secrets": {
    "provider": "env"
  },

  "database": {
    "url": "${DATABASE_URL}",
    "pool": {
      "min": 2,
      "max": 10
    }
  }
}
```

## Bot Configuration (`bots/{name}/config.json`)

### Minimal Example

```json
{
  "id": "support",
  "soul": "./soul.md",
  "channel": "slack-main"
}
```

### Complete Example

```json
{
  "$schema": "../../schema/bot.schema.json",

  "id": "code-reviewer",
  "enabled": true,
  "name": "Code Review Bot",
  "description": "Reviews pull requests and suggests improvements",

  "soul": "./soul.md",

  "provider": "anthropic",
  "model": "claude-sonnet-4-5",
  "fallbacks": ["claude-haiku-4-5"],
  "temperature": 0.5,
  "maxTokens": 8192,

  "channel": "slack-main",
  "sessionPer": "user",

  "workspace": {
    "root": "./data/code-reviewer",
    "mounts": {
      "/repos": {
        "path": "/home/me/repos",
        "readOnly": true
      }
    }
  },

  "sandbox": {
    "type": "docker",
    "image": "node:22-slim",
    "packages": ["git", "python3", "ripgrep"],
    "network": {
      "mode": "bridge",
      "allowedDomains": ["github.com", "api.github.com"]
    },
    "maxMemory": "2g",
    "maxCpu": 2
  },

  "tools": [
    "bash",
    "readFile",
    "writeFile",
    "glob",
    "grep",
    "webSearch"
  ],

  "maxSteps": 50,

  "mcpServers": ["github", "notion"],

  "skills": [
    "./skills/code-review",
    "npm:@ai-army/skill-jira"
  ],

  "memory": {
    "dir": "memory",
    "compaction": {
      "enabled": true,
      "threshold": 100000,
      "flushBeforeCompact": true
    }
  },

  "restrictions": {
    "allowedUsers": [],
    "deniedUsers": [],
    "allowedChannels": [],
    "deniedChannels": ["#random", "#off-topic"]
  },

  "webhooks": [
    {
      "url": "${WEBHOOK_URL}",
      "events": ["message.processed", "error"],
      "secret": "${WEBHOOK_SECRET}"
    }
  ]
}
```

## Bot Soul File (`bots/{name}/soul.md`)

The soul file defines the bot's personality and instructions.

### Example: Support Bot

```markdown
# Support Bot

You are a helpful customer support assistant for Acme Corp.

## Your Role

- Answer customer questions about our products
- Help troubleshoot common issues
- Escalate complex problems to human agents

## Guidelines

- Be friendly and professional
- Keep responses concise (2-3 sentences when possible)
- If you don't know something, say so and offer to escalate
- Never make promises about pricing or refunds

## Product Knowledge

We offer three products:
1. **Basic Plan** - $10/month, 10GB storage
2. **Pro Plan** - $25/month, 100GB storage, priority support
3. **Enterprise** - Custom pricing, unlimited storage, dedicated support

## Common Issues

### Password Reset
Direct users to: https://acme.com/reset-password

### Billing Questions
Escalate to: billing@acme.com

### Technical Issues
1. Ask them to describe the issue
2. Check if they're on the latest version
3. Ask for error messages if any
4. If unresolved, escalate to: support@acme.com
```

### Example: Code Review Bot

```markdown
# Code Review Bot

You are an expert code reviewer specializing in JavaScript, TypeScript, and React.

## Your Role

Review pull requests and provide constructive feedback on:
- Code quality and best practices
- Potential bugs or edge cases
- Performance concerns
- Security vulnerabilities
- Test coverage

## Review Guidelines

1. **Be Constructive**
   - Highlight what's done well
   - Suggest improvements, don't just criticize
   - Explain the "why" behind suggestions

2. **Focus Areas**
   - Security (XSS, SQL injection, etc.)
   - Performance (unnecessary re-renders, memory leaks)
   - Maintainability (readability, documentation)
   - Testing (edge cases, error handling)

3. **Format**
   ```
   ## 👍 What's Good
   - Clear variable naming
   - Good test coverage

   ## 💡 Suggestions
   - Consider memoizing expensive calculations
   - Add error handling for API calls

   ## ⚠️ Concerns
   - Potential XSS vulnerability on line 42
   ```

## Technologies

You're most knowledgeable about:
- React, Next.js, Vue
- Node.js, Express, Fastify
- PostgreSQL, MongoDB
- Docker, Kubernetes

## Tools Available

- Git for viewing commits
- Grep for searching code patterns
- Web search for looking up best practices
```

## Environment Variables (`.env`)

```bash
# Database
DATABASE_URL=postgresql://ai_army:password@localhost:5432/ai_army

# AI Providers
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
OPENROUTER_API_KEY=sk-or-...

# Slack
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_SIGNING_SECRET=...

# Discord
DISCORD_BOT_TOKEN=...

# MCP Servers
GITHUB_TOKEN=ghp_...
NOTION_TOKEN=secret_...

# Webhooks
WEBHOOK_URL=https://example.com/webhook
WEBHOOK_SECRET=...

# Optional: Secrets Management
BW_CLIENT_ID=...
BW_CLIENT_SECRET=...
```

## Configuration Inheritance

Bot configs inherit from defaults with **deep merge**:

```javascript
// 1. Start with defaults
const defaults = config.defaults;

// 2. Merge with bot config
const botConfig = deepMerge(defaults, botSpecificConfig);

// 3. Apply environment overrides
const finalConfig = applyEnvVars(botConfig);
```

**Example:**

```json
// config.json (defaults)
{
  "defaults": {
    "model": "claude-sonnet-4-5",
    "maxSteps": 30,
    "tools": ["bash", "readFile"]
  }
}

// bots/support/config.json
{
  "maxSteps": 50,  // Override
  "tools": ["bash", "readFile", "webSearch"]  // Override (not merge)
}

// Result:
{
  "model": "claude-sonnet-4-5",     // From defaults
  "maxSteps": 50,                   // Overridden
  "tools": ["bash", "readFile", "webSearch"]  // Overridden
}
```

## Environment Variable Interpolation

### Syntax

```json
{
  "required": "${VAR}",              // Error if not set
  "withDefault": "${VAR:-default}",  // Use default if not set
  "conditional": "${VAR:+value}"     // Use value only if VAR is set
}
```

### Examples

```json
{
  "database": {
    "url": "${DATABASE_URL}",
    "host": "${DB_HOST:-localhost}",
    "port": "${DB_PORT:-5432}",
    "ssl": "${DB_SSL:+true}"
  }
}
```

## Validation

### Startup Validation

The framework validates configuration on startup:

```javascript
// Automatic validation
const orchestrator = new Orchestrator({
  configPath: './config.json'
});

await orchestrator.start();  // Validates before starting
```

### Manual Validation

```bash
# Validate config without starting
npx ai-army validate

# Example output:
✅ config.json is valid
✅ bots/support/config.json is valid
❌ bots/work/config.json: Missing required field 'soul'
```

## Common Patterns

### Multiple Environments

```bash
# Development
cp .env.example .env.dev
vim .env.dev

# Production
cp .env.example .env.prod
vim .env.prod

# Use different env files
NODE_ENV=production node src/index.js  # Uses .env.prod
```

### Per-Bot API Keys

```json
// config.json
{
  "providers": {
    "anthropic-work": {
      "type": "anthropic",
      "apiKey": "${ANTHROPIC_API_KEY_WORK}"
    },
    "anthropic-support": {
      "type": "anthropic",
      "apiKey": "${ANTHROPIC_API_KEY_SUPPORT}"
    }
  }
}

// bots/work/config.json
{
  "provider": "anthropic-work"
}

// bots/support/config.json
{
  "provider": "anthropic-support"
}
```

### Shared Workspaces

```json
// Multiple bots sharing data
{
  "workspace": {
    "root": "./data/my-bot",
    "mounts": {
      "/shared": {
        "path": "./data/shared",  // All bots can access
        "readOnly": false
      }
    }
  }
}
```

### Network Restrictions

```json
// Completely isolated (no network)
{
  "sandbox": {
    "network": {
      "mode": "none"
    }
  }
}

// Allowlist specific domains
{
  "sandbox": {
    "network": {
      "mode": "bridge",
      "allowedDomains": ["github.com", "api.openai.com"]
    }
  }
}

// Full network access
{
  "sandbox": {
    "network": {
      "mode": "bridge",
      "allowedDomains": ["*"]
    }
  }
}
```

## Configuration Best Practices

### 1. Never Commit Secrets

```bash
# Good ✅
.env
*.key
*.pem

# Bad ❌
# config.json with hardcoded keys
```

### 2. Use Descriptive IDs

```json
// Good ✅
{
  "id": "customer-support-bot",
  "id": "code-review-assistant"
}

// Bad ❌
{
  "id": "bot1",
  "id": "bot2"
}
```

### 3. Document Bot Souls

```markdown
<!-- Good ✅ -->
# Support Bot

You are a customer support assistant.

## Guidelines
- Be helpful
- Escalate complex issues

## Tools
- Can search knowledge base
- Can create tickets
```

### 4. Start Conservative

```json
// Good for production ✅
{
  "maxSteps": 20,
  "maxMemory": "512m",
  "network": {
    "allowedDomains": ["api.example.com"]
  }
}

// Too permissive ❌
{
  "maxSteps": 100,
  "maxMemory": "8g",
  "network": {
    "allowedDomains": ["*"]
  }
}
```

## Troubleshooting

### Config Not Loading

```bash
# Check syntax
npx ai-army validate

# Check env vars
printenv | grep ANTHROPIC
```

### Bot Not Starting

```bash
# Check logs
docker-compose logs -f master

# Common issues:
- Missing required fields
- Invalid env var reference
- Soul file not found
```

### MCP Server Failing

```bash
# Test MCP server manually
npx @modelcontextprotocol/server-github

# Check env vars
echo $GITHUB_TOKEN
```

## Next Steps

- 📖 See [Architecture Guide](./architecture.md) for system design
- 🚀 See [Deployment Guide](./deployment.md) for production setup
- 💻 See [Development Guide](./development.md) for local development
