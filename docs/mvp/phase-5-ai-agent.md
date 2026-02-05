# Phase 5: AI Agent Integration

**Goal**: Vercel AI SDK agent with Docker tool execution
**Dependencies**: Phase 2 (ToolExecutor), Phase 3 (BotManager)
**Deliverables**: 5 files, 5 tests

---

## 📚 Library References

**CRITICAL: Read these helper files before implementing**:

- **[AI SDK Integration](./helpers/06-ai-sdk-integration.md)** - Multi-provider, tool calling, streaming
- **[Vercel AI SDK Agent Loop](./helpers/11-vercel-ai-sdk-agent-loop.md)** - **READ THIS!** Explains maxSteps, multi-step tool calling workflow
- **[Validation & Schema](./helpers/04-validation-schema.md)** - Zod for tool parameters (required by AI SDK)

**Key Libraries for Phase 5**:
- `ai` - Vercel AI SDK 6 core (unified multi-provider interface)
- `@ai-sdk/anthropic` - Claude models (Anthropic)
- `@ai-sdk/openai` - OpenAI + compatible APIs (OpenRouter, Ollama)
- `zod` - Tool parameter validation (required by AI SDK)

**Critical Concepts**:
- **maxSteps: 30** - Enables multi-step tool calling loop (default is 1!)
- **Tool execution in Docker** - We use real Docker execution, not AI SDK's simulated bash
- **Agent loop** - LLM → Tool → Result → LLM → repeat until done

---

## Files to Implement

### 1. Model Factory
**File**: `src/models/ModelFactory.js`
**Test**: `test/unit/models/ModelFactory.test.js`

**Class**: `ModelFactory`

**Static Methods**:
- `createModel(provider, modelName, apiKey)` → `LanguageModel`
  Return Vercel AI SDK model instance

- `getSupportedProviders()` → `Array<string>`
  Return ['anthropic', 'openai', 'openrouter', 'ollama']

**Implementations**:
```javascript
switch (provider) {
  case 'anthropic':
    return anthropic(modelName, { apiKey });

  case 'openai':
    return openai(modelName, { apiKey });

  case 'openrouter':
    const or = createOpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey
    });
    return or(modelName);

  case 'ollama':
    const ollama = createOpenAI({
      baseURL: 'http://localhost:11434/v1',
      apiKey: 'ollama'
    });
    return ollama(modelName);
}
```

**Tests**:
- ✓ Creates Anthropic model
- ✓ Creates OpenAI model
- ✓ Creates OpenRouter model
- ✓ Throws on unknown provider

### 2. Tool Registry
**File**: `src/tools/ToolRegistry.js`
**Test**: `test/unit/tools/ToolRegistry.test.js`

**Class**: `ToolRegistry(containerPool: ContainerPool)`

**Methods**:
- `registerTool(name, createFn)` → `void`
  Add tool to registry Map

- `getToolsForBot(botConfig)` → `Object<string, Tool>`
  Return enabled tools for bot

- `createBashTool(botId)` → `Tool`
  Create Vercel AI SDK tool definition

- `createFileTool(type, botId)` → `Tool`
  Create readFile, writeFile, glob, or grep tool

**Builtin Tools**:
```javascript
{
  'bash': createBashTool,
  'readFile': createReadFileTool,
  'writeFile': createWriteFileTool,
  'glob': createGlobTool,
  'grep': createGrepTool
}
```

**Tests**:
- ✓ Registers tools correctly
- ✓ Returns only enabled tools for bot
- ✓ Tools are scoped to botId
- ✓ Unknown tool name throws error

### 3. Bash Tool
**File**: `src/tools/BashTool.js`
**Test**: `test/integration/tools/BashTool.test.js`

**Function**: `createBashTool(containerPool, botId)` → `Tool`

**Returns** Vercel AI SDK tool:
```javascript
tool({
  description: 'Execute bash command in workspace',
  parameters: z.object({
    command: z.string().describe('Bash command to execute'),
    timeout: z.number().optional().describe('Timeout in ms')
  }),
  execute: async ({ command, timeout = 30000 }) => {
    const container = await containerPool.getContainer(botId);
    const result = await dockerManager.exec(container, command, { timeout });

    return {
      success: result.exitCode === 0,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr
    };
  }
})
```

**Tests**:
- ✓ Executes `echo hello` → returns stdout
- ✓ Returns exitCode correctly
- ✓ Captures stderr on errors
- ✓ Blocks dangerous commands
- ✓ Timeout kills long-running commands

### 4. File Tools
**File**: `src/tools/FileTools.js`
**Test**: `test/integration/tools/FileTools.test.js`

**Functions**:
- `createReadFileTool(containerPool, botId)` → `Tool`
- `createWriteFileTool(containerPool, botId)` → `Tool`
- `createGlobTool(containerPool, botId)` → `Tool`
- `createGrepTool(containerPool, botId)` → `Tool`

**Example - readFile**:
```javascript
tool({
  description: 'Read file contents',
  parameters: z.object({
    path: z.string().describe('File path')
  }),
  execute: async ({ path }) => {
    const container = await containerPool.getContainer(botId);
    const result = await dockerManager.exec(container, `cat "${path}"`);

    return result.exitCode === 0
      ? { success: true, content: result.stdout }
      : { success: false, error: result.stderr };
  }
})
```

**Tests**:
- ✓ readFile reads container files
- ✓ writeFile creates files
- ✓ glob finds files with pattern
- ✓ grep searches file contents

### 5. Agent Runner
**File**: `src/agent/AgentRunner.js`
**Test**: `test/integration/agent/AgentRunner.test.js`

**Class**: `AgentRunner(modelFactory, toolRegistry)`

**Methods**:
- `async run(botConfig, messages)` → `{text, toolCalls, usage}`
  Execute AI agent with tools

- `async stream(botConfig, messages, onChunk)` → `{text, usage}`
  Stream response chunks

**Implementation** (uses Vercel AI SDK):
```javascript
async run(botConfig, messages) {
  const model = ModelFactory.createModel(
    botConfig.provider,
    botConfig.model,
    botConfig.apiKey
  );

  const tools = this.toolRegistry.getToolsForBot(botConfig);

  const result = await generateText({
    model,
    messages,
    tools,
    maxSteps: botConfig.maxSteps || 30
  });

  return {
    text: result.text,
    toolCalls: result.toolCalls || [],
    usage: result.usage
  };
}
```

**Tests** (mock AI responses):
- ✓ Processes messages
- ✓ Executes tool calls
- ✓ Returns final response
- ✓ Handles tool errors
- ✓ Respects maxSteps limit

---

## Tool Execution Flow

```
1. User: "What files are in my workspace?"
   ↓
2. AI decides to call glob tool
   ↓
3. Tool executes in Docker container:
   `find /home/agent -type f`
   ↓
4. Result returned to AI
   ↓
5. AI generates response:
   "You have 3 files: test.txt, script.py, data.json"
```

---

## Success Criteria

- ✅ Model factory creates AI SDK models
- ✅ Tool registry provides tools for bot
- ✅ Tools execute in Docker containers
- ✅ AI agent processes messages with tools
- ✅ Multi-provider support works
- ✅ All 5 test suites pass
