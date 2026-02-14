# REST API Reference

Complete reference for the AI Army HTTP REST API. The API provides programmatic access to bot management, messaging, sessions, health monitoring, and system administration.

## Base URL

```
http://localhost:3000
```

Configure in `config.json`:

```json
{
  "api": {
    "port": 3000,
    "host": "0.0.0.0"
  }
}
```

## Authentication

All API endpoints (except health checks) require Bearer token authentication.

### Headers

```
Authorization: Bearer YOUR_API_TOKEN
```

Configure tokens in `config.json`:

```json
{
  "api": {
    "auth": {
      "tokens": [
        {
          "token": "${API_TOKEN}",
          "role": "admin"
        }
      ]
    }
  }
}
```

### Roles

- **`admin`** - Full access to all endpoints and all bots
- **`operator`** - Can manage only their assigned bots (send messages, update config)
- **`readonly`** - Read-only access (GET requests only)

### Bot-Level Access Control

Operator tokens can be scoped to specific bots using the `name` and `bots` fields:

```json
{
  "api": {
    "auth": {
      "tokens": [
        {
          "token": "${ADMIN_API_KEY}",
          "role": "admin"
        },
        {
          "token": "${DANIEL_API_KEY}",
          "role": "operator",
          "name": "daniel-francoeur",
          "bots": ["daniel-francoeur-assistant"]
        }
      ]
    }
  }
}
```

An operator with a `bots` array will receive `403 Forbidden` when attempting to access bots not in their list. Admins have unrestricted access to all bots.

### Example

```bash
curl -H "Authorization: Bearer your-api-token" \
  http://localhost:3000/api/bots
```

## Rate Limiting

API requests are rate-limited per IP address:

**Default:** 100 requests per 60 seconds

Configure in `config.json`:

```json
{
  "api": {
    "rateLimit": {
      "max": 100,
      "windowMs": 60000,
      "bypassIps": ["127.0.0.1"]
    }
  }
}
```

### Rate Limit Headers

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1642345678000
```

## Error Responses

All errors follow this format:

```json
{
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": {}
}
```

### HTTP Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request (invalid input)
- `401` - Unauthorized (missing/invalid token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `429` - Too Many Requests (rate limit exceeded)
- `500` - Internal Server Error

## Bot Management Endpoints

### List Bots

Get all bots and their status.

```
GET /api/bots
```

#### Query Parameters

- `status` (string, optional) - Filter by status (`running`, `stopped`, `error`, etc.)
- `provider` (string, optional) - Filter by AI provider

#### Response

```json
{
  "bots": [
    {
      "id": "helper",
      "status": "running",
      "provider": "anthropic",
      "model": "claude-sonnet-4-5",
      "uptime": 123456,
      "metrics": {
        "messagesProcessed": 42,
        "averageResponseTime": 1234,
        "errorCount": 0
      }
    }
  ],
  "total": 1
}
```

#### Example

```bash
# Get all bots
curl -H "Authorization: Bearer token" \
  http://localhost:3000/api/bots

# Get only running bots
curl -H "Authorization: Bearer token" \
  "http://localhost:3000/api/bots?status=running"

# Get Anthropic bots
curl -H "Authorization: Bearer token" \
  "http://localhost:3000/api/bots?provider=anthropic"
```

### Get Bot Details

Get detailed information about a specific bot.

```
GET /api/bots/:id
```

#### Path Parameters

- `id` (string, required) - Bot ID

#### Response

```json
{
  "id": "helper",
  "status": "running",
  "config": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-5",
    "tools": ["bash", "readFile", "writeFile"],
    "temperature": 0.7,
    "maxTokens": 4096
  },
  "soul": "# Helper Bot\n\nYou are a helpful assistant...",
  "container": {
    "id": "abc123",
    "image": "node:22-slim",
    "status": "running"
  },
  "createdAt": "2024-01-15T10:00:00.000Z",
  "updatedAt": "2024-01-15T10:00:00.000Z",
  "uptime": 123456,
  "metrics": {
    "messagesProcessed": 42,
    "totalResponseTime": 52000,
    "averageResponseTime": 1238,
    "errorCount": 0,
    "lastMessageAt": "2024-01-15T10:30:00.000Z"
  }
}
```

#### Example

```bash
curl -H "Authorization: Bearer token" \
  http://localhost:3000/api/bots/helper
