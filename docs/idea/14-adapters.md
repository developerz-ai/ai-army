# Adapters - Extensible Architecture

## Overview

AI Assistants Army uses an **adapter pattern** to make it easy to add:
- **Channel adapters** - New messaging platforms (Discord, Telegram, WhatsApp, Matrix, etc.)
- **Secret adapters** - New secret managers (1Password, AWS Secrets Manager, Vault, etc.)
- **Model adapters** - New AI providers
- **Storage adapters** - Different databases (PostgreSQL, MySQL, MongoDB, etc.)

**Why adapters?** So you can add new integrations without modifying core code. Just implement the interface, register the adapter, done.

## Channel Adapters

### Interface

Every channel adapter implements the same interface:

```typescript
interface ChannelAdapter {
  // Metadata
  type: string;           // 'slack' | 'discord' | 'telegram' | ...
  name: string;

  // Lifecycle
  initialize(config: any): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;

  // Message handling
  onMessage(handler: MessageHandler): void;
  sendMessage(channelId: string, text: string, options?: any): Promise<void>;
  streamMessage(channelId: string, stream: AsyncIterator<string>): Promise<void>;

  // User/channel info
  getUserInfo(userId: string): Promise<UserInfo>;
  getChannelInfo(channelId: string): Promise<ChannelInfo>;
}

interface MessageHandler {
  (message: IncomingMessage): Promise<string>;
}

interface IncomingMessage {
  userId: string;
  userName?: string;
  channelId: string;
  channelName?: string;
  text: string;
  isDM: boolean;
  threadId?: string;
  metadata?: any;
}
```

### Built-in Channel Adapters

| Adapter | Package | Status |
|---------|---------|--------|
| Slack | `@slack/bolt` | ✅ Implemented |
| Discord | `discord.js` | ✅ Implemented |
| Telegram | `telegraf` | 📋 Planned |
| WhatsApp | `whatsapp-web.js` | 📋 Planned |
| Matrix | `matrix-js-sdk` | 📋 Planned |
| REST | Native HTTP | ✅ Implemented |
| CLI | readline | ✅ Implemented |

### Adding a New Channel Adapter

**Example: Telegram Adapter**

```
src/channels/adapters/
├── slack.ts          # Existing
├── discord.ts        # Existing
├── telegram.ts       # New adapter
└── index.ts          # Registry
```

Implement the interface:

```typescript
// src/channels/adapters/telegram.ts
import { Telegraf } from 'telegraf';
import { ChannelAdapter, IncomingMessage } from '../types.js';

export class TelegramAdapter implements ChannelAdapter {
  type = 'telegram';
  name = 'Telegram';

  private bot: Telegraf;
  private messageHandler?: MessageHandler;

  async initialize(config) {
    this.bot = new Telegraf(config.botToken);

    this.bot.on('text', async (ctx) => {
      const message: IncomingMessage = {
        userId: ctx.from.id.toString(),
        userName: ctx.from.username,
        channelId: ctx.chat.id.toString(),
        channelName: ctx.chat.title,
        text: ctx.message.text,
        isDM: ctx.chat.type === 'private'
      };

      if (this.messageHandler) {
        const response = await this.messageHandler(message);
        await ctx.reply(response);
      }
    });
  }

  async start() {
    await this.bot.launch();
  }

  async stop() {
    this.bot.stop();
  }

  onMessage(handler: MessageHandler) {
    this.messageHandler = handler;
  }

  async sendMessage(channelId: string, text: string) {
    await this.bot.telegram.sendMessage(channelId, text);
  }

  async streamMessage(channelId: string, stream: AsyncIterator<string>) {
    let buffer = '';
    let messageId = null;

    for await (const chunk of stream) {
      buffer += chunk;

      if (!messageId) {
        const msg = await this.bot.telegram.sendMessage(channelId, buffer);
        messageId = msg.message_id;
      } else {
        await this.bot.telegram.editMessageText(channelId, messageId, null, buffer);
      }
    }
  }

  async getUserInfo(userId: string) {
    const user = await this.bot.telegram.getChat(userId);
    return {
      id: userId,
      name: user.username || user.first_name,
      displayName: `${user.first_name} ${user.last_name || ''}`.trim()
    };
  }

  async getChannelInfo(channelId: string) {
    const chat = await this.bot.telegram.getChat(channelId);
    return {
      id: channelId,
      name: chat.title || 'DM',
      type: chat.type
    };
  }
}
```

