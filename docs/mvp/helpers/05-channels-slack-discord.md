# Channel Integration Libraries (Slack & Discord)

**Problem Areas**:
- Slack bot integration with Socket Mode
- Discord bot with proper intents
- Message handling and formatting
- Event listeners and callbacks

---

## Slack Integration

### ✅ Recommended: @slack/bolt
**Install**: `npm install @slack/bolt`

**Why**: Official Slack SDK, Socket Mode built-in, comprehensive event handling, actively maintained

**Socket Mode Setup** (No public URL needed):
```javascript
import { App } from '@slack/bolt';

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,          // xoxb-...
  appToken: process.env.SLACK_APP_TOKEN,       // xapp-...
  socketMode: true,                            // ✅ No ngrok needed!
  signingSecret: process.env.SLACK_SIGNING_SECRET
});

// Start
await app.start();
console.log('⚡️ Slack bot is running!');
```

**Requirements**:
1. **Bot Token Scopes**: `app_mentions:read`, `chat:write`, `channels:history`, `im:history`
2. **App-Level Token**: Scopes `connections:write`, `authorizations:read`
3. **Socket Mode**: Enabled in Settings > Socket Mode

**Message Handling**:
```javascript
// Handle @mentions
app.event('app_mention', async ({ event, client }) => {
  const text = event.text.replace(/<@[A-Z0-9]+>/g, '').trim(); // Remove mentions

  await client.chat.postMessage({
    channel: event.channel,
    text: 'Response here',
    thread_ts: event.thread_ts || event.ts // Reply in thread
  });
});

// Handle DMs
app.event('message', async ({ event, client }) => {
  if (event.channel_type === 'im') {
    // Direct message
    await client.chat.postMessage({
      channel: event.channel,
      text: 'DM response'
    });
  }
});
```

