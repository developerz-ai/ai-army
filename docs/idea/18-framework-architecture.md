# Framework Architecture - Build Your Own AI Army

## Overview

**AI Assistants Army is a framework, like Ruby on Rails for AI bots.**

Users create their own repository where they:
- Define their bots (JSON + Markdown + Dockerfiles)
- **Everything under version control** (git)
- Use the framework as a dependency
- Deploy with their preferred tools (Docker Compose, Capistrano, Kubernetes, etc.)

Think of it like:
- **Rails** for web apps → **AI Army** for AI bots
- **Express.js** for APIs → **AI Army** for multi-bot systems
- **Next.js** for React → **AI Army** for AI orchestration

## Framework vs Application

### What It Is NOT

- ❌ A hosted service you sign up for
- ❌ A binary you download and configure
- ❌ An application with a UI

### What It IS

- ✅ An npm package you install: `npm install ai-assistants-army`
- ✅ A framework you build on top of
- ✅ A set of conventions (config structure, bot directories)
- ✅ Adapters for channels, secrets, models, storage
- ✅ Orchestration engine (PostgreSQL-based)

## User's Project Structure

When someone uses the framework, their repo looks like:

```
my-ai-army/                    # User's repository
├── package.json               # Dependencies include ai-assistants-army
├── docker-compose.yml         # User's deployment config
├── .env                       # Secrets (not committed)
│
├── config.json                # Main config
│
├── bots/                      # User defines their bots here
│   ├── support-agent/
│   │   ├── config.json
│   │   ├── soul.md
│   │   └── Dockerfile (optional)
│   │
│   ├── code-reviewer/
│   │   ├── config.json
│   │   └── soul.md
│   │
│   └── devops-bot/
│       ├── config.json
│       ├── soul.md
│       └── Dockerfile
│
├── skills/                    # User's custom skills
│   └── custom-skill/
│       └── SKILL.md
│
├── data/                      # Bot workspaces (created at runtime)
│   ├── support-agent/
│   ├── code-reviewer/
│   └── devops-bot/
│
└── migrations/                # Custom DB migrations (optional)
    └── 001_custom_tables.sql
```

## Framework Package Structure

The framework itself (published as npm package):

```
ai-assistants-army/            # Framework repository (npm package)
├── package.json
│   {
│     "name": "ai-assistants-army",
│     "version": "1.0.0",
│     "exports": {
│       ".": "./dist/index.js",
│       "./adapters/*": "./dist/adapters/*.js"
│     }
│   }
│
├── src/
│   ├── index.ts               # Main exports
│   ├── core/
│   │   ├── orchestrator.ts    # Core orchestration
│   │   ├── bot-manager.ts
│   │   └── session-manager.ts
│   │
│   ├── adapters/
│   │   ├── channels/
│   │   │   ├── slack.ts
│   │   │   ├── discord.ts
│   │   │   └── rest.ts
│   │   │
│   │   ├── secrets/
│   │   │   ├── env.ts
│   │   │   ├── bitwarden.ts
│   │   │   └── onepassword.ts
│   │   │
│   │   ├── models/
│   │   │   ├── anthropic.ts
│   │   │   ├── openrouter.ts
│   │   │   └── openai.ts
│   │   │
│   │   └── storage/
│   │       ├── postgres.ts
│   │       ├── sqlite.ts
│   │       └── file.ts
│   │
│   ├── execution/
│   │   ├── docker-manager.ts
│   │   └── container-pool.ts
│   │
│   ├── queue/
│   │   ├── message-queue.ts
│   │   └── task-queue.ts
│   │
│   └── webhooks/
│       └── manager.ts
│
├── migrations/                # Base schema migrations
│   ├── 001_initial.sql
│   ├── 002_templates.sql
│   └── 003_queue.sql
│
├── templates/                 # Example bot templates
│   └── basic/
│       ├── config.json
│       └── soul.md
│
└── docs/                      # Framework documentation
```

## Usage in User's Project

### Installation

```bash
# Create new project
mkdir my-ai-army
cd my-ai-army
npm init -y

# Install framework
npm install ai-assistants-army

# Initialize project
npx ai-army init
```

This creates:
- `config.json` template
- `bots/` directory with example
- `docker-compose.yml`
- `.env.example`

### Programmatic Usage

```javascript
// index.js - User's entry point
import { Orchestrator } from 'ai-assistants-army';

const orchestrator = new Orchestrator({
  configPath: './config.json',
  database: {
    url: process.env.DATABASE_URL
  }
});

await orchestrator.start();
```

### Custom Deployment Script