```

### Get Bot Status

Get just the bot status (lighter than full details).

```
GET /api/bots/:id/status
```

#### Path Parameters

- `id` (string, required) - Bot ID

#### Response

```json
{
  "id": "helper",
  "status": "running",
  "uptime": 123456
}
```

#### Example

```bash
curl -H "Authorization: Bearer token" \
  http://localhost:3000/api/bots/helper/status
```

### Send Message to Bot

Send a message to a bot and get a response.

```
POST /api/bots/:id/message
```

#### Path Parameters

- `id` (string, required) - Bot ID

#### Request Body

```json
{
  "message": "Hello! Can you help me?",
  "sessionId": "user-123",
  "userId": "john@example.com",
  "metadata": {
    "source": "web",
    "userAgent": "Mozilla/5.0..."
  }
}
```

**Fields:**
- `message` (string, required) - Message content
- `sessionId` (string, optional) - Session ID (creates new if omitted)
- `userId` (string, optional) - User identifier for tracking
- `metadata` (object, optional) - Additional metadata

#### Response

```json
{
  "botId": "helper",
  "sessionId": "user-123",
  "messageId": "msg-abc123",
  "response": "Hello! I'd be happy to help you. What do you need assistance with?",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "responseTime": 1234,
  "metadata": {}
}
```

#### Example

```bash
curl -X POST \
  -H "Authorization: Bearer token" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Create a simple Node.js HTTP server",
    "sessionId": "user-123"
  }' \
  http://localhost:3000/api/bots/helper/message
```

### Update Bot Configuration

Hot-update a bot's configuration without restarting the entire system. Operators can only update their own bots; admins can update any bot.

```
PATCH /api/bots/:id/config
```

#### Path Parameters

- `id` (string, required) - Bot ID

#### Request Body

Any combination of updatable fields:

```json
{
  "model": "openrouter/claude-sonnet-4-5",
  "provider": "openrouter",
  "temperature": 0.8,
  "maxSteps": 50,
  "tools": ["bash", "readFile", "writeFile", "glob", "grep"],
  "sandbox": {
    "image": "python:3.12-slim",
    "packages": ["git", "curl"],
    "memory": "2g",
    "cpus": 2
  }
}
```

**Updatable fields:**
- `model` (string) - AI model to use
- `provider` (string) - AI provider name
- `temperature` (number) - Sampling temperature
- `maxSteps` (number) - Max agent loop iterations
- `tools` (string[]) - Built-in tool names
- `sandbox` (object) - Container configuration (triggers container restart)
  - `image` (string) - Docker image
  - `packages` (string[]) - System packages to install
  - `memory` (string) - Memory limit
  - `cpus` (number) - CPU limit

#### Response

```json
{
  "message": "Bot 'my-bot' configuration updated",
  "updatedFields": ["model", "sandbox"],
  "containerRestarted": true,
  "bot": {
    "id": "my-bot",
    "status": "running",
    "model": "openrouter/claude-sonnet-4-5",
    "provider": "openrouter",
    "sandbox": {
      "type": "docker",
      "image": "python:3.12-slim",
      "packages": ["git", "curl"],
      "memory": "2g",
      "cpus": 2,
      "network": "bridge"
    }
  }
}
```

#### Access Control

- **Admin** tokens can update any bot
- **Operator** tokens can only update bots listed in their `bots` array
- Returns `403 Forbidden` if an operator tries to update a bot they don't own

#### Example

```bash
# Update Docker image (triggers container restart)
curl -X PATCH \
  -H "Authorization: Bearer operator-token" \
  -H "Content-Type: application/json" \
  -d '{"sandbox": {"image": "python:3.12-slim"}}' \
  http://localhost:3000/api/bots/my-bot/config

