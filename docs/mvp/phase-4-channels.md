# Phase 4: Channel Integrations

**Goal**: Slack and Discord message routing
**Dependencies**: Phase 3 (Orchestrator, BotManager)
**Deliverables**: 4 files, 4 tests

---

## 📚 Library References

**Before implementing, review this helper file**:

- **[Channels (Slack & Discord)](./helpers/05-channels-slack-discord.md)** - Socket Mode, intents, message handling

**Key Libraries for Phase 4**:
- `@slack/bolt` - Official Slack SDK with Socket Mode (no ngrok needed!)
- `discord.js` v14 - Official Discord library with Gateway Intents

**Critical Setup Requirements**:
- **Slack**: Enable Socket Mode + app-level token with `connections:write` scope
- **Discord**: Enable "Message Content Intent" in Developer Portal + add `GatewayIntentBits.MessageContent`

---

## Files to Implement

### 1. Slack Adapter
**File**: `src/adapters/channels/SlackAdapter.js`
**Test**: `test/integration/adapters/SlackAdapter.test.js`

**Class**: `SlackAdapter(config)`

**Methods**:
- `async initialize(config)` → `void`
  Create Bolt app with botToken, appToken, signingSecret

- `async start()` → `void`
  Start socket mode, register event handlers

- `async stop()` → `void`
  Disconnect from Slack

- `async sendMessage(channelId, text, threadTs?)` → `void`
  Send via chat.postMessage

- `onMessage(handler: Function)` → `void`
  Register callback for incoming messages

- `cleanMention(text)` → `string`
  Remove `<@U123ABC>` from text

**Events Handled**:
- `app_mention` - Bot mentioned in channel
- `message` (if DM) - Direct messages

**Message Format** passed to handler:
```javascript
{
  type: 'slack',
  userId: 'U123ABC',
  channelId: 'C456DEF',
  text: 'Review PR #42',
  isDM: false,
  threadTs: '1234567890.123456'
}
```

**Tests** (requires Slack app with test workspace):
- ✓ Initializes with valid config
- ✓ Connects to Slack
- ✓ Receives app_mention events
- ✓ Receives DM messages
- ✓ Sends messages to channels
- ✓ Cleans mentions: `<@U123> hello` → `hello`

### 2. Discord Adapter
**File**: `src/adapters/channels/DiscordAdapter.js`
**Test**: `test/integration/adapters/DiscordAdapter.test.js`

**Class**: `DiscordAdapter(config)`

**Methods**:
- `async initialize(config)` → `void`
  Create Discord.js Client with intents

- `async start()` → `void`
  Login, register messageCreate handler

- `async stop()` → `void`
  Destroy client

- `async sendMessage(channelId, text)` → `void`
  Send, split if > 2000 chars

- `splitMessage(text, maxLength=2000)` → `Array<string>`
  Split long messages at newlines/spaces

- `onMessage(handler: Function)` → `void`
  Register callback

**Intents Required**:
```javascript
[
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.DirectMessages,
  GatewayIntentBits.MessageContent
]
```

**Tests**:
- ✓ Initializes and connects
- ✓ Receives messages with @mention
- ✓ Receives DM messages
- ✓ Sends messages
- ✓ Splits messages > 2000 chars correctly
- ✓ Handles guild restrictions (guildIds config)

### 3. Channel Manager
**File**: `src/core/ChannelManager.js`
**Test**: `test/unit/core/ChannelManager.test.js`

**Class**: `ChannelManager()`

**Methods**:
- `async initializeChannel(name, config)` → `ChannelAdapter`
  Create adapter based on type, start it

- `getChannel(name)` → `ChannelAdapter`
  Return from Map

- `async stopAll()` → `void`
  Stop all channel adapters

- `createAdapter(type, config)` → `ChannelAdapter`
  Factory: type='slack' → new SlackAdapter()

**Registry** (internal Map):
```javascript
{
  'slack': SlackAdapter,
  'discord': DiscordAdapter,
  'rest': RESTAdapter
}
```

**Tests**:
- ✓ Creates SlackAdapter for type='slack'
- ✓ Creates DiscordAdapter for type='discord'
- ✓ Throws on unknown type
- ✓ Initializes multiple channels
- ✓ Stops all gracefully

### 4. Message Router
**File**: `src/core/MessageRouter.js`
**Test**: `test/unit/core/MessageRouter.test.js`

**Class**: `MessageRouter(botManager: BotManager)`

**Methods**:
- `async route(message)` → `Bot`
  Find bot that should handle this message

- `checkRestrictions(botConfig, message)` → `{allowed: boolean, reason?: string}`
  Check allowedUsers, deniedUsers, allowedChannels, deniedChannels

- `findBotForMessage(message)` → `Bot`
  Match message to bot based on channel binding

**Restriction Logic**:
```javascript
1. If bot has channel binding → only that channel
2. If allowedUsers specified → only those users
3. If deniedUsers specified → block those users
4. If allowedChannels specified → only those channels
5. If deniedChannels specified → block those channels
6. If isDM and dmAllowed=false → block
```

**Tests**:
- ✓ Routes to correct bot based on channel
- ✓ Blocks users in deniedUsers
- ✓ Allows users in allowedUsers
- ✓ Blocks channels in deniedChannels
- ✓ Blocks DMs when dmAllowed=false

---

## Message Flow

```
1. Slack/Discord message arrives
   ↓
2. ChannelAdapter.onMessage() callback fires
   ↓
3. MessageRouter.route(message) finds bot
   ↓
4. MessageRouter.checkRestrictions() validates
   ↓
5. Return bot to process message
```

---

## Success Criteria

- ✅ Slack messages received and parsed
- ✅ Discord messages received and parsed
- ✅ Messages route to correct bot
- ✅ User/channel restrictions enforced
- ✅ DM vs channel detection works
- ✅ All 4 test suites pass