**Sources**:
- [Using Socket Mode | Slack Developer Docs](https://docs.slack.dev/tools/bolt-js/concepts/socket-mode/)
- [Quickstart with Bolt for JavaScript](https://docs.slack.dev/tools/bolt-js/getting-started/)
- [Build a Slackbot with Bolt - LogRocket](https://blog.logrocket.com/build-a-slackbot-in-node-js-with-slacks-bolt-api/)

---

## Slack Adapter Implementation

```javascript
// src/adapters/channels/SlackAdapter.js
import { App } from '@slack/bolt';

export class SlackAdapter {
  constructor(config) {
    this.config = config;
    this.app = null;
    this.messageHandler = null;
  }

  async initialize() {
    this.app = new App({
      token: this.config.botToken,
      appToken: this.config.appToken,
      socketMode: true,
      signingSecret: this.config.signingSecret
    });

    // Register event listeners
    this._setupEventHandlers();
  }

  _setupEventHandlers() {
    // App mentions (@botname)
    this.app.event('app_mention', async ({ event, client }) => {
      if (!this.messageHandler) return;

      const message = {
        type: 'slack',
        userId: event.user,
        channelId: event.channel,
        text: this.cleanMention(event.text),
        isDM: false,
        threadTs: event.thread_ts || event.ts
      };

      await this.messageHandler(message);
    });

    // Direct messages
    this.app.event('message', async ({ event, client }) => {
      if (event.channel_type !== 'im') return;
      if (event.subtype) return; // Skip bot messages

      if (!this.messageHandler) return;

      const message = {
        type: 'slack',
        userId: event.user,
        channelId: event.channel,
        text: event.text,
        isDM: true,
        threadTs: null
      };

      await this.messageHandler(message);
    });
  }

  cleanMention(text) {
    // Remove <@U123ABC> mentions
    return text.replace(/<@[A-Z0-9]+>/g, '').trim();
  }

  onMessage(handler) {
    this.messageHandler = handler;
  }

  async start() {
    await this.app.start();
  }

  async stop() {
    await this.app.stop();
  }

  async sendMessage(channelId, text, threadTs) {
    await this.app.client.chat.postMessage({
      channel: channelId,
      text,
      thread_ts: threadTs
    });
  }
}
```

---

## Discord Integration

### ✅ Recommended: discord.js v14
**Install**: `npm install discord.js`

**Why**: Official Discord library, comprehensive API coverage, active community, excellent TypeScript support

**Critical: Gateway Intents** (v14 requirement):
```javascript
import { Client, GatewayIntentBits } from 'discord.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent  // ⚠️ REQUIRED for message.content
  ]
});
```

**Important**: Enable "Message Content Intent" in Discord Developer Portal > Bot > Privileged Gateway Intents

**Message Handling**:
```javascript
client.on('messageCreate', async (message) => {
  // Ignore bot messages
  if (message.author.bot) return;

  // Check if bot was mentioned
  if (message.mentions.has(client.user)) {
    await message.reply('Response here');
  }

  // Or DM
  if (message.channel.type === 'DM') {
    await message.reply('DM response');
  }
});

await client.login(process.env.DISCORD_TOKEN);
```

**Message Length Limit** (2000 chars):
```javascript
function splitMessage(text, maxLength = 2000) {
  if (text.length <= maxLength) return [text];

  const chunks = [];
  let current = '';

  for (const line of text.split('\n')) {
    if (current.length + line.length + 1 > maxLength) {
      chunks.push(current);
      current = line;
    } else {
      current += (current ? '\n' : '') + line;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}
```

**Sources**:
- [discord.js Guide](https://discordjs.guide/)
- [Updating to v14 | discord.js](https://discordjs.guide/legacy/additional-info/changes-in-v14)
- [Gateway Intents | discord.js](https://discordjs.guide/legacy/popular-topics/intents)
- [Discord Gateway Intents Explainer](https://gist.github.com/advaith1/e69bcc1cdd6d0087322734451f15aa2f)

---

## Discord Adapter Implementation

```javascript
// src/adapters/channels/DiscordAdapter.js
import { Client, GatewayIntentBits } from 'discord.js';

export class DiscordAdapter {
  constructor(config) {
    this.config = config;
    this.client = null;
    this.messageHandler = null;
  }

  async initialize() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent // Required!
      ]
    });

    this._setupEventHandlers();
  }

  _setupEventHandlers() {
    this.client.on('ready', () => {
      console.log(`Discord bot logged in as ${this.client.user.tag}`);
    });

    this.client.on('messageCreate', async (discordMessage) => {
      // Ignore bot messages
      if (discordMessage.author.bot) return;

      // Check if bot was mentioned
      const mentioned = discordMessage.mentions.has(this.client.user);
      const isDM = discordMessage.channel.type === 'DM';

      if (!mentioned && !isDM) return;

      if (!this.messageHandler) return;

      // Build message object
      const message = {
        type: 'discord',
        userId: discordMessage.author.id,
        channelId: discordMessage.channel.id,
        text: discordMessage.content.replace(/<@!?\d+>/g, '').trim(),
        isDM,
        guildId: discordMessage.guild?.id
      };

      // Store reference for replying
      message._discordMessage = discordMessage;

      await this.messageHandler(message);
    });

    this.client.on('error', (error) => {
      console.error('Discord client error:', error);
    });
  }

  onMessage(handler) {
    this.messageHandler = handler;
  }

  async start() {
    await this.client.login(this.config.token);
  }

  async stop() {
    this.client.destroy();
  }

  async sendMessage(channelId, text) {
    const channel = await this.client.channels.fetch(channelId);

    // Split if > 2000 chars
    const chunks = this.splitMessage(text);

    for (const chunk of chunks) {
      await channel.send(chunk);
    }
  }

  splitMessage(text, maxLength = 2000) {
    if (text.length <= maxLength) return [text];

    const chunks = [];
    let current = '';

    for (const line of text.split('\n')) {
      if (current.length + line.length + 1 > maxLength) {
        chunks.push(current);
        current = line;
      } else {
        current += (current ? '\n' : '') + line;
      }
    }

    if (current) chunks.push(current);
    return chunks;
  }
}
```

---

## Channel Manager (Unified Interface)

```javascript
// src/core/ChannelManager.js
export class ChannelManager {
  constructor() {
    this.channels = new Map();
    this.adapters = new Map([
      ['slack', SlackAdapter],
      ['discord', DiscordAdapter]
    ]);
  }

  async initializeChannel(name, config) {
    const AdapterClass = this.adapters.get(config.type);

    if (!AdapterClass) {
      throw new Error(`Unknown channel type: ${config.type}`);
    }

    const adapter = new AdapterClass(config);
    await adapter.initialize();
    await adapter.start();

    this.channels.set(name, adapter);
    return adapter;
  }

  getChannel(name) {
    return this.channels.get(name);
  }

  async stopAll() {
    for (const [name, adapter] of this.channels) {
      await adapter.stop();
    }
    this.channels.clear();
  }

  registerAdapter(type, AdapterClass) {
    this.adapters.set(type, AdapterClass);
  }
}
```

---

## Testing Strategy

```javascript
// test/integration/adapters/SlackAdapter.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { SlackAdapter } from '../../../src/adapters/channels/SlackAdapter.js';

// Note: Requires real Slack app credentials
test.skip('Slack adapter connects and receives messages', async () => {
  const adapter = new SlackAdapter({
    botToken: process.env.SLACK_BOT_TOKEN,
    appToken: process.env.SLACK_APP_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET
  });

  let receivedMessage = null;

  adapter.onMessage((message) => {
    receivedMessage = message;
  });

  await adapter.initialize();
  await adapter.start();

  // Send test message manually in Slack
  // Wait for message...

  await adapter.stop();
});

// Unit test for message cleaning
test('cleans Slack mentions', () => {
  const adapter = new SlackAdapter({});
  const result = adapter.cleanMention('<@U123ABC> hello world');
  assert.strictEqual(result, 'hello world');
});
```

---

## Common Issues & Solutions

### Slack Socket Mode Not Connecting
- ✅ Verify app-level token has `connections:write` scope
- ✅ Check Socket Mode is enabled in app settings
- ✅ Ensure bot token starts with `xoxb-`

### Discord MessageContent Empty
- ✅ Enable "Message Content Intent" in Developer Portal
- ✅ Add `GatewayIntentBits.MessageContent` to client intents
- ✅ Wait 5 minutes after enabling intent

### Bot Not Responding to Mentions
- ✅ Slack: Check `app_mentions:read` scope
- ✅ Discord: Verify bot has `View Channel` permission
- ✅ Both: Ensure message isn't from bot itself (check `author.bot`)

---

## Summary

| Channel | Library | Key Features |
|---------|---------|--------------|
| Slack | @slack/bolt | Socket Mode, official SDK, event-driven |
| Discord | discord.js v14 | Gateway intents, comprehensive API |

**Critical Requirements**:
- Slack: Socket Mode + app-level token
- Discord: MessageContent intent enabled

**Total Dependencies**: 2 (@slack/bolt, discord.js)
