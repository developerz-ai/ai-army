# Channels - Slack, Discord Integrations

## Overview

Channels are the messaging platforms where bots interact with users:
- **Slack** - via Bolt SDK
- **Discord** - via Discord.js
- **Telegram** - via Telegraf (planned)
- **CLI** - for testing

Each bot connects to **one channel**. If you want the same personality on multiple platforms, create multiple bots with the same soul file.

## Channel Configuration

### Global Channel Definitions

```json
{
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
  }
}
```

### Per-Bot Channel Binding

```json
{
  "bots": {
    "work": {
      "channel": "slack-main"
    },
    "family": {
      "channel": "discord-main"
    }
  }
}
```

## Slack Integration

### Prerequisites

1. Create a Slack App at https://api.slack.com/apps
2. Enable Socket Mode
3. Add Bot Token Scopes:
   - `app_mentions:read`
   - `chat:write`
   - `channels:history`
   - `groups:history`
   - `im:history`
   - `mpim:history`
   - `users:read`
4. Subscribe to Events:
   - `app_mention`
   - `message.channels`
   - `message.groups`
   - `message.im`
5. Install to workspace and get tokens

### Implementation

```javascript
// src/channels/slack.ts
import { App, LogLevel } from '@slack/bolt';

export class SlackChannel {
  private app: App;
  private botUserId: string;

  constructor(config) {
    this.app = new App({
      token: config.botToken,
      appToken: config.appToken,
      signingSecret: config.signingSecret,
      socketMode: true,
      logLevel: LogLevel.INFO
    });

    this.setupEventHandlers();
  }

  setupEventHandlers() {
    // Handle mentions
    this.app.event('app_mention', async ({ event, say }) => {
      await this.handleMessage(event, say);
    });

    // Handle DMs
    this.app.event('message', async ({ event, say }) => {
      if (event.channel_type === 'im' && !event.bot_id) {
        await this.handleMessage(event, say);
      }
    });
  }

  async handleMessage(event, say) {
    const message = {
      type: 'slack',
      userId: event.user,
      channelId: event.channel,
      threadTs: event.thread_ts || event.ts,
      text: this.cleanMention(event.text),
      isDM: event.channel_type === 'im'
    };

    // Emit to orchestrator
    this.emit('message', message, async (response) => {
      await say({
        text: response,
        thread_ts: message.threadTs
      });
    });
  }

  cleanMention(text) {
    // Remove @mention from the beginning
    return text.replace(/<@[A-Z0-9]+>\s*/gi, '').trim();
  }

  async start() {
    await this.app.start();
    const auth = await this.app.client.auth.test();
    this.botUserId = auth.user_id;
    console.log(`Slack connected as ${auth.user}`);
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

  // Stream response (typing indicator + chunked messages)
  async streamResponse(channelId, threadTs, stream) {
    // Show typing indicator
    // Note: Slack doesn't have native typing indicators for bots
    // We can post a message and update it

    let messageTs = null;
    let buffer = '';
    const updateInterval = 500; // ms
    let lastUpdate = 0;

    for await (const chunk of stream) {
      buffer += chunk;

      // Update message periodically
      if (Date.now() - lastUpdate > updateInterval) {
        if (!messageTs) {
          const result = await this.app.client.chat.postMessage({
            channel: channelId,
            text: buffer + ' ▌',
            thread_ts: threadTs
          });
          messageTs = result.ts;
        } else {
          await this.app.client.chat.update({
            channel: channelId,
            ts: messageTs,
            text: buffer + ' ▌'
          });
        }
        lastUpdate = Date.now();
      }
    }

    // Final update without cursor
    if (messageTs) {
      await this.app.client.chat.update({
        channel: channelId,
        ts: messageTs,
        text: buffer
      });
    }
  }
}
```

### User/Channel Restrictions

```json
{
  "restrictions": {
    "allowedUsers": ["U12345", "U67890", "alice"],
    "deniedUsers": ["U99999"],
    "allowedChannels": ["C12345", "#engineering"],
    "deniedChannels": ["#random"],
    "dmAllowed": true
  }
}
```

```javascript
// src/channels/slack-restrictions.ts
export async function checkRestrictions(app, restrictions, event) {
  const { user: userId, channel: channelId } = event;

  // Check DM permission
  if (event.channel_type === 'im' && restrictions.dmAllowed === false) {
    return { allowed: false, reason: 'DMs disabled' };
  }

  // Check user whitelist
  if (restrictions.allowedUsers?.length) {
    const userInfo = await app.client.users.info({ user: userId });
    const username = userInfo.user.name;

    const isAllowed = restrictions.allowedUsers.some(
      allowed => allowed === userId || allowed === username || allowed === userInfo.user.profile.email
    );

    if (!isAllowed) {
      return { allowed: false, reason: 'User not in allowlist' };
    }
  }

  // Check user blacklist
  if (restrictions.deniedUsers?.length) {
    const userInfo = await app.client.users.info({ user: userId });
    const username = userInfo.user.name;

    const isDenied = restrictions.deniedUsers.some(
      denied => denied === userId || denied === username
    );

    if (isDenied) {
      return { allowed: false, reason: 'User in denylist' };
    }
  }

  // Check channel whitelist
  if (restrictions.allowedChannels?.length && event.channel_type !== 'im') {
    const channelInfo = await app.client.conversations.info({ channel: channelId });
    const channelName = channelInfo.channel.name;

    const isAllowed = restrictions.allowedChannels.some(
      allowed => allowed === channelId || allowed === `#${channelName}` || allowed === channelName
    );

    if (!isAllowed) {
      return { allowed: false, reason: 'Channel not in allowlist' };
    }
  }

  // Check channel blacklist
  if (restrictions.deniedChannels?.length) {
    const channelInfo = await app.client.conversations.info({ channel: channelId });
    const channelName = channelInfo.channel.name;

    const isDenied = restrictions.deniedChannels.some(
      denied => denied === channelId || denied === `#${channelName}` || denied === channelName
    );

    if (isDenied) {
      return { allowed: false, reason: 'Channel in denylist' };
    }
  }

  return { allowed: true };
}
```

## Discord Integration

### Prerequisites

1. Create a Discord Application at https://discord.com/developers/applications
2. Create a Bot and get the token
3. Enable these Intents:
   - Message Content Intent
   - Server Members Intent
4. Generate OAuth2 URL with scopes: `bot`, `applications.commands`
5. Add bot to servers

### Implementation

```javascript
// src/channels/discord.ts
import { Client, GatewayIntentBits, Partials } from 'discord.js';