### Register the Adapter

```typescript
// src/channels/adapters/index.ts
import { SlackAdapter } from './slack.js';
import { DiscordAdapter } from './discord.js';
import { TelegramAdapter } from './telegram.js';

export const channelAdapters = new Map([
  ['slack', SlackAdapter],
  ['discord', DiscordAdapter],
  ['telegram', TelegramAdapter],
]);

export function createChannelAdapter(type: string, config: any) {
  const AdapterClass = channelAdapters.get(type);
  if (!AdapterClass) {
    throw new Error(`Unknown channel type: ${type}`);
  }
  return new AdapterClass(config);
}
```

### Use in Config

```json
{
  "channels": {
    "telegram-main": {
      "type": "telegram",
      "botToken": "${TELEGRAM_BOT_TOKEN}"
    }
  },
  "bots": {
    "family": {
      "channel": "telegram-main"
    }
  }
}
```

That's it. The adapter handles all Telegram-specific details.

## Secret Adapters

### Interface

```typescript
interface SecretAdapter {
  type: string;           // 'bitwarden' | '1password' | 'aws' | ...
  name: string;

  initialize(config: any): Promise<void>;
  get(name: string): Promise<string>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<void>;
  list(): Promise<string[]>;
}
```

### Built-in Secret Adapters

| Adapter | Status |
|---------|--------|
| Environment Variables | ✅ Implemented |
| Bitwarden Secrets Manager | ✅ Implemented |
| 1Password | 📋 Planned |
| AWS Secrets Manager | 📋 Planned |
| HashiCorp Vault | 📋 Planned |
| Azure Key Vault | 📋 Planned |

### Adding 1Password Adapter

```typescript
// src/secrets/adapters/onepassword.ts
import { execSync } from 'child_process';
import { SecretAdapter } from '../types.js';

export class OnePasswordAdapter implements SecretAdapter {
  type = '1password';
  name = '1Password';

  private vault: string;

  async initialize(config) {
    this.vault = config.vault;

    // Verify 1Password CLI is available
    try {
      execSync('op --version');
    } catch {
      throw new Error('1Password CLI not installed');
    }

    // Verify authentication
    execSync('op account list');
  }

  async get(name: string): Promise<string> {
    try {
      const result = execSync(
        `op item get "${name}" --vault "${this.vault}" --fields password`,
        { encoding: 'utf8' }
      );
      return result.trim();
    } catch (err) {
      throw new Error(`Failed to get secret ${name} from 1Password: ${err.message}`);
    }
  }

  async set(name: string, value: string): Promise<void> {
    execSync(
      `echo "${value}" | op item create --category=password --title="${name}" --vault="${this.vault}"`,
      { encoding: 'utf8' }
    );
  }

  async delete(name: string): Promise<void> {
    execSync(`op item delete "${name}" --vault "${this.vault}"`);
  }

  async list(): Promise<string[]> {
    const result = execSync(
      `op item list --vault "${this.vault}" --format=json`,
      { encoding: 'utf8' }
    );
    const items = JSON.parse(result);
    return items.map(item => item.title);
  }
}
```

### Register Secret Adapter

```typescript
// src/secrets/adapters/index.ts
import { EnvAdapter } from './env.js';
import { BitwardenAdapter } from './bitwarden.js';
import { OnePasswordAdapter } from './onepassword.js';

export const secretAdapters = new Map([
  ['env', EnvAdapter],
  ['bitwarden', BitwardenAdapter],
  ['1password', OnePasswordAdapter],
]);
```

### Configuration

```json
{
  "secrets": {
    "provider": "1password",
    "config": {
      "vault": "AI Assistants",
      "account": "my-team.1password.com"
    }
  }
}
```

## Model Provider Adapters

### Interface

