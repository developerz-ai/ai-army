# Missing: REST API (Full)

**Status:** 🟡 Partially Implemented
**Priority:** Medium
**Design Doc:** [docs/idea/10-rest-api.md](../idea/10-rest-api.md)

## What Exists

✅ `AdminRouter` (src/api/AdminRouter.js):
- Hot reload endpoints
- Basic admin operations

✅ `RESTAdapter` (src/adapters/channels/rest.js):
- REST channel for bots

## What's Missing

### 1. Full REST API Server

**Need HTTP server wrapper:**
```javascript
// src/api/api-server.js - NOT IMPLEMENTED
import express from 'express';

class APIServer {
  constructor(orchestrator, config) {
    this.app = express();
    this.orchestrator = orchestrator;
    this.port = config.port || 3000;
  }

  async start() {
    this.app.use(express.json());
    this.setupRoutes();
    await this.app.listen(this.port);
  }

  setupRoutes() {
    this.app.use('/admin', adminRouter);
    this.app.use('/bots', botRouter);
    this.app.use('/messages', messageRouter);
    this.app.use('/webhooks', webhookRouter);
  }
}
```

### 2. Bot API Endpoints

**Not implemented:**
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

**Not implemented:**
```javascript
// GET /api/sessions/:sessionId - Get session history
// DELETE /api/sessions/:sessionId - Clear session
// GET /api/sessions/:sessionId/messages - List messages
```

### 4. Queue API Endpoints

**Not implemented:**
```javascript
// GET /api/queue/:botId - Get queue depth
// GET /api/queue/:botId/messages - List queued messages
// DELETE /api/queue/:botId - Clear queue
// POST /api/queue/:botId/priority - Change message priority
```

### 5. Metrics API Endpoints

**Not implemented:**
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

**Not implemented:**
```javascript
// src/api/auth-middleware.js - NOT IMPLEMENTED
class AuthMiddleware {
  async authenticate(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token || !this.validateToken(token)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  }

  authorize(requiredRole) {
    return async (req, res, next) => {
      if (!this.hasRole(req.user, requiredRole)) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      next();
    };
  }
}
```

### 7. Rate Limiting

**Not implemented:**
```javascript
// src/api/rate-limiter.js - NOT IMPLEMENTED
class RateLimiter {
  constructor(maxRequests, windowMs) {
    this.max = maxRequests;
    this.window = windowMs;
    this.requests = new Map();
  }

  middleware() {
    return (req, res, next) => {
      const key = req.ip;
      const now = Date.now();

      // Check rate limit
      if (this.isRateLimited(key, now)) {
        return res.status(429).json({
          error: 'Too many requests'
        });
      }

      this.recordRequest(key, now);
      next();
    };
  }
}
```

### 8. WebSocket Support (Optional)

**For real-time updates:**
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

## Current State

**What Works:**
- Admin endpoints (reload, status)
- REST channel adapter

**What Doesn't Work:**
- Full REST API server
- Bot message endpoints
- Authentication
- Rate limiting
- Metrics endpoints
- WebSocket support

## Implementation Path

### Step 1: Express Server
1. Add express dependency
2. Create APIServer class
3. Wire AdminRouter
4. Test basic server

### Step 2: Bot Endpoints
1. Create BotRouter
2. Implement bot listing
3. Implement message sending
4. Test bot API

### Step 3: Session Endpoints
1. Create SessionRouter
2. Implement session history
3. Implement session clear
4. Test session API

### Step 4: Authentication
1. Implement token-based auth
2. Add auth middleware
3. Protect endpoints
4. Test auth flow

### Step 5: Rate Limiting
1. Implement RateLimiter
2. Add to all endpoints
3. Test rate limiting
4. Add bypass for admins

### Step 6: Metrics
1. Create MetricsRouter
2. Collect system metrics
3. Expose via API
4. Test metrics endpoints

### Step 7: Documentation
1. Generate OpenAPI spec
2. Create Swagger UI
3. Document all endpoints
4. Add examples

## Files to Create

```
src/api/api-server.js
src/api/routers/bot-router.js
src/api/routers/session-router.js
src/api/routers/metrics-router.js
src/api/auth-middleware.js
src/api/rate-limiter.js
src/api/websocket-server.js
test/integration/api-endpoints.test.js
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
      "tokens": ["${API_TOKEN_1}", "${API_TOKEN_2}"]
    },
    "rateLimit": {
      "enabled": true,
      "maxRequests": 100,
      "windowMs": 60000
    },
    "cors": {
      "enabled": true,
      "origins": ["https://dashboard.example.com"]
    }
  }
}
```

## Dependencies

- Need: express (HTTP server)
- Need: ws (WebSocket support)
- Need: cors (CORS middleware)

## API Documentation Example

```yaml
openapi: 3.0.0
info:
  title: AI Army API
  version: 1.0.0

paths:
  /api/bots:
    get:
      summary: List all bots
      responses:
        200:
          description: Success
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/Bot'

  /api/bots/{id}/message:
    post:
      summary: Send message to bot
      parameters:
        - name: id
          in: path
          required: true
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                userId:
                  type: string
                text:
                  type: string
```

## Complexity: Medium
- Express.js setup (simple)
- Many endpoints to implement
- Auth and rate limiting
- Good documentation needed