```javascript
// deploy.js
import { Orchestrator } from 'ai-assistants-army';
import { MyCustomAdapter } from './adapters/custom.js';

const orchestrator = new Orchestrator({
  configPath: './config.json'
});

// Register custom adapters
orchestrator.registerChannelAdapter('custom', MyCustomAdapter);

// Add custom middleware
orchestrator.use(async (message, next) => {
  console.log('Message received:', message.text);
  await next();
});

await orchestrator.start();
```

## Framework Exports

```typescript
// Main exports from ai-assistants-army

// Core
export { Orchestrator } from './core/orchestrator';
export { BotManager } from './core/bot-manager';
export { SessionManager } from './core/session-manager';

// Adapters
export { SlackAdapter } from './adapters/channels/slack';
export { DiscordAdapter } from './adapters/channels/discord';
export { RESTAdapter } from './adapters/channels/rest';

export { BitwardenAdapter } from './adapters/secrets/bitwarden';
export { OnePasswordAdapter } from './adapters/secrets/onepassword';

export { PostgresStorage } from './adapters/storage/postgres';
export { SQLiteStorage } from './adapters/storage/sqlite';

// Utilities
export { createBotConfig, validateConfig } from './utils/config';
export { loadSoulFile, parseSoulMarkdown } from './utils/soul';

// Types
export type {
  BotConfig,
  TemplateConfig,
  ChannelAdapter,
  SecretAdapter,
  StorageAdapter
} from './types';
```

## CLI Tool

The framework includes a CLI for common tasks:

```bash
# Initialize new project
npx ai-army init

# Validate configuration
npx ai-army validate

# Create new bot from template
npx ai-army create-bot my-bot --template support-agent

# Run database migrations
npx ai-army migrate

# Start in development mode
npx ai-army dev

# Deploy to production
npx ai-army deploy --env production

# Check status
npx ai-army status

# Scale bots
npx ai-army scale work-bot --instances 3
```

## Deployment Methods

### Method 1: Docker Compose (Recommended)

User creates their own `docker-compose.yml`:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16
    volumes:
      - ./data/postgres:/var/lib/postgresql/data

  ai-army:
    image: node:22-slim
    working_dir: /app
    command: npm start
    environment:
      DATABASE_URL: postgres://ai_army:${DB_PASSWORD}@postgres:5432/ai_army
    volumes:
      - .:/app
      - ./data:/app/data
      - /var/run/docker.sock:/var/run/docker.sock
    depends_on:
      - postgres
```

```bash
docker-compose up -d
```

### Method 2: Systemd Service

```ini
# /etc/systemd/system/ai-army.service
[Unit]
Description=AI Assistants Army
After=network.target postgresql.service

[Service]
Type=simple
User=ai-army
WorkingDirectory=/opt/ai-army
ExecStart=/usr/bin/npm start
Restart=always

Environment="DATABASE_URL=postgres://..."
EnvironmentFile=/opt/ai-army/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable ai-army
sudo systemctl start ai-army
```

### Method 3: Capistrano

```ruby
# config/deploy.rb
set :application, "my-ai-army"
set :repo_url, "git@github.com:me/my-ai-army.git"
set :deploy_to, "/opt/ai-army"

namespace :deploy do
  task :restart do
    on roles(:app) do
      execute "cd #{current_path} && docker-compose up -d --build"
    end
  end

  task :migrate do
    on roles(:app) do
      execute "cd #{current_path} && npx ai-army migrate"
    end
  end
end

after 'deploy:publishing', 'deploy:migrate'
after 'deploy:publishing', 'deploy:restart'
```

```bash
cap production deploy
```

### Method 4: Kubernetes

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ai-army-master
spec:
  replicas: 2
  template:
    spec:
      containers:
      - name: master
        image: yourorg/my-ai-army:latest
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: ai-army-secrets
              key: database-url
        volumeMounts:
        - name: config
          mountPath: /app/config
        - name: bots
          mountPath: /app/bots
      volumes:
      - name: config
        configMap:
          name: ai-army-config
      - name: bots
        configMap:
          name: ai-army-bots
```

## Framework Configuration

The framework has sensible defaults, overridable:

```javascript
// User's index.js
import { Orchestrator } from 'ai-assistants-army';

const orchestrator = new Orchestrator({
  // Config
  configPath: './config.json',
  botsPath: './bots',
  dataPath: './data',

  // Database
  database: {
    url: process.env.DATABASE_URL,
    pool: { min: 2, max: 10 }
  },

  // Defaults
  defaults: {
    maxSteps: 30,
    timeout: 120000,
    sandbox: {
      type: 'docker',
      image: 'node:22-slim'
    }
  },

  // Custom adapters
  adapters: {
    channels: {
      telegram: MyTelegramAdapter
    },
    secrets: {
      '1password': My1PasswordAdapter
    }
  },

  // Hooks
  hooks: {
    beforeMessage: async (message) => {
      console.log('Received:', message.text);
    },
    afterMessage: async (message, response) => {
      console.log('Responded:', response);
    },
    onError: async (error) => {
      console.error('Error:', error);
    }
  }
});

await orchestrator.start();
```