```typescript
interface ModelAdapter {
  type: string;
  name: string;

  initialize(config: any): Promise<void>;
  createModel(modelName: string): any;  // Returns AI SDK model
  listModels(): Promise<string[]>;
}
```

### Example: Anthropic Adapter

```typescript
// src/models/adapters/anthropic.ts
import { anthropic } from '@ai-sdk/anthropic';

export class AnthropicAdapter implements ModelAdapter {
  type = 'anthropic';
  name = 'Anthropic';

  private apiKey: string;

  async initialize(config) {
    this.apiKey = config.apiKey;
  }

  createModel(modelName: string) {
    return anthropic(modelName, { apiKey: this.apiKey });
  }

  async listModels() {
    return [
      'claude-opus-4-5',
      'claude-sonnet-4-5',
      'claude-haiku-4-5'
    ];
  }
}
```

### Example: OpenRouter Adapter

```typescript
// src/models/adapters/openrouter.ts
import { createOpenAI } from '@ai-sdk/openai';

export class OpenRouterAdapter implements ModelAdapter {
  type = 'openrouter';
  name = 'OpenRouter';

  private client: any;

  async initialize(config) {
    this.client = createOpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: config.apiKey
    });
  }

  createModel(modelName: string) {
    return this.client(modelName);
  }

  async listModels() {
    // Fetch from OpenRouter API
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { 'Authorization': `Bearer ${this.apiKey}` }
    });
    const data = await response.json();
    return data.data.map(m => m.id);
  }
}
```

## Storage Adapters

Support different databases for session/state storage:

### Interface

```typescript
interface StorageAdapter {
  type: string;

  initialize(config: any): Promise<void>;

  // Bots
  getBot(id: string): Promise<BotRecord>;
  saveBo(bot: BotRecord): Promise<void>;
  listBots(filter?: any): Promise<BotRecord[]>;

  // Sessions
  getSession(id: string): Promise<SessionRecord>;
  saveSession(session: SessionRecord): Promise<void>;

  // Tasks
  enqueueTask(task: TaskRecord): Promise<void>;
  dequeueTask(): Promise<TaskRecord | null>;
}
```

### Implementations

| Adapter | Use Case |
|---------|----------|
| PostgreSQL | Production, multi-master |
| SQLite | Single server, simple |
| MongoDB | Document-heavy workloads |
| Redis | High-throughput, ephemeral |
| File (JSONL) | Development, no dependencies |

Each adapter implements the same interface, so you can swap databases by changing config:

```json
{
  "database": {
    "type": "postgres",
    "url": "${DATABASE_URL}"
  }
}
```

vs

```json
{
  "database": {
    "type": "sqlite",
    "path": "./ai-army.db"
  }
}
```

## Adapter Registry

```typescript
// src/core/registry.ts
export class AdapterRegistry {
  private channelAdapters = new Map();
  private secretAdapters = new Map();
  private modelAdapters = new Map();
  private storageAdapters = new Map();

  registerChannel(type: string, adapter: typeof ChannelAdapter) {
    this.channelAdapters.set(type, adapter);
  }

  registerSecret(type: string, adapter: typeof SecretAdapter) {
    this.secretAdapters.set(type, adapter);
  }

  registerModel(type: string, adapter: typeof ModelAdapter) {
    this.modelAdapters.set(type, adapter);
  }

  registerStorage(type: string, adapter: typeof StorageAdapter) {
    this.storageAdapters.set(type, adapter);
  }

  createChannel(type: string, config: any): ChannelAdapter {
    const Adapter = this.channelAdapters.get(type);
    if (!Adapter) throw new Error(`Unknown channel type: ${type}`);
    return new Adapter(config);
  }

  // ... similar for other adapter types
}
```

### Plugin System

Third-party adapters can be loaded as plugins:

```json
{
  "plugins": [
    "npm:@ai-army/adapter-whatsapp",
    "npm:@ai-army/adapter-matrix",
    "./plugins/custom-adapter.js"
  ]
}
```

Plugin structure:

