# REST API (Full)

**Status:** ✅ Fully Implemented
**Priority:** High
**Design Doc:** [docs/idea/10-rest-api.md](../idea/10-rest-api.md)

## What Exists

✅ **APIServer** (`src/api/api-server.js`):
- HTTP server using Node.js built-in `http` module (no Express/Fastify dependency)
- Composable router chain architecture
- Integrated authentication via AuthMiddleware
- Integrated rate limiting via RateLimiter
- CORS support for cross-origin requests
- JSON body parsing for POST/PUT/PATCH
- Graceful start/stop lifecycle

✅ **AdminRouter** (`src/api/AdminRouter.js`):
- Hot reload endpoints (`POST /api/admin/reload/:botName`)
- Basic admin operations
- Bot restart endpoints

✅ **BotRouter** (`src/api/routers/bot-router.js`):
- `GET /api/bots` - List all bots
- `GET /api/bots/:id` - Get bot details
- `POST /api/bots/:id/message` - Send message to bot
- `GET /api/bots/:id/sessions` - List bot sessions
- `GET /api/bots/:id/status` - Get bot status

✅ **SessionRouter** (`src/api/routers/session-router.js`):
- `GET /api/sessions/:sessionId` - Get session history
- `DELETE /api/sessions/:sessionId` - Clear session
- `GET /api/sessions/:sessionId/messages` - List session messages

✅ **QueueRouter** (`src/api/routers/queue-router.js`):
- `GET /api/queue/:botId` - Get queue depth
- `GET /api/queue/:botId/messages` - List queued messages
- `DELETE /api/queue/:botId` - Clear queue
- `POST /api/queue/:botId/priority` - Change message priority

✅ **MetricsRouter** (`src/api/routers/metrics-router.js`):
- `GET /api/metrics` - Overall system metrics
- `GET /api/metrics/bots/:id` - Bot-specific metrics
- `GET /api/metrics/channels/:name` - Channel metrics

✅ **AuthMiddleware** (`src/api/auth-middleware.js`):
- Bearer token authentication via Authorization header
- Multiple tokens with role assignments
- Role-based authorization checks
- Development mode (no auth required when no tokens configured)
- Token value redaction in error messages and logs

✅ **RateLimiter** (`src/api/rate-limiter.js`):
- Sliding window rate limiting per client IP
- Configurable max requests and window duration
- Automatic cleanup of expired entries
- Bypass list for trusted IPs (e.g., internal health checks)
- Returns standard 429 Too Many Requests with Retry-After header

✅ **HealthRouter** (`src/api/routers/health-router.js`):
- Basic health check endpoints

✅ **AuditRouter** (`src/api/routers/audit-router.js`):
- Audit log retrieval and filtering
- Event history tracking

✅ **RESTAdapter** (`src/adapters/channels/rest.js`):
- REST channel for bot communication

## Implementation Details

### 1. Full REST API Server

✅ **Implemented:** HTTP server wrapper in `src/api/api-server.js`:
```javascript
// Using Node.js built-in http module (not Express)
const server = new APIServer({
  port: 3000,
  host: '0.0.0.0',
  authConfig: { tokens: ['token-123'] },
  rateLimitConfig: { maxRequests: 100, windowMs: 60000 }
});

await server.start();
```

### 2. Bot API Endpoints

✅ **Fully implemented** in `BotRouter`:
```javascript
// GET /api/bots - List all bots
// GET /api/bots/:id - Get bot details
// POST /api/bots/:id/message - Send message to bot
// GET /api/bots/:id/sessions - List bot sessions
// GET /api/bots/:id/status - Get bot status
```

**Example:**
```bash
curl -X POST http://localhost:3000/api/bots/work-bot/message \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -d '{
    "userId": "user123",
    "text": "What tasks do I have?"
  }'
```

### 3. Session API Endpoints