export class DiscordChannel {
  private client: Client;
  private guildIds: string[];

  constructor(config) {
    this.guildIds = config.guildIds || [];

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent
      ],
      partials: [Partials.Channel, Partials.Message]
    });

    this.setupEventHandlers();
  }

  setupEventHandlers() {
    this.client.on('ready', () => {
      console.log(`Discord connected as ${this.client.user.tag}`);
    });

    this.client.on('messageCreate', async (message) => {
      // Ignore bots
      if (message.author.bot) return;

      // Check if mentioned or DM
      const isMentioned = message.mentions.has(this.client.user);
      const isDM = !message.guild;

      if (!isMentioned && !isDM) return;

      // Check guild restriction
      if (this.guildIds.length && message.guild && !this.guildIds.includes(message.guild.id)) {
        return;
      }

      const messageData = {
        type: 'discord',
        userId: message.author.id,
        channelId: message.channel.id,
        guildId: message.guild?.id,
        messageId: message.id,
        text: this.cleanMention(message.content),
        isDM
      };

      this.emit('message', messageData, async (response) => {
        // Split long messages (Discord has 2000 char limit)
        const chunks = this.splitMessage(response);
        for (const chunk of chunks) {
          await message.reply(chunk);
        }
      });
    });
  }

  cleanMention(text) {
    return text.replace(/<@!?\d+>/g, '').trim();
  }

  splitMessage(text, maxLength = 2000) {
    if (text.length <= maxLength) return [text];

    const chunks = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      // Find a good break point
      let breakPoint = remaining.lastIndexOf('\n', maxLength);
      if (breakPoint === -1 || breakPoint < maxLength / 2) {
        breakPoint = remaining.lastIndexOf(' ', maxLength);
      }
      if (breakPoint === -1) {
        breakPoint = maxLength;
      }

      chunks.push(remaining.slice(0, breakPoint));
      remaining = remaining.slice(breakPoint).trim();
    }

    return chunks;
  }

  async start(token) {
    await this.client.login(token);
  }

  async stop() {
    await this.client.destroy();
  }

  async sendMessage(channelId, text) {
    const channel = await this.client.channels.fetch(channelId);
    const chunks = this.splitMessage(text);
    for (const chunk of chunks) {
      await channel.send(chunk);
    }
  }

  // Stream with typing indicator
  async streamResponse(channel, stream) {
    // Show typing
    await channel.sendTyping();

    // Collect response
    let buffer = '';
    const typingInterval = setInterval(() => {
      channel.sendTyping();
    }, 5000);

    for await (const chunk of stream) {
      buffer += chunk;
    }

    clearInterval(typingInterval);

    // Send final message
    const chunks = this.splitMessage(buffer);
    for (const chunk of chunks) {
      await channel.send(chunk);
    }
  }
}
```

## CLI Channel (Testing)

```javascript
// src/channels/cli.ts
import * as readline from 'readline';

export class CLIChannel {
  private rl: readline.Interface;

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '> '
    });
  }

  start() {
    console.log('CLI mode. Type your messages (Ctrl+C to exit).\n');
    this.rl.prompt();

    this.rl.on('line', (line) => {
      const message = {
        type: 'cli',
        userId: 'cli-user',
        channelId: 'cli',
        text: line.trim(),
        isDM: true
      };

      this.emit('message', message, (response) => {
        console.log(`\nAssistant: ${response}\n`);
        this.rl.prompt();
      });
    });

    this.rl.on('close', () => {
      console.log('\nGoodbye!');
      process.exit(0);
    });
  }

  stop() {
    this.rl.close();
  }
}
```

## Channel Manager

```javascript
// src/channels/manager.ts
import { SlackChannel } from './slack.js';
import { DiscordChannel } from './discord.js';
import { CLIChannel } from './cli.js';

export class ChannelManager {
  private channels = new Map();

  async initializeChannel(name, config) {
    let channel;

    switch (config.type) {
      case 'slack':
        channel = new SlackChannel(config);
        break;
      case 'discord':
        channel = new DiscordChannel(config);
        break;
      case 'cli':
        channel = new CLIChannel();
        break;
      default:
        throw new Error(`Unknown channel type: ${config.type}`);
    }

    await channel.start(config.botToken);
    this.channels.set(name, channel);
    return channel;
  }

  getChannel(name) {
    return this.channels.get(name);
  }

  async stopAll() {
    for (const channel of this.channels.values()) {
      await channel.stop();
    }
  }
}
```

## Session Management Per Channel

Sessions are keyed as `botId:channelType:channelId:userId`:

```javascript
// Slack DM: work:slack:D12345:U67890
// Slack channel: work:slack:C12345:U67890
// Discord DM: family:discord:dm:123456789
// Discord server: family:discord:987654321:123456789
```

This ensures:
- Each user has their own conversation history
- Different channels have separate contexts
- DMs are isolated from channel conversations