## Starter Templates

The framework provides starter templates:

```bash
# Initialize from template
npx ai-army init --template basic
npx ai-army init --template slack-bot
npx ai-army init --template multi-channel
npx ai-army init --template saas
```

### basic template

```
my-ai-army/
├── package.json
├── docker-compose.yml
├── config.json
└── bots/
    └── assistant/
        ├── config.json
        └── soul.md
```

### slack-bot template

```
my-slack-bot/
├── package.json
├── docker-compose.yml
├── config.json
└── bots/
    ├── support/
    ├── engineering/
    └── general/
```

### saas template

```
my-saas-ai/
├── package.json
├── docker-compose.yml
├── config.json
├── templates/
│   └── customer-assistant/
└── migrations/
    └── 001_customers.sql
```

## Plugin System

Users can publish and share adapters:

```bash
# Install community adapter
npm install @ai-army/adapter-whatsapp

# Use in config
{
  "channels": {
    "whatsapp": {
      "type": "whatsapp",
      "requires": "@ai-army/adapter-whatsapp"
    }
  }
}
```

Or register programmatically:

```javascript
import { WhatsAppAdapter } from '@ai-army/adapter-whatsapp';

orchestrator.registerChannelAdapter('whatsapp', WhatsAppAdapter);
```

## PostgreSQL as Central Nervous System

Everything flows through PostgreSQL:

### 1. Orchestration
- Bot registry (`bots` table)
- Worker registry (`workers` table)
- Bot-to-worker assignments

### 2. Messaging
- Message queue (`message_queue` table)
- Session storage (`sessions` table)
- Real-time via LISTEN/NOTIFY

### 3. Logging
- Tool calls (`tool_calls` table)
- Errors (`errors` table)
- Audit trail (`audit_log` table)

### 4. Metrics
- Usage stats per bot
- Performance metrics
- Queue depths

### 5. Configuration
- Can store bot configs in DB (optional)
- Template definitions
- Dynamic instance creation

## Framework Benefits

### For Users

- **No boilerplate** - Framework handles orchestration, sessions, queuing
- **Just define bots** - Write soul.md and config.json
- **Use familiar tools** - Docker Compose, systemd, Kubernetes
- **Extend easily** - Add adapters for your needs
- **Own the deployment** - Your infrastructure, your control

### For Framework

- **Focused scope** - Just orchestration and adapters
- **No UI maintenance** - Users handle their own monitoring
- **No hosting costs** - Users deploy themselves
- **Easy to test** - Unit tests for adapters
- **Community adapters** - Ecosystem of extensions

## Example: Real User Project

### package.json

```json
{
  "name": "acme-ai-team",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "ai-assistants-army": "^1.0.0",
    "@ai-army/adapter-linear": "^1.0.0"
  },
  "scripts": {
    "start": "ai-army start",
    "dev": "ai-army dev",
    "migrate": "ai-army migrate",
    "validate": "ai-army validate"
  }
}
```

### config.json

```json
{
  "database": {
    "url": "${DATABASE_URL}"
  },

  "providers": {
    "anthropic": {
      "type": "anthropic",
      "apiKey": "${ANTHROPIC_API_KEY}"
    }
  },

  "bots": {
    "support": {
      "soul": "./bots/support/soul.md",
      "provider": "anthropic",
      "model": "claude-sonnet-4-5",
      "channel": {
        "type": "slack",
        "botToken": "${SLACK_BOT_TOKEN}",
        "appToken": "${SLACK_APP_TOKEN}"
      }
    }
  }
}
```

### Deploy

```bash
# Install dependencies
npm install

# Run migrations
npm run migrate

# Start
npm start

# Or with Docker Compose
docker-compose up -d
```

## Framework Versioning

Users pin to specific framework versions:

```json
{
  "dependencies": {
    "ai-assistants-army": "^1.2.0"  // User controls version
  }
}
```

Framework follows semver:
- `1.0.0` → `1.1.0` - New adapters, features (backward compatible)
- `1.1.0` → `2.0.0` - Breaking changes (migration guide provided)

## Configuration Validation

Framework validates user config on startup:

```javascript
// src/config/validator.ts
export function validateConfig(config) {
  const errors = [];

  // Check required fields
  if (!config.database?.url) {
    errors.push('database.url is required');
  }

  // Check bots
  for (const [botId, bot] of Object.entries(config.bots || {})) {
    if (!bot.soul) {
      errors.push(`Bot ${botId}: soul file required`);
    }
    if (!bot.provider) {
      errors.push(`Bot ${botId}: provider required`);
    }
    // ... more checks
  }

  if (errors.length) {
    throw new ConfigValidationError(errors);
  }

  return config;
}
```

