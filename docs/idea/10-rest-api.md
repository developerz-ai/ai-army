# REST API - HTTP Interface for Bots

## Overview

In addition to Slack/Discord channels, bots can receive work via **REST API**. This enables:
- Web applications to use bots
- Automation/scripting to trigger bot actions
- Integration with other systems (CI/CD, webhooks, etc.)
- Custom frontends
- Programmatic access to bot capabilities

## API Design

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/bots/{botId}/message` | Send a message to a bot |
| GET | `/api/bots/{botId}/session/{sessionId}` | Get session history |
| DELETE | `/api/bots/{botId}/session/{sessionId}` | Clear a session |
| GET | `/api/bots` | List all bots |
| GET | `/api/bots/{botId}` | Get bot info |
| GET | `/api/bots/{botId}/status` | Get bot health/status |
| POST | `/api/bots/{botId}/task` | Submit async task |
| GET | `/api/tasks/{taskId}` | Check task status |

### Send Message

The primary endpoint for interacting with a bot:

**Request:**
```
POST /api/bots/work/message
Content-Type: application/json
Authorization: Bearer {api_key}

{
  "message": "Review the latest PR on the acme repo",
  "sessionId": "user-123",       // optional, for persistent conversations
  "stream": false,               // true for streaming response
  "context": {                   // optional additional context
    "files": ["path/to/file.js"],
    "metadata": {"source": "ci-pipeline"}
  }
}
```

**Response (non-streaming):**
```json
{
  "response": "I've reviewed PR #42. Here are my findings...",
  "sessionId": "user-123",
  "toolCalls": [
    {"tool": "github__get_pull_request", "args": {"repo": "acme", "pr": 42}}
  ],
  "usage": {
    "inputTokens": 1234,
    "outputTokens": 567
  }
}
```

**Response (streaming):**
Server-Sent Events (SSE) stream with chunks:
```
data: {"type": "text", "content": "I've reviewed "}
data: {"type": "text", "content": "PR #42."}
data: {"type": "tool_call", "tool": "github__get_pull_request", "status": "running"}
data: {"type": "tool_result", "tool": "github__get_pull_request", "result": {...}}
data: {"type": "text", "content": " Here are my findings..."}
data: {"type": "done", "usage": {"inputTokens": 1234, "outputTokens": 567}}
```

### Async Tasks

For long-running tasks, use the async task endpoint:

**Submit Task:**
```
POST /api/bots/devops/task
{
  "task": "Deploy the staging environment and run integration tests",
  "webhook": "https://my-app.com/webhooks/task-complete",  // optional callback
  "timeout": 300000  // 5 minutes
}
```

**Response:**
```json
{
  "taskId": "task-abc123",
  "status": "queued"
}
```

**Check Status:**
```
GET /api/tasks/task-abc123
```

**Response:**
```json
{
  "taskId": "task-abc123",
  "status": "running",  // queued | running | completed | failed
  "progress": [
    {"step": 1, "message": "Starting deployment..."},
    {"step": 2, "message": "Running tests..."}
  ],
  "result": null  // populated when completed
}
```

## Authentication

### API Keys

Each bot can have its own API keys:

```json
{
  "bots": {
    "work": {
      "api": {
        "enabled": true,
        "keys": ["${WORK_BOT_API_KEY}"],
        "rateLimit": {
          "requests": 100,
          "window": "1m"
        }
      }
    }
  }
}
```

### Authentication Methods

1. **Bearer Token**: `Authorization: Bearer {api_key}`
2. **API Key Header**: `X-API-Key: {api_key}`
3. **Query Parameter** (not recommended): `?api_key={api_key}`

## Configuration

### Enable REST API

```json
{
  "api": {
    "enabled": true,
    "port": 3000,
    "host": "0.0.0.0",
    "cors": {
      "origins": ["https://my-app.com"],
      "methods": ["GET", "POST", "DELETE"]
    },
    "rateLimit": {
      "global": {
        "requests": 1000,
        "window": "1m"
      }
    },
    "auth": {
      "type": "api-key",  // or "jwt", "oauth2"
      "keys": ["${GLOBAL_API_KEY}"]
    }
  }
}
```

### Per-Bot API Settings

```json
{
  "bots": {
    "work": {
      "api": {
        "enabled": true,
        "keys": ["${WORK_BOT_API_KEY_1}", "${WORK_BOT_API_KEY_2}"],
        "allowedIPs": ["10.0.0.0/8", "192.168.1.0/24"],
        "rateLimit": {
          "requests": 50,
          "window": "1m"
        }
      }
    },
    "family": {
      "api": {
        "enabled": false  // No REST access for this bot
      }
    }
  }
}
```

## Use Cases

### 1. Web Application Integration

A web app can have a chat interface that talks to bots via REST:

- User types message in web UI
- Frontend sends POST to `/api/bots/support/message`
- Bot processes and responds
- Frontend displays response

### 2. CI/CD Automation

Trigger bot actions from CI/CD pipelines:

- GitHub Action calls `/api/bots/devops/task`
- Bot deploys, runs tests, reports back
- Pipeline continues or fails based on result

### 3. Scheduled Tasks

Cron jobs can interact with bots:

- Daily job calls `/api/bots/analyst/message` with "Generate daily report"
- Bot compiles data, creates report
- Result saved or emailed

### 4. Webhook Receivers

Bots can be triggered by external webhooks:

- GitHub webhook → bot reviews new PRs
- Sentry webhook → bot investigates errors
- PagerDuty → bot runs diagnostics

### 5. Multi-Bot Orchestration

One bot can delegate to another:

- Manager bot receives complex task
- Breaks it down, calls specialized bots via REST
- Aggregates results

## Session Management via REST

Sessions work the same as channels:

- Pass `sessionId` to maintain conversation context
- Omit `sessionId` for one-off requests
- Sessions auto-compact like channel sessions
- Sessions can be cleared via DELETE

## Comparison: Channels vs REST

| Feature | Channels (Slack/Discord) | REST API |
|---------|-------------------------|----------|
| Real-time | Yes (events) | Polling or SSE |
| User identity | Platform-provided | You manage |
| Threading | Native | Via sessionId |
| Rich media | Platform-dependent | JSON/markdown |
| Rate limits | Platform limits | You control |
| Best for | Human interaction | Automation |

## Combining Channels and REST

A bot can have both:

```json
{
  "bots": {
    "work": {
      "channel": "slack-main",  // For human interaction
      "api": {                   // For automation
        "enabled": true,
        "keys": ["${API_KEY}"]
      }
    }
  }
}
```

Both share the same:
- Soul/personality
- Workspace
- Tools and MCP servers
- Memory and compaction

Sessions are isolated by source (Slack session vs REST session).