# Update model (no container restart)
curl -X PATCH \
  -H "Authorization: Bearer operator-token" \
  -H "Content-Type: application/json" \
  -d '{"model": "openrouter/claude-sonnet-4-5"}' \
  http://localhost:3000/api/bots/my-bot/config
```

### List Bot Sessions

Get all sessions for a specific bot.

```
GET /api/bots/:id/sessions
```

#### Path Parameters

- `id` (string, required) - Bot ID

#### Query Parameters

- `limit` (number, optional) - Max sessions to return (default: 50, max: 100)
- `offset` (number, optional) - Pagination offset (default: 0)
- `userId` (string, optional) - Filter by user ID
- `active` (boolean, optional) - Filter by active status

#### Response

```json
{
  "botId": "helper",
  "sessions": [
    {
      "sessionId": "user-123",
      "userId": "john@example.com",
      "createdAt": "2024-01-15T10:00:00.000Z",
      "lastMessageAt": "2024-01-15T10:30:00.000Z",
      "messageCount": 12,
      "active": true
    }
  ],
  "total": 1,
  "limit": 50,
  "offset": 0
}
```

#### Example

```bash
# Get bot sessions
curl -H "Authorization: Bearer token" \
  http://localhost:3000/api/bots/helper/sessions

# Get active sessions only
curl -H "Authorization: Bearer token" \
  "http://localhost:3000/api/bots/helper/sessions?active=true"

# Paginate
curl -H "Authorization: Bearer token" \
  "http://localhost:3000/api/bots/helper/sessions?limit=10&offset=20"
```

## Session Management Endpoints

### Get Session

Get a specific conversation session.

```
GET /api/sessions/:id
```

#### Path Parameters

- `id` (string, required) - Session ID

#### Response

```json
{
  "sessionId": "user-123",
  "botId": "helper",
  "userId": "john@example.com",
  "createdAt": "2024-01-15T10:00:00.000Z",
  "lastMessageAt": "2024-01-15T10:30:00.000Z",
  "messageCount": 12,
  "active": true,
  "messages": [
    {
      "role": "user",
      "content": "Hello!",
      "timestamp": "2024-01-15T10:00:00.000Z"
    },
    {
      "role": "assistant",
      "content": "Hello! How can I help?",
      "timestamp": "2024-01-15T10:00:05.000Z"
    }
  ],
  "metadata": {}
}
```

#### Example

```bash
curl -H "Authorization: Bearer token" \
  http://localhost:3000/api/sessions/user-123
```

### List Sessions

List all sessions across all bots.

```
GET /api/sessions
```

#### Query Parameters

- `botId` (string, optional) - Filter by bot ID
- `userId` (string, optional) - Filter by user ID
- `active` (boolean, optional) - Filter by active status
- `limit` (number, optional) - Max sessions (default: 50, max: 100)
- `offset` (number, optional) - Pagination offset

#### Response

```json
{
  "sessions": [
    {
      "sessionId": "user-123",
      "botId": "helper",
      "userId": "john@example.com",
      "createdAt": "2024-01-15T10:00:00.000Z",
      "lastMessageAt": "2024-01-15T10:30:00.000Z",
      "messageCount": 12,
      "active": true
    }
  ],
  "total": 1,
  "limit": 50,
  "offset": 0
}
```

#### Example

```bash
curl -H "Authorization: Bearer token" \
  http://localhost:3000/api/sessions
```

### Delete Session

Delete a session and its message history.

```
DELETE /api/sessions/:id
```

#### Path Parameters

- `id` (string, required) - Session ID

#### Response

```json
{
  "sessionId": "user-123",
  "deleted": true
}
```

#### Example

```bash
curl -X DELETE \
  -H "Authorization: Bearer token" \
  http://localhost:3000/api/sessions/user-123
```

## Queue Management Endpoints

### Get Queue Status

Get message queue status.

```
GET /api/queue/status
```

#### Response

```json
{
  "size": 5,
  "processing": 3,
  "completed": 1234,
  "failed": 12,
  "oldestMessage": "2024-01-15T10:00:00.000Z",
  "workers": {
    "active": 5,
    "idle": 2,
    "total": 7
  }
}
```

#### Example

```bash
curl -H "Authorization: Bearer token" \
  http://localhost:3000/api/queue/status
