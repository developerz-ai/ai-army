# Configuration - JSON Config Structure

## Overview

All configuration is defined in JSON files. No UI, no CLI wizards. Edit JSON, restart, done.

## Directory Structure

```
config/
├── config.json           # Main configuration (providers, mcpServers, defaults)
├── workers.json          # Worker server definitions
└── bots/
    ├── work/
    │   ├── config.json   # Bot-specific overrides
    │   └── soul.md       # Bot personality/instructions
    ├── family/
    │   ├── config.json
    │   └── soul.md
    └── devops/
        ├── config.json
        └── soul.md
```

## Main Configuration (config/config.json)

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
      "maxCpu": 1
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
      "apiKey": "${ANTHROPIC_API_KEY}"
    },
    "openrouter": {
      "type": "openrouter",
      "apiKey": "${OPENROUTER_API_KEY}"
    },
    "openai": {
      "type": "openai",
      "apiKey": "${OPENAI_API_KEY}"
    },
    "ollama": {
      "type": "custom",
      "baseUrl": "http://localhost:11434/v1",
      "apiKey": "ollama"
    },
    "local-vllm": {
      "type": "custom",
      "baseUrl": "http://gpu-server:8000/v1",
      "apiKey": "${VLLM_API_KEY}"
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
    },
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": {
        "DATABASE_URL": "${DATABASE_URL}"
      }
    },
    "slack-search": {
      "command": "node",
      "args": ["./mcp-servers/slack-search/index.js"],
      "env": {
        "SLACK_TOKEN": "${SLACK_USER_TOKEN}"
      }
    }
  },

  "channels": {
    "slack-main": {
      "type": "slack",
      "botToken": "${SLACK_BOT_TOKEN}",
      "appToken": "${SLACK_APP_TOKEN}",
      "signingSecret": "${SLACK_SIGNING_SECRET}"
    },
    "slack-dev": {
      "type": "slack",
      "botToken": "${SLACK_DEV_BOT_TOKEN}",
      "appToken": "${SLACK_DEV_APP_TOKEN}",
      "signingSecret": "${SLACK_DEV_SIGNING_SECRET}"
    },
    "discord-main": {
      "type": "discord",
      "botToken": "${DISCORD_BOT_TOKEN}",
      "guildIds": ["123456789", "987654321"]
    }
  },

  "secrets": {
    "provider": "bitwarden",
    "config": {
      "server": "${BW_SERVER}",
      "clientId": "${BW_CLIENT_ID}",
      "clientSecret": "${BW_CLIENT_SECRET}",
      "collectionId": "ai-army-secrets"
    }
  }
}
```

## Bot Configuration (config/bots/{name}/config.json)

Each bot has its own config that can override defaults:

```json
{
  "$schema": "../../schema/bot.schema.json",

  "id": "work",
  "enabled": true,
  "name": "Aria",
  "description": "Engineering team assistant",

  "soul": "./soul.md",

  "provider": "anthropic",
  "model": "claude-sonnet-4-5",
  "fallbacks": ["claude-haiku-4-5"],

  "channel": "slack-main",
  "sessionPer": "user",

  "workspace": {
    "root": "./data/work",
    "mounts": {
      "/repos": {
        "path": "/home/me/repos",
        "readOnly": true
      },
      "/shared": {
        "path": "./data/shared",
        "readOnly": false
      }
    }
  },

  "sandbox": {
    "type": "docker",
    "image": "node:22-slim",
    "packages": ["git", "python3", "ripgrep"],
    "network": {
      "allowedDomains": ["github.com", "api.github.com", "npmjs.org"]
    },
    "maxMemory": "2g",
    "maxCpu": 2
  },

  "tools": ["bash", "readFile", "writeFile", "glob", "grep", "webSearch"],
  "maxSteps": 50,

  "mcpServers": ["github", "notion"],

  "skills": [
    "./skills/code-review",
    "./skills/jira-triage"
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
  }
}
```

## Configuration Inheritance

Bot configs inherit from defaults, with deep merge:

```javascript
// Resolution order (later overrides earlier)
const effectiveConfig = deepMerge(
  defaults,           // from config.json
  botConfig,          // from bots/{name}/config.json
  environmentOverrides // from env vars
);
```

## Environment Variable Interpolation

Any value can reference environment variables:

```json
{
  "apiKey": "${ANTHROPIC_API_KEY}",
  "host": "${DB_HOST:-localhost}",
  "port": "${DB_PORT:-5432}"
}
```

Syntax:
- `${VAR}` - Required, error if not set
- `${VAR:-default}` - Use default if not set
- `${VAR:+value}` - Use value only if VAR is set

## Configuration Validation

JSON Schema validation on startup:

```javascript
// src/config/validator.ts
import Ajv from 'ajv';