```javascript
// plugins/custom-adapter.js
export default {
  name: 'custom-adapter',
  version: '1.0.0',

  register(registry) {
    // Register adapters
    registry.registerChannel('whatsapp', WhatsAppAdapter);
    registry.registerSecret('custom-vault', CustomVaultAdapter);
  }
};
```

## Benefits of Adapter Pattern

### 1. Easy to Add New Platforms

Want to add Microsoft Teams support?

1. Create `src/channels/adapters/teams.ts`
2. Implement `ChannelAdapter` interface
3. Register in `index.ts`
4. Use in config: `"type": "teams"`

No changes to core orchestration code.

### 2. Easy to Add New Secret Managers

Want to use AWS Secrets Manager?

1. Create `src/secrets/adapters/aws.ts`
2. Implement `SecretAdapter` interface
3. Register in `index.ts`
4. Use in config: `"provider": "aws"`

### 3. Easy to Test

Mock adapters for testing:

```typescript
class MockChannelAdapter implements ChannelAdapter {
  messages: string[] = [];

  async sendMessage(channelId: string, text: string) {
    this.messages.push(text);
  }

  // ... implement interface
}

// Use in tests
const adapter = new MockChannelAdapter(config);
await bot.sendMessage('test');
assert(adapter.messages.length === 1);
```

### 4. Mix and Match

Different bots can use different adapters:

```json
{
  "bots": {
    "work": {
      "channel": {"type": "slack"},
      "secrets": {"provider": "bitwarden"}
    },
    "family": {
      "channel": {"type": "discord"},
      "secrets": {"provider": "1password"}
    },
    "customer-123": {
      "channel": {"type": "telegram"},
      "secrets": {"provider": "aws"}
    }
  }
}
```

## Available Adapters Documentation

Each adapter should have:

```
docs/adapters/
├── channels/
│   ├── slack.md          # How to setup Slack adapter
│   ├── discord.md        # How to setup Discord adapter
│   └── telegram.md       # How to setup Telegram adapter
│
└── secrets/
    ├── bitwarden.md      # How to setup Bitwarden
    ├── 1password.md      # How to setup 1Password
    └── aws-secrets.md    # How to setup AWS Secrets Manager
```

### Example: Slack Adapter Setup

```markdown
# Slack Channel Adapter

## Prerequisites

1. Go to https://api.slack.com/apps
2. Create new app
3. Enable Socket Mode
4. Add bot scopes: `app_mentions:read`, `chat:write`, `channels:history`
5. Install to workspace

## Configuration

{
  "channels": {
    "my-slack": {
      "type": "slack",
      "botToken": "${SLACK_BOT_TOKEN}",      // xoxb-...
      "appToken": "${SLACK_APP_TOKEN}",      // xapp-...
      "signingSecret": "${SLACK_SIGNING_SECRET}"
    }
  }
}

## Features

- Direct messages
- Channel mentions (@botname)
- Thread replies
- Typing indicators (via message updates)
- File uploads
- Rich formatting (markdown → Slack blocks)

## Restrictions

Supports:
- `allowedUsers`: User IDs (U12345) or usernames
- `allowedChannels`: Channel IDs (C12345) or names (#engineering)
- `deniedChannels`
- `dmAllowed`
```

## Future Adapters

### Voice Channels

- **Twilio** - Phone calls
- **Discord Voice** - Voice chat
- **Zoom** - Meeting bot

### Email

- **IMAP/SMTP** - Email inbox monitoring
- **Gmail API** - Native Gmail integration

### Chat Platforms

- **Microsoft Teams**
- **Mattermost**
- **Rocket.Chat**
- **Matrix**

### Collaboration Tools

- **Notion** - Respond to comments
- **Linear** - Respond to issue comments
- **Asana** - Task comments

All follow the same pattern: implement the interface, register, configure.

## Summary

Adapters make the system **extensible without core changes**:

- **Channel adapters** → Add new messaging platforms
- **Secret adapters** → Add new credential managers
- **Model adapters** → Add new AI providers
- **Storage adapters** → Add new databases

**To add a feature:** Implement interface, register adapter, update config.

This keeps the core simple while allowing unlimited extensibility.