✅ **Fully implemented** in `SessionRouter`:
```javascript
// GET /api/sessions/:sessionId - Get session history
// DELETE /api/sessions/:sessionId - Clear session
// GET /api/sessions/:sessionId/messages - List messages
```

### 4. Queue API Endpoints

✅ **Fully implemented** in `QueueRouter`:
```javascript
// GET /api/queue/:botId - Get queue depth
// GET /api/queue/:botId/messages - List queued messages
// DELETE /api/queue/:botId - Clear queue
// POST /api/queue/:botId/priority - Change message priority
```

### 5. Metrics API Endpoints

✅ **Fully implemented** in `MetricsRouter`:
```javascript
// GET /api/metrics - Overall system metrics
// GET /api/metrics/bots/:id - Bot-specific metrics
// GET /api/metrics/channels/:name - Channel metrics
```

**Example response:**
```json
{
  "timestamp": "2026-02-06T10:30:00Z",
  "uptime": 86400,
  "bots": {
    "total": 5,
    "running": 4,
    "stopped": 1
  },
  "messages": {
    "total": 1234,
    "last_hour": 56,
    "avg_response_time_ms": 2341
  },
  "queue": {
    "depth": 12,
    "processing": 3
  }
}
```

### 6. Authentication & Authorization

✅ **Fully implemented** in `src/api/auth-middleware.js`:
```javascript
const authConfig = {
  enabled: true,
  tokens: [
    { value: 'admin-token-123', role: 'admin' },
    { value: 'viewer-token-456', role: 'viewer' }
  ]
};

const auth = new AuthMiddleware(authConfig);
// Authentication via Bearer token in Authorization header
// Role-based authorization support for endpoint protection
```

Features:
- Bearer token validation
- Multiple tokens with role assignments
- Development mode (no auth when no tokens configured)
- Token redaction in error messages

### 7. Rate Limiting

✅ **Fully implemented** in `src/api/rate-limiter.js`:
```javascript
const rateLimitConfig = {
  maxRequests: 100,
  windowMs: 60000, // 1 minute
  bypassList: ['127.0.0.1', '::1'] // IPs exempt from limiting
};

const limiter = new RateLimiter(rateLimitConfig);
```

Features:
- Sliding window algorithm for smooth rate limiting
- Per-IP tracking with automatic cleanup
- Bypass list for trusted IPs
- Returns standard 429 Too Many Requests with Retry-After header

### 8. WebSocket Support

⏸️ **Not yet implemented** (Low priority, optional feature)

For real-time updates, would need:
```javascript
// src/api/websocket-server.js - NOT IMPLEMENTED
import { WebSocketServer } from 'ws';

class WSServer {
  constructor(server) {
    this.wss = new WebSocketServer({ server });
    this.clients = new Map();
  }

  broadcast(event, data) {
    const message = JSON.stringify({ event, data });
    this.wss.clients.forEach(client => {
      if (client.readyState === 1) {
        client.send(message);
      }
    });
  }
}
```

Note: WebSocket support is a planned enhancement but not critical for the core API functionality.

## Current State

**What Works:** ✅
- Full REST API server with Node.js built-in `http` module
- Bot message endpoints (list, send, status)
- Session management endpoints
- Queue management endpoints
- Metrics endpoints
- Authentication via Bearer tokens
- Rate limiting per IP
- Admin endpoints (reload, status)
- Audit logging
- Health checks
- REST channel adapter

**What's Planned:**
- WebSocket support for real-time updates (low priority)

## Files Created

```
✅ src/api/api-server.js
✅ src/api/auth-middleware.js
✅ src/api/rate-limiter.js
✅ src/api/routers/bot-router.js
✅ src/api/routers/session-router.js
✅ src/api/routers/queue-router.js
✅ src/api/routers/metrics-router.js
✅ src/api/routers/health-router.js
✅ src/api/routers/audit-router.js
✅ test/unit/api/APIServer.test.js
✅ test/unit/api/AuthMiddleware.test.js
✅ test/unit/api/RateLimiter.test.js
✅ test/unit/api/bot-router.test.js
✅ test/unit/api/session-router.test.js
✅ test/unit/api/queue-router.test.js
✅ test/unit/api/metrics-router.test.js
✅ test/unit/api/health-router.test.js
✅ test/unit/api/audit-router.test.js
⏸️ src/api/websocket-server.js (Optional, low priority)
```

