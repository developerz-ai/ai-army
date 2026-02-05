# AI SDK Integration (Vercel AI SDK)

**Problem Areas**:
- Multi-provider LLM support (Anthropic, OpenAI, OpenRouter, Ollama)
- Tool calling with Docker execution
- Streaming responses
- Multi-step agentic workflows

---

## Vercel AI SDK 6

### ✅ Recommended: ai (Vercel AI SDK)
**Install**: `npm install ai @ai-sdk/anthropic @ai-sdk/openai`

**Why**:
- Multi-provider unified API
- Built-in tool calling
- Streaming support
- Agent abstractions
- MCP integration support
- TypeScript-first

**Key Architecture**:
```
Model Provider (Anthropic/OpenAI/etc)
       ↓
Vercel AI SDK (unified interface)
       ↓
generateText() with tools
       ↓
Tool execution in Docker container
       ↓
Results back to LLM
       ↓
Final response
```

**Sources**:
- [AI SDK 6 - Vercel](https://vercel.com/blog/ai-sdk-6)
- [AI SDK Documentation](https://ai-sdk.dev/docs/introduction)
- [How to build AI Agents with Vercel AI SDK](https://vercel.com/kb/guide/how-to-build-ai-agents-with-vercel-and-the-ai-sdk)
- [AI SDK Providers](https://ai-sdk.dev/providers/ai-sdk-providers)

---

## Multi-Provider Support

### Anthropic (Claude)
```javascript
import { anthropic } from '@ai-sdk/anthropic';

const model = anthropic('claude-sonnet-4-5', {
  apiKey: process.env.ANTHROPIC_API_KEY
});
```

### OpenAI
```javascript
import { openai } from '@ai-sdk/openai';

const model = openai('gpt-4o', {
  apiKey: process.env.OPENAI_API_KEY
});
```

### OpenRouter (Multi-model gateway)
```javascript
import { createOpenAI } from '@ai-sdk/openai';

const openrouter = createOpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY
});

const model = openrouter('anthropic/claude-sonnet-4-5');
```

### Ollama (Local models)
```javascript
import { createOpenAI } from '@ai-sdk/openai';

const ollama = createOpenAI({
  baseURL: 'http://localhost:11434/v1',
  apiKey: 'ollama' // Required but not used
});

const model = ollama('llama3.2:latest');
```

---

## Model Factory Implementation

```javascript
// src/models/ModelFactory.js
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { createOpenAI } from '@ai-sdk/openai';

export class ModelFactory {
  static createModel(provider, modelName, apiKey) {
    switch (provider) {
      case 'anthropic':
        return anthropic(modelName, { apiKey });

      case 'openai':
        return openai(modelName, { apiKey });

      case 'openrouter':
        const openrouter = createOpenAI({
          baseURL: 'https://openrouter.ai/api/v1',
          apiKey
        });
        return openrouter(modelName);

      case 'ollama':
        const ollama = createOpenAI({
          baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
          apiKey: 'ollama'
        });
        return ollama(modelName);

      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }

  static getSupportedProviders() {
    return ['anthropic', 'openai', 'openrouter', 'ollama'];
  }
}
```

---

## Tool Definition with Zod

```javascript
// src/tools/BashTool.js
import { tool } from 'ai';
import { z } from 'zod';

export function createBashTool(containerPool, botId) {
  return tool({
    description: 'Execute bash command in workspace',
    parameters: z.object({
      command: z.string().describe('Bash command to execute'),
      timeout: z.number().optional().default(30000).describe('Timeout in ms')
    }),
    execute: async ({ command, timeout }) => {
      // Get bot's container
      const container = await containerPool.getContainer(botId);

      // Security check
      if (isDangerousCommand(command)) {
        return {
          success: false,
          error: 'Dangerous command blocked'
        };
      }

      // Execute in container
      const result = await dockerManager.exec(container, command, { timeout });

      return {
        success: result.exitCode === 0,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr
      };
    }
  });
}
```

---

## Agent Runner with Multi-Step Tool Calling

```javascript
// src/agent/AgentRunner.js
import { generateText } from 'ai';

export class AgentRunner {
  constructor(modelFactory, toolRegistry) {
    this.modelFactory = modelFactory;
    this.toolRegistry = toolRegistry;
  }

  async run(botConfig, messages) {
    // Create model
    const model = this.modelFactory.createModel(
      botConfig.provider,
      botConfig.model,
      botConfig.apiKey || process.env[`${botConfig.provider.toUpperCase()}_API_KEY`]
    );

    // Get tools for this bot
    const tools = this.toolRegistry.getToolsForBot(botConfig);

    // Generate with tools (multi-step automatic)
    const result = await generateText({
      model,
      messages,
      tools,
      maxSteps: botConfig.maxSteps || 30,
      temperature: botConfig.temperature || 0.7
    });

    return {
      text: result.text,
      toolCalls: result.toolCalls || [],
      usage: result.usage,
      finishReason: result.finishReason
    };
  }

  async stream(botConfig, messages, onChunk) {
    const model = this.modelFactory.createModel(
      botConfig.provider,
      botConfig.model,
      botConfig.apiKey || process.env[`${botConfig.provider.toUpperCase()}_API_KEY`]
    );

    const tools = this.toolRegistry.getToolsForBot(botConfig);

    const { textStream, usage } = await streamText({
      model,
      messages,
      tools,
      maxSteps: botConfig.maxSteps || 30
    });

    // Stream chunks to callback
    for await (const chunk of textStream) {
      await onChunk(chunk);
    }

    return { usage };
  }
}
```

---

## Tool Registry Pattern

```javascript
// src/tools/ToolRegistry.js
export class ToolRegistry {
  constructor(containerPool) {
    this.containerPool = containerPool;
    this.tools = new Map();

    // Register built-in tools
    this.registerTool('bash', (botId) => createBashTool(this.containerPool, botId));
    this.registerTool('readFile', (botId) => createReadFileTool(this.containerPool, botId));
    this.registerTool('writeFile', (botId) => createWriteFileTool(this.containerPool, botId));
    this.registerTool('glob', (botId) => createGlobTool(this.containerPool, botId));
    this.registerTool('grep', (botId) => createGrepTool(this.containerPool, botId));
  }

  registerTool(name, createFn) {
    this.tools.set(name, createFn);
  }

  getToolsForBot(botConfig) {
    const enabledTools = botConfig.tools || [];
    const tools = {};

    for (const toolName of enabledTools) {
      const createFn = this.tools.get(toolName);
      if (!createFn) {
        throw new Error(`Unknown tool: ${toolName}`);
      }

      tools[toolName] = createFn(botConfig.id);
    }

    return tools;
  }
}
```

---

## File Tools Implementation

```javascript
// src/tools/FileTools.js
import { tool } from 'ai';
import { z } from 'zod';

export function createReadFileTool(containerPool, botId) {
  return tool({
    description: 'Read file contents from workspace',
    parameters: z.object({
      path: z.string().describe('File path relative to /home/agent')
    }),
    execute: async ({ path }) => {
      const container = await containerPool.getContainer(botId);
      const result = await dockerManager.exec(container, `cat "${path}"`);

      if (result.exitCode !== 0) {
        return { success: false, error: result.stderr };
      }

      return { success: true, content: result.stdout };
    }
  });
}

export function createWriteFileTool(containerPool, botId) {
  return tool({
    description: 'Write content to file in workspace',
    parameters: z.object({
      path: z.string().describe('File path relative to /home/agent'),
      content: z.string().describe('File content to write')
    }),
    execute: async ({ path, content }) => {
      const container = await containerPool.getContainer(botId);

      // Escape content for shell
      const escaped = content.replace(/'/g, "'\\''");

      const result = await dockerManager.exec(
        container,
        `echo '${escaped}' > "${path}"`
      );

      return {
        success: result.exitCode === 0,
        error: result.exitCode !== 0 ? result.stderr : undefined
      };
    }
  });
}

export function createGlobTool(containerPool, botId) {
  return tool({
    description: 'Find files matching glob pattern',
    parameters: z.object({
      pattern: z.string().describe('Glob pattern (e.g., "*.js", "**/*.md")')
    }),
    execute: async ({ pattern }) => {
      const container = await containerPool.getContainer(botId);
      const result = await dockerManager.exec(
        container,
        `find /home/agent -name "${pattern}"`
      );

      return {
        success: result.exitCode === 0,
        files: result.stdout.split('\n').filter(Boolean)
      };
    }
  });
}
```

---

## Usage Example

```javascript
// Full message processing flow
const botConfig = {
  id: 'support-bot',
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  tools: ['bash', 'readFile', 'writeFile', 'glob'],
  maxSteps: 30
};

const messages = [
  {
    role: 'system',
    content: await soulLoader.loadSoulFile(botConfig.soul)
  },
  {
    role: 'user',
    content: 'Create a file test.txt with "Hello World"'
  }
];

const runner = new AgentRunner(ModelFactory, toolRegistry);
const result = await runner.run(botConfig, messages);

console.log(result.text); // "I've created test.txt with the content 'Hello World'"
console.log(result.toolCalls); // [{ name: 'writeFile', args: {...}, result: {...} }]
```

---

## MCP Integration (Future)

AI SDK 6 supports MCP (Model Context Protocol):

```javascript
import { experimental_createMCPClient } from 'ai';

const mcpClient = await experimental_createMCPClient({
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-github'],
  env: {
    GITHUB_TOKEN: process.env.GITHUB_TOKEN
  }
});

// MCP tools become available to AI SDK
const tools = {
  ...toolRegistry.getToolsForBot(botConfig),
  ...mcpClient.tools
};
```

---

## Testing Strategy

```javascript
// test/integration/agent/AgentRunner.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { AgentRunner } from '../../../src/agent/AgentRunner.js';

test('processes message with tool call', async () => {
  const runner = new AgentRunner(modelFactory, toolRegistry);

  const messages = [
    { role: 'user', content: 'echo hello world' }
  ];

  const botConfig = {
    id: 'test-bot',
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
    tools: ['bash']
  };

  const result = await runner.run(botConfig, messages);

  assert.ok(result.text);
  assert.ok(result.toolCalls.length > 0);
  assert.strictEqual(result.toolCalls[0].name, 'bash');
});
```

---

## Summary

| Need | Library/Package | Why |
|------|----------------|-----|
| AI SDK Core | ai | Unified multi-provider interface |
| Anthropic | @ai-sdk/anthropic | Official Claude support |
| OpenAI | @ai-sdk/openai | GPT models + OpenAI-compatible APIs |
| Tool definitions | Zod (already using) | Type-safe parameter validation |

**Key Benefits**:
- ✅ Single API for all providers
- ✅ Automatic multi-step tool calling
- ✅ Streaming built-in
- ✅ TypeScript-first
- ✅ MCP support (future)

**Total Dependencies**: 3 (ai, @ai-sdk/anthropic, @ai-sdk/openai)