```

### List Queue Messages

List pending queue messages.

```
GET /api/queue/messages
```

#### Query Parameters

- `limit` (number, optional) - Max messages (default: 50)
- `status` (string, optional) - Filter by status (`pending`, `processing`, `failed`)

#### Response

```json
{
  "messages": [
    {
      "id": "msg-123",
      "botId": "helper",
      "sessionId": "user-123",
      "status": "pending",
      "createdAt": "2024-01-15T10:30:00.000Z",
      "attempts": 0
    }
  ],
  "total": 1
}
```

#### Example

```bash
curl -H "Authorization: Bearer token" \
  http://localhost:3000/api/queue/messages
```

## Health & Monitoring Endpoints

### Health Check

Check system health (no authentication required).

```
GET /health
```

#### Response

```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 123456,
  "checks": {
    "database": "healthy",
    "bots": "healthy",
    "channels": "healthy",
    "queue": "healthy"
  }
}
```

**Status values:**
- `healthy` - All systems operational
- `degraded` - Some non-critical issues
- `unhealthy` - Critical issues detected

#### Example

```bash
curl http://localhost:3000/health
```

### Get Metrics

Get system metrics.

```
GET /api/metrics
```

#### Response

```json
{
  "system": {
    "uptime": 123456,
    "memory": {
      "used": 512000000,
      "total": 2048000000,
      "percentage": 25
    },
    "cpu": {
      "usage": 15.5
    }
  },
  "bots": {
    "total": 3,
    "running": 3,
    "messagesProcessed": 1523,
    "averageResponseTime": 1234,
    "errorRate": 0.02
  },
  "queue": {
    "size": 5,
    "processing": 3,
    "throughput": 45.2
  },
  "api": {
    "requests": 5234,
    "errors": 12,
    "averageLatency": 234
  }
}
```

#### Example

```bash
curl -H "Authorization: Bearer token" \
  http://localhost:3000/api/metrics
```

### Get Bot Metrics

Get detailed metrics for a specific bot.

```
GET /api/metrics/bots/:id
```

#### Path Parameters

- `id` (string, required) - Bot ID

#### Response

```json
{
  "botId": "helper",
  "uptime": 123456,
  "messagesProcessed": 42,
  "totalResponseTime": 52000,
  "averageResponseTime": 1238,
  "minResponseTime": 345,
  "maxResponseTime": 5234,
  "errorCount": 0,
  "errorRate": 0,
  "lastMessageAt": "2024-01-15T10:30:00.000Z",
  "containerStats": {
    "cpu": 15.5,
    "memory": 256000000,
    "network": {
      "rx": 1234567,
      "tx": 7654321
    }
  }
}
```

#### Example

```bash
curl -H "Authorization: Bearer token" \
  http://localhost:3000/api/metrics/bots/helper
```

## Admin Endpoints

Requires `admin` role.

### Reload Configuration

Hot reload configuration without restart.

```
POST /api/admin/reload
```

#### Response

```json
{
  "reloaded": true,
  "timestamp": "2024-01-15T10:30:00.000Z",
  "changes": {
    "bots": ["helper"],
    "channels": ["slack"]
  }
}
```

#### Example

```bash
curl -X POST \
  -H "Authorization: Bearer admin-token" \
  http://localhost:3000/api/admin/reload
```

### Start Bot

Start a stopped bot.

```
POST /api/admin/bots/:id/start
```

#### Path Parameters

- `id` (string, required) - Bot ID

#### Response

```json
{
  "botId": "helper",
  "status": "running"
}
```

#### Example

```bash
curl -X POST \
  -H "Authorization: Bearer admin-token" \
  http://localhost:3000/api/admin/bots/helper/start
```

### Stop Bot

Stop a running bot.

```
POST /api/admin/bots/:id/stop
```

#### Path Parameters

- `id` (string, required) - Bot ID

#### Request Body (optional)

```json
{
  "timeout": 30000,
  "force": true
}
```

#### Response

```json
{
  "botId": "helper",
  "status": "stopped"
}
```

#### Example

```bash
curl -X POST \
  -H "Authorization: Bearer admin-token" \
  -H "Content-Type: application/json" \
  -d '{"timeout": 10000, "force": true}' \
  http://localhost:3000/api/admin/bots/helper/stop