## Configuration Example

```json
{
  "api": {
    "enabled": true,
    "port": 3000,
    "host": "0.0.0.0",
    "auth": {
      "enabled": true,
      "tokens": [
        {
          "value": "${API_TOKEN_1}",
          "role": "admin"
        },
        {
          "value": "${API_TOKEN_2}",
          "role": "viewer"
        }
      ]
    },
    "rateLimit": {
      "enabled": true,
      "maxRequests": 100,
      "windowMs": 60000,
      "bypassList": ["127.0.0.1"]
    },
    "cors": {
      "enabled": true,
      "origins": ["https://dashboard.example.com"]
    }
  }
}
```

## Dependencies

✅ **Uses Node.js built-in modules:**
- `node:http` - HTTP server (no Express dependency)
- `node:url` - URL parsing
- `node:querystring` - Query string parsing

⏸️ **Optional dependencies:**
- `ws` - For WebSocket support (not yet implemented, low priority)

## API Endpoints Summary

### Bot Management
- `GET /api/bots` - List all bots with their status
- `GET /api/bots/:id` - Get detailed bot configuration
- `POST /api/bots/:id/message` - Send message to bot for processing
- `GET /api/bots/:id/sessions` - List all active sessions for bot
- `GET /api/bots/:id/status` - Get current bot runtime status

### Session Management
- `GET /api/sessions/:sessionId` - Get complete session history
- `DELETE /api/sessions/:sessionId` - Clear session data
- `GET /api/sessions/:sessionId/messages` - Get messages in session

### Queue Management
- `GET /api/queue/:botId` - Get queue depth and stats
- `GET /api/queue/:botId/messages` - List queued messages
- `DELETE /api/queue/:botId` - Clear entire queue
- `POST /api/queue/:botId/priority` - Adjust message priority

### Metrics & Monitoring
- `GET /api/metrics` - Overall system metrics
- `GET /api/metrics/bots/:id` - Bot-specific performance metrics
- `GET /api/metrics/channels/:name` - Channel-specific metrics

### Admin Operations
- `POST /api/admin/reload/:botName` - Hot reload bot configuration
- `POST /api/admin/restart/:botName` - Restart bot instance

### Health & Audit
- `GET /api/health` - System health check
- `GET /api/audit/logs` - Audit log retrieval
- `GET /api/audit/events` - Event history filtering

## Testing

All components have comprehensive unit tests:
- `src/api/api-server.test.js` - Server integration tests
- `src/api/auth-middleware.test.js` - Authentication & authorization tests
- `src/api/rate-limiter.test.js` - Rate limiting tests
- `src/api/routers/*.test.js` - Individual router endpoint tests

Run with: `npm test`

## Implementation Quality

✅ **Production-Ready Features:**
- Full error handling with custom error classes
- Comprehensive JSDoc documentation
- Unit test coverage for all components
- Rate limiting with sliding window algorithm
- Token-based authentication with roles
- CORS support
- JSON body parsing
- Graceful shutdown

✅ **Code Quality:**
- Follows project coding standards (ES modules, camelCase, arrow functions)
- No external HTTP dependencies (uses Node.js built-in `http` module)
- Proper error chaining with cause context
- Environment-aware defaults

## Complexity: Complete
- ✅ Full HTTP server implementation using Node.js built-in http module
- ✅ Multiple endpoint routers for different concerns (bots, sessions, queue, metrics)
- ✅ Authentication and authorization
- ✅ Rate limiting with IP tracking
- ✅ Comprehensive audit logging
- ✅ Full test coverage
- ✅ Production-ready error handling
