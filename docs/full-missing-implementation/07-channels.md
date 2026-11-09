# Missing: Channel Manager

**Status:** 🟡 Partially Implemented
**Priority:** Medium
**Design Doc:** [docs/idea/09-channels.md](../idea/09-channels.md)

## What Exists

✅ Individual channel adapters:
- `SlackAdapter` (src/adapters/channels/slack.js)
- `DiscordAdapter` (src/adapters/channels/discord.js)
- `RESTAdapter` (src/adapters/channels/rest.js)

✅ Channel initialization in Orchestrator
✅ Basic message routing

## What's Missing

### 1. Unified Channel Manager

**Implemented** in `src/core/channel-manager.js`:

| Method | Location |
|--------|----------|
| `broadcastToAll(message, options = {})` | `src/core/channel-manager.js:317` |
| `getChannelStatus(name)` | `src/core/channel-manager.js:358` |
| `reconnectChannel(name)` | `src/core/channel-manager.js:383` |
| `updateChannelConfig(name, configUpdates)` | `src/core/channel-manager.js:430` |
| `getChannelStats()` | `src/core/channel-manager.js:479` |

**Remaining gap: built-in adapter registration.**
- `ChannelManager`'s constructor (`src/core/channel-manager.js:75-84`) registers no adapters, despite the header comment at lines 9-11 claiming built-ins are auto-registered.
- The built-in `slack`, `discord` and `rest` adapters are registered by the CLI commands instead: `src/cli/StartCommand.js:215-217` and `src/cli/DevCommand.js:126-128` call `Orchestrator.registerChannelAdapter` (`src/core/orchestrator.js:608-621`), which forwards to the `ChannelManager` (`src/core/orchestrator.js:1270-1274`).
- Any other entry point that builds an `Orchestrator` or `ChannelManager` must register the built-ins itself, or it has no adapters.
- The design doc ([docs/idea/09-channels.md](../idea/09-channels.md)) does not require auto-registration, so this is a code/comment inconsistency, not a spec violation. Either make the header comment accurate or move registration into the manager.

### 2. Channel Health Monitoring

**Missing:**
```javascript
class ChannelHealthMonitor {
  async checkHealth(channelName)
  async reconnectOnFailure(channelName)
  getHealthMetrics()
}
```

**Features needed:**
- Periodic health checks
- Auto-reconnect on disconnection
- Health status in status command
- Metrics (messages sent/received, errors)

### 3. Multi-Channel Bot Support

**Current limitation:**
One bot → one channel

**Desired:**
```json
{
  "id": "multi-bot",
  "channels": [
    {
      "name": "slack-team-a",
      "type": "slack",
      "botToken": "${SLACK_TEAM_A_TOKEN}"
    },
    {
      "name": "discord-server",
      "type": "discord",
      "token": "${DISCORD_TOKEN}"
    }
  ]
}
```

**Benefits:**
- Same bot responds on Slack AND Discord
- Shared memory/context across channels
- Unified bot personality

### 4. Channel-Level Restrictions

**Missing config validation:**
```json
{
  "channels": {
    "slack-main": {
      "type": "slack",
      "restrictions": {
        "allowedChannels": ["C123456", "C789012"],
        "blockedUsers": ["U999999"],
        "allowDMs": false,
        "allowedDomains": ["company.com"]
      }
    }
  }
}
```

**Enforcement needed:**
- Block messages from disallowed channels
- Respect DM restrictions
- Email domain verification

### 5. Channel Metrics

**Missing tracking:**
```javascript
class ChannelMetrics {
  getMessageCount(channelName)
  getErrorRate(channelName)
  getAverageResponseTime(channelName)
  getUptimePercentage(channelName)
}
```

**Store in PostgreSQL:**
```sql
CREATE TABLE channel_metrics (
  channel_name TEXT,
  timestamp TIMESTAMPTZ,
  messages_received INT DEFAULT 0,
  messages_sent INT DEFAULT 0,
  errors INT DEFAULT 0,
  avg_response_time_ms INT,
  PRIMARY KEY (channel_name, timestamp)
);
```

## Implementation Path

### Step 1: Centralize Channel Management
1. Extract channel logic from Orchestrator
2. Create proper `ChannelManager` class
3. Move channel initialization
4. Move channel handler wiring

### Step 2: Health Monitoring
1. Add health check to each adapter
2. Implement periodic health checks
3. Auto-reconnect on failure
4. Track uptime metrics

### Step 3: Multi-Channel Support
1. Change bot config to support `channels` array
2. Initialize multiple channels per bot
3. Route responses to correct channel
4. Test cross-channel scenarios

### Step 4: Restrictions
1. Extend config schema for restrictions
2. Enforce restrictions in MessageRouter
3. Add restriction tests
4. Document restriction options

### Step 5: Metrics
1. Create channel_metrics table
2. Track messages in/out per channel
3. Track errors and response times
4. Add metrics endpoint to admin API

## Files to Update/Create

```
src/core/channel-manager.js (enhance existing)
src/core/channel-health-monitor.js (new)
src/core/channel-metrics.js (new)
test/unit/channel-manager.test.js
migrations/016_channel_metrics.sql
```

## Configuration Changes

**Before (current):**
```json
{
  "id": "work-bot",
  "channel": {
    "type": "slack",
    "botToken": "${SLACK_BOT_TOKEN}"
  }
}
```

**After (desired):**
```json
{
  "id": "work-bot",
  "channels": [
    {
      "name": "slack-engineering",
      "type": "slack",
      "botToken": "${SLACK_ENG_TOKEN}",
      "restrictions": {
        "allowedChannels": ["C123456"]
      }
    },
    {
      "name": "discord-public",
      "type": "discord",
      "token": "${DISCORD_TOKEN}",
      "restrictions": {
        "allowDMs": true
      }
    }
  ]
}
```

## Dependencies

- Existing adapters (already implemented)
- PostgreSQL (already exists)
- ConfigValidator (needs extension)

## Complexity: Low-Medium
- Mostly refactoring existing code
- Some new features (multi-channel, metrics)
- Well-defined scope