const ajv = new Ajv({ allErrors: true });

export function validateConfig(config, schema) {
  const validate = ajv.compile(schema);
  const valid = validate(config);

  if (!valid) {
    throw new ConfigValidationError(validate.errors);
  }

  return config;
}
```

## Hot Reload

Watch config files for changes:

```javascript
// src/config/watcher.ts
import { watch } from 'chokidar';

export function watchConfig(configPath, onReload) {
  const watcher = watch(configPath, {
    persistent: true,
    ignoreInitial: true
  });

  watcher.on('change', async (path) => {
    console.log(`Config changed: ${path}`);
    try {
      const newConfig = await loadAndValidate(configPath);
      await onReload(newConfig);
    } catch (err) {
      console.error(`Invalid config, keeping old: ${err.message}`);
    }
  });
}
```

## Complete Example

```json
{
  "providers": {
    "anthropic": {
      "type": "anthropic",
      "apiKey": "${ANTHROPIC_API_KEY}"
    }
  },

  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }
    }
  },

  "channels": {
    "slack-main": {
      "type": "slack",
      "botToken": "${SLACK_BOT_TOKEN}",
      "appToken": "${SLACK_APP_TOKEN}"
    }
  },

  "bots": {
    "work": {
      "soul": "./bots/work/soul.md",
      "provider": "anthropic",
      "model": "claude-sonnet-4-5",
      "channel": "slack-main",

      "workspace": {
        "root": "./data/work"
      },

      "sandbox": {
        "type": "docker",
        "image": "node:22-slim"
      },

      "tools": ["bash", "readFile", "writeFile"],
      "mcpServers": ["github"],
      "skills": []
    }
  }
}
```

## TypeScript Types

```typescript
// src/types/config.ts

export interface Config {
  defaults?: DefaultConfig;
  providers: Record<string, ProviderConfig>;
  mcpServers: Record<string, McpServerConfig>;
  channels: Record<string, ChannelConfig>;
  secrets?: SecretsConfig;
  bots?: Record<string, BotConfig>;
}

export interface ProviderConfig {
  type: 'anthropic' | 'openai' | 'openrouter' | 'google' | 'custom';
  apiKey: string;
  baseUrl?: string;
}

export interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface ChannelConfig {
  type: 'slack' | 'discord' | 'telegram' | 'cli';
  botToken: string;
  appToken?: string;
  guildIds?: string[];
}

export interface BotConfig {
  id: string;
  enabled?: boolean;
  name?: string;
  description?: string;

  soul: string;

  provider: string;
  model: string;
  fallbacks?: string[];

  channel: string;
  sessionPer?: 'user' | 'channel' | 'thread';

  workspace: WorkspaceConfig;
  sandbox: SandboxConfig;

  tools: string[];
  maxSteps?: number;

  mcpServers: string[];
  skills: string[];

  memory?: MemoryConfig;
  restrictions?: RestrictionsConfig;
}

export interface SandboxConfig {
  type: 'docker' | 'just-bash';
  image?: string;
  packages?: string[];
  network?: {
    allowedDomains: string[];
  };
  maxMemory?: string;
  maxCpu?: number;
}
```