## Extensibility Points

Users can extend the framework:

### 1. Custom Channel Adapter

```javascript
// adapters/teams.js
import { ChannelAdapter } from 'ai-assistants-army';

export class TeamsAdapter extends ChannelAdapter {
  async initialize(config) {
    // Initialize Teams SDK
  }

  async sendMessage(channelId, text) {
    // Send to Teams
  }
}

// index.js
import { Orchestrator } from 'ai-assistants-army';
import { TeamsAdapter } from './adapters/teams.js';

const orch = new Orchestrator({ configPath: './config.json' });
orch.registerChannelAdapter('teams', TeamsAdapter);
await orch.start();
```

### 2. Custom Tool

```javascript
// tools/jira.js
import { tool } from 'ai';

export const jiraTool = tool({
  description: 'Create a Jira ticket',
  parameters: z.object({
    title: z.string(),
    description: z.string()
  }),
  execute: async ({ title, description }) => {
    // Call Jira API
  }
});

// Add to bot
orchestrator.registerTool('jira', jiraTool);
```

### 3. Custom Middleware

```javascript
orchestrator.use(async (message, next) => {
  // Rate limiting
  if (!await checkRateLimit(message.userId)) {
    return "Too many requests";
  }

  // Log to custom system
  await logMessage(message);

  // Continue
  return await next();
});
```

## Framework Updates

Users upgrade like any npm package:

```bash
# Check for updates
npm outdated

# Upgrade
npm install ai-assistants-army@latest

# Run new migrations
npx ai-army migrate

# Restart
docker-compose restart
```

Framework provides migration guides for breaking changes.

## Configuration Presets

Framework includes presets for common scenarios:

```javascript
import { Orchestrator, presets } from 'ai-assistants-army';

// Use preset
const config = presets.slackBot({
  botToken: process.env.SLACK_BOT_TOKEN,
  model: 'claude-sonnet-4-5'
});

const orch = new Orchestrator({ config });
await orch.start();
```

Available presets:
- `slackBot()` - Single Slack bot
- `multiChannel()` - Slack + Discord + REST
- `saas()` - Multi-tenant setup
- `enterprise()` - Multi-master, HA

## Framework Philosophy

### Do One Thing Well

The framework handles:
- ✅ Orchestration (routing messages to bots)
- ✅ Session management (conversation history)
- ✅ Execution (Docker containers)
- ✅ Queuing (concurrent messages)
- ✅ Adapters (channels, secrets, models)

The framework does NOT handle:
- ❌ UI/dashboards (users build their own if needed)
- ❌ Analytics platform (use PostgreSQL + your tools)
- ❌ Billing/payments (SaaS users implement)
- ❌ User management (users implement)

### Convention Over Configuration

Sensible defaults:
- Bots live in `bots/` directory
- Data lives in `data/` directory
- Config is `config.json`
- Soul files are `soul.md`

But all paths are configurable if you want different structure.

### Bring Your Own Tools

Framework is deployment-agnostic:
- Use Docker Compose? ✅
- Use Kubernetes? ✅
- Use systemd? ✅
- Use Capistrano? ✅
- Use Ansible? ✅

Framework just needs:
- PostgreSQL connection
- Docker access
- Config files

## Community Ecosystem

### Official Adapters (maintained by framework)

- Channels: Slack, Discord, REST
- Secrets: Bitwarden, 1Password, env vars
- Storage: PostgreSQL, SQLite
- Models: Anthropic, OpenAI, OpenRouter

### Community Adapters (published by users)

- `@ai-army/adapter-telegram`
- `@ai-army/adapter-whatsapp`
- `@ai-army/adapter-vault`
- `@ai-army/adapter-aws-secrets`
- `@ai-army/adapter-mongodb`

### Skills Marketplace

- `@ai-army/skill-code-review`
- `@ai-army/skill-jira-triage`
- `@ai-army/skill-deploy`

Install and use:
```bash
npm install @ai-army/skill-code-review
```

```json
{
  "skills": ["npm:@ai-army/skill-code-review"]
}
```

## Summary

**AI Assistants Army is a framework:**

- Users create their own repo with bot definitions
- Install framework as npm dependency
- Define bots in JSON + Markdown + Dockerfiles
- Deploy with their preferred tools
- Extend with custom adapters
- PostgreSQL handles all orchestration, messaging, logging
- No UI needed - just config files

**Philosophy:** Provide the engine, users build the car.