```

### Restart Bot

Restart a bot (stop + start).

```
POST /api/admin/bots/:id/restart
```

#### Path Parameters

- `id` (string, required) - Bot ID

#### Response

```json
{
  "botId": "helper",
  "status": "running",
  "restarted": true
}
```

#### Example

```bash
curl -X POST \
  -H "Authorization: Bearer admin-token" \
  http://localhost:3000/api/admin/bots/helper/restart
```

## Audit Endpoints

Query audit logs. Requires `admin` role.

### List Audit Logs

```
GET /api/audit/logs
```

#### Query Parameters

- `action` (string, optional) - Filter by action type
- `userId` (string, optional) - Filter by user ID
- `botId` (string, optional) - Filter by bot ID
- `startDate` (string, optional) - ISO 8601 date (from)
- `endDate` (string, optional) - ISO 8601 date (to)
- `limit` (number, optional) - Max logs (default: 50, max: 100)
- `offset` (number, optional) - Pagination offset

#### Response

```json
{
  "logs": [
    {
      "id": "log-123",
      "timestamp": "2024-01-15T10:30:00.000Z",
      "action": "bot.started",
      "userId": "admin",
      "botId": "helper",
      "ip": "192.168.1.100",
      "details": {}
    }
  ],
  "total": 1,
  "limit": 50,
  "offset": 0
}
```

#### Example

```bash
# Get all audit logs
curl -H "Authorization: Bearer admin-token" \
  http://localhost:3000/api/audit/logs

# Filter by action
curl -H "Authorization: Bearer admin-token" \
  "http://localhost:3000/api/audit/logs?action=bot.started"

# Filter by date range
curl -H "Authorization: Bearer admin-token" \
  "http://localhost:3000/api/audit/logs?startDate=2024-01-01&endDate=2024-01-31"
```

## CORS

CORS is configurable in `config.json`:

```json
{
  "api": {
    "cors": {
      "origins": ["http://localhost:3000", "https://myapp.com"],
      "credentials": true,
      "methods": ["GET", "POST", "PUT", "DELETE"],
      "headers": ["Content-Type", "Authorization"]
    }
  }
}
```

## WebSocket Support

WebSocket support is planned for future releases. Subscribe to [GitHub issues](https://github.com/developerz-ai/ai-army/issues) for updates.

## SDKs & Clients

Official SDKs:

- **JavaScript/TypeScript** - `npm install ai-army-client` (coming soon)
- **Python** - `pip install ai-army` (planned)
- **Go** - `go get github.com/developerz-ai/ai-army-go` (planned)

## Complete Example

```javascript
// Node.js example using fetch
const API_URL = 'http://localhost:3000';
const API_TOKEN = process.env.API_TOKEN;

async function sendMessage(botId, message, sessionId) {
  const response = await fetch(`${API_URL}/api/bots/${botId}/message`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message,
      sessionId
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error);
  }

  return response.json();
}

async function getBotStatus(botId) {
  const response = await fetch(`${API_URL}/api/bots/${botId}/status`, {
    headers: {
      'Authorization': `Bearer ${API_TOKEN}`
    }
  });

  return response.json();
}

async function getHealth() {
  const response = await fetch(`${API_URL}/health`);
  return response.json();
}

// Usage
try {
  const health = await getHealth();
  console.log('System health:', health.status);

  const status = await getBotStatus('helper');
  console.log('Bot status:', status.status);

  const result = await sendMessage(
    'helper',
    'Create a simple HTTP server',
    'user-123'
  );

  console.log('Bot response:', result.response);
} catch (error) {
  console.error('API error:', error);
}
```

## See Also

- [Orchestrator API](orchestrator.md) - Programmatic control
- [BotManager API](bot-manager.md) - Bot lifecycle management
- [Configuration Guide](../getting-started/configuration.md) - API configuration
- [Deployment Guide](../deployment.md) - Production deployment
