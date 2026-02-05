# Phase 6: End-to-End Flow

**Goal**: Complete Slack → AI → Docker → Response
**Dependencies**: Phase 4 (Channels), Phase 5 (Agent)
**Deliverables**: 3 files, 3 tests

---

## Files to Implement

### 1. Message Processor
**File**: `src/core/MessageProcessor.js`
**Test**: `test/integration/core/MessageProcessor.test.js`

**Class**: `MessageProcessor(sessionManager, agentRunner, storage)`

**Methods**:
- `async processMessage(bot, message)` → `string`
  Full pipeline: load session → run agent → save session → return response

- `async sendResponse(channel, response, message)` → `void`
  Send to Slack/Discord

- `async logToolCall(botId, sessionId, toolName, params, result)` → `void`
  INSERT INTO tool_calls for audit

**Flow**:
```javascript
async processMessage(bot, message) {
  // 1. Get or create session
  const session = await sessionManager.getSession(
    bot.id,
    { type: message.type, id: message.channelId },
    message.userId
  );

  // 2. Append user message
  await sessionManager.appendMessage(session, 'user', message.text);

  // 3. Run AI agent
  const result = await agentRunner.run(bot.config, session.messages);

  // 4. Log tool calls
  for (const toolCall of result.toolCalls) {
    await this.logToolCall(bot.id, session.id, toolCall.name, ...);
  }

  // 5. Append assistant response
  await sessionManager.appendMessage(session, 'assistant', result.text);

  // 6. Check compaction
  if (session.token_count > bot.config.compactionThreshold) {
    await sessionManager.compact(session);
  }

  return result.text;
}
```

**Tests**:
- ✓ Processes message end-to-end
- ✓ Saves session after processing
- ✓ Logs tool calls to database
- ✓ Compacts long sessions
- ✓ Handles errors without losing session

### 2. Orchestrator (Wire Everything)
**File**: `src/core/Orchestrator.js` (enhance with message handling)
**Test**: `test/e2e/Orchestrator.e2e.test.js`

**Add to Orchestrator**:
```javascript
async _setupChannelHandlers() {
  for (const [channelName, channel] of this.channels) {
    channel.onMessage(async (message) => {
      // 1. Find bot for this message
      const bot = this.messageRouter.route(message);

      // 2. Check restrictions
      const allowed = this.messageRouter.checkRestrictions(bot.config, message);
      if (!allowed.allowed) {
        await channel.sendMessage(message.channelId, `Access denied: ${allowed.reason}`);
        return;
      }

      // 3. Process message
      try {
        const response = await this.messageProcessor.processMessage(bot, message);
        await channel.sendMessage(message.channelId, response, message.threadTs);
      } catch (err) {
        console.error('Message processing error:', err);
        await channel.sendMessage(message.channelId, 'Error processing message');
      }
    });
  }
}
```

**E2E Test** (full system):
- ✓ Start orchestrator with config
- ✓ Send Slack message → receives response
- ✓ Session persists between messages
- ✓ Tool calls execute in Docker
- ✓ Multiple bots work simultaneously
- ✓ Graceful shutdown

### 3. Error Handler
**File**: `src/utils/ErrorHandler.js`
**Test**: `test/unit/utils/ErrorHandler.test.js`

**Class**: `ErrorHandler(storage)`

**Methods**:
- `logError(error, context)` → `void`
  Log to stdout + database

- `classifyError(error)` → `string`
  Return 'config' | 'runtime' | 'network' | 'docker' | 'database'

- `redactSecrets(text)` → `string`
  Remove API keys from error messages

**Error Patterns** (redact):
```javascript
[
  /sk-ant-[a-zA-Z0-9-]+/g,   // Anthropic
  /sk-or-[a-zA-Z0-9-]+/g,    // OpenRouter
  /xoxb-[a-zA-Z0-9-]+/g,     // Slack bot
  /ghp_[a-zA-Z0-9]+/g        // GitHub
]
```

**Tests**:
- ✓ Logs errors with context
- ✓ Classifies error types correctly
- ✓ Redacts secrets from messages
- ✓ Stores errors in database

---

## E2E Test Scenario

```javascript
// test/e2e/Orchestrator.e2e.test.js
test('Full message flow: Slack → AI → Docker → Response', async () => {
  // 1. Setup
  const orchestrator = new Orchestrator({ configPath: './test-config.json' });
  await orchestrator.start();

  // 2. Simulate Slack message
  const message = {
    type: 'slack',
    userId: 'U123',
    channelId: 'C456',
    text: 'echo hello world',
    isDM: false
  };

  // 3. Process
  const bot = await orchestrator.messageRouter.route(message);
  const response = await orchestrator.messageProcessor.processMessage(bot, message);

  // 4. Verify
  assert.ok(response.includes('hello world'));

  // 5. Verify session saved
  const session = await orchestrator.storage.getSession('bot:slack:C456:U123');
  assert.strictEqual(session.messages.length, 2); // user + assistant

  // 6. Verify tool call logged
  const toolCalls = await orchestrator.storage.query(
    'SELECT * FROM tool_calls WHERE bot_id = $1',
    [bot.id]
  );
  assert.strictEqual(toolCalls.rows.length, 1);
  assert.strictEqual(toolCalls.rows[0].tool_name, 'bash');

  // 7. Cleanup
  await orchestrator.stop();
});
```

---

## Success Criteria

- ✅ Full message flow works end-to-end
- ✅ AI processes messages with tool calls
- ✅ Tools execute in Docker
- ✅ Sessions persist to database
- ✅ Tool calls audited
- ✅ Errors handled gracefully
- ✅ E2E test passes
