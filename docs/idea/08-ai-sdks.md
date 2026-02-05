# AI SDKs - Deep Dive

## Overview

AI Assistant Army uses **Vercel AI SDK** for model abstraction (provider-agnostic) and implements **custom Docker-based execution** for real bash/tool execution.

We chose this approach because:
- **Vercel AI SDK**: Best-in-class provider abstraction, works with any model
- **Custom execution**: Real bash in Docker (not simulated like just-bash)

## Vercel AI SDK

### What It Is

The [Vercel AI SDK](https://ai-sdk.dev/) is a TypeScript toolkit for building AI-powered applications. It provides:
- **Unified API** for all LLM providers
- **Tool calling** with type-safe schemas (Zod)
- **Agent loop** via `ToolLoopAgent`
- **Streaming** responses
- **MCP support**

### Installation

```bash
npm install ai @ai-sdk/anthropic @ai-sdk/openai
```

### Basic Usage

```javascript
import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

const result = await generateText({
  model: anthropic('claude-sonnet-4-5'),
  prompt: 'What is the capital of France?'
});

console.log(result.text);
```

### Provider Support

| Provider | Package | Models |
|----------|---------|--------|
| Anthropic | `@ai-sdk/anthropic` | Claude 4.5, Claude Opus, Haiku |
| OpenAI | `@ai-sdk/openai` | GPT-4, GPT-5, o1 |
| Google | `@ai-sdk/google` | Gemini 3, Gemini Flash |
| OpenRouter | `@ai-sdk/openai` (compat) | 100+ models |
| Ollama | `@ai-sdk/openai` (compat) | Llama, Mistral, etc. |

### Multi-Provider Example

```javascript
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { createOpenAI } from '@ai-sdk/openai';

// Anthropic
const claudeModel = anthropic('claude-sonnet-4-5');

// OpenAI
const gptModel = openai('gpt-4o');

// OpenRouter (OpenAI-compatible)
const openrouter = createOpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY
});
const openrouterModel = openrouter('anthropic/claude-sonnet-4-5');

// Ollama (OpenAI-compatible)
const ollama = createOpenAI({
  baseURL: 'http://localhost:11434/v1',
  apiKey: 'ollama'
});
const localModel = ollama('llama3.2');
```

### Tool Calling

```javascript
import { generateText, tool } from 'ai';
import { z } from 'zod';

const weatherTool = tool({
  description: 'Get the current weather for a location',
  parameters: z.object({
    location: z.string().describe('City name'),
    unit: z.enum(['celsius', 'fahrenheit']).optional()
  }),
  execute: async ({ location, unit = 'celsius' }) => {
    // Call weather API
    const response = await fetch(`https://api.weather.com/${location}`);
    const data = await response.json();
    return { temperature: data.temp, unit };
  }
});

const result = await generateText({
  model: anthropic('claude-sonnet-4-5'),
  prompt: 'What is the weather in Paris?',
  tools: { weather: weatherTool }
});
```

### AI SDK 6 - Agents

AI SDK 6 introduces the **Agent abstraction**:

```javascript
import { Agent, ToolLoopAgent, stepCountIs } from 'ai';

// Define agent
const codingAgent = new ToolLoopAgent({
  model: anthropic('claude-sonnet-4-5'),
  system: `You are a coding assistant. You can read and write files.`,
  tools: {
    readFile: readFileTool,
    writeFile: writeFileTool,
    bash: bashTool
  },
  stopWhen: stepCountIs(20)  // Max 20 tool calls
});

// Use agent
const result = await codingAgent.run({
  messages: [{ role: 'user', content: 'Create a hello world Python script' }]
});
```

### Tool Loop

The `ToolLoopAgent` handles the complete tool execution loop:

1. Call LLM with user message
2. If LLM requests tool calls, execute them
3. Add tool results to conversation
4. Repeat until LLM responds without tool calls (or max steps reached)

```javascript
// Under the hood, ToolLoopAgent does something like:
async function toolLoop(model, messages, tools, maxSteps) {
  let currentMessages = [...messages];

  for (let step = 0; step < maxSteps; step++) {
    const result = await generateText({
      model,
      messages: currentMessages,
      tools
    });

    // Add assistant response
    currentMessages.push({ role: 'assistant', content: result.text, toolCalls: result.toolCalls });

    // If no tool calls, we're done
    if (!result.toolCalls?.length) {
      return result;
    }

    // Execute tool calls
    for (const toolCall of result.toolCalls) {
      const toolResult = await tools[toolCall.toolName].execute(toolCall.args);
      currentMessages.push({
        role: 'tool',
        toolCallId: toolCall.toolCallId,
        content: JSON.stringify(toolResult)
      });
    }
  }

  throw new Error('Max steps reached');
}
```

## Claude Agent SDK

### What It Is

The [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview) is Anthropic's official SDK for building agents with Claude Code's capabilities.

**Key difference from Vercel AI SDK**: Claude Agent SDK includes **real tool implementations** (Bash, Read, Write, etc.) that execute on your machine.

### Installation

```bash
npm install @anthropic-ai/claude-agent-sdk
```

### Basic Usage

```javascript
import { ClaudeAgent } from '@anthropic-ai/claude-agent-sdk';

const agent = new ClaudeAgent({
  model: 'claude-sonnet-4-5',
  apiKey: process.env.ANTHROPIC_API_KEY,
  allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'],
  permissionMode: 'acceptEdits'
});

const result = await agent.query('Create a Python script that prints hello world');
```

### Permission Modes

| Mode | Description |
|------|-------------|
| `default` | Ask permission for everything |
| `acceptEdits` | Auto-approve file operations, ask for bash |
| `bypassPermissions` | Full auto (use in Docker only) |

### Sandbox

The SDK supports OS-level sandboxing:

```javascript
const agent = new ClaudeAgent({
  model: 'claude-sonnet-4-5',
  sandbox: {
    writePaths: ['./workspace'],
    allowedDomains: ['github.com', 'npmjs.org']
  }
});
```

### V2 Preview

The V2 SDK uses session-based send/stream patterns:

```javascript
import { ClaudeAgentSession } from '@anthropic-ai/claude-agent-sdk/v2';

const session = new ClaudeAgentSession({
  model: 'claude-sonnet-4-5',
  system: 'You are a helpful coding assistant.'
});

// Multi-turn conversation
const response1 = await session.send('Create a function to calculate fibonacci');
const response2 = await session.send('Now add memoization to it');
```

## Comparison: Vercel AI SDK vs Claude Agent SDK

| Feature | Vercel AI SDK | Claude Agent SDK |
|---------|--------------|------------------|
| **Provider support** | Any (Anthropic, OpenAI, Google, OpenRouter, Ollama) | Anthropic only |
| **Real bash execution** | No (simulated via just-bash) | Yes (child_process) |
| **Real file operations** | No (in-memory) | Yes (fs module) |
| **Tool definitions** | You implement | Built-in + custom |
| **Agent loop** | ToolLoopAgent | Built-in |
| **MCP support** | Yes | Yes |
| **Streaming** | Yes | Yes |
| **TypeScript** | First-class | First-class |

## Our Approach: Hybrid

We use **Vercel AI SDK for model abstraction** + **Custom Docker execution for tools**:

```javascript
// src/agent/hybrid-agent.ts
import { ToolLoopAgent } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { ContainerManager } from '../execution/container-manager.js';

export class HybridAgent {
  private agent: ToolLoopAgent;
  private containerManager: ContainerManager;

  constructor(botConfig) {
    // Select model provider based on config
    const model = this.createModel(botConfig);

    // Create tools that execute in Docker
    const tools = this.createDockerTools(botConfig);

    // Create agent with Vercel AI SDK
    this.agent = new ToolLoopAgent({
      model,
      system: botConfig.soulContent,
      tools,
      stopWhen: stepCountIs(botConfig.maxSteps || 30)
    });
  }

  createModel(botConfig) {
    const { provider, model } = botConfig;

    switch (provider) {
      case 'anthropic':
        return anthropic(model);

      case 'openai':
        return openai(model);

      case 'openrouter':
        const or = createOpenAI({
          baseURL: 'https://openrouter.ai/api/v1',
          apiKey: process.env.OPENROUTER_API_KEY
        });
        return or(model);

      case 'ollama':
        const ollama = createOpenAI({
          baseURL: 'http://localhost:11434/v1',
          apiKey: 'ollama'
        });
        return ollama(model);

      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }

  createDockerTools(botConfig) {
    // These tools execute commands in the bot's Docker container
    return {
      bash: createBashTool(this.containerManager, botConfig.id),
      readFile: createReadFileTool(this.containerManager, botConfig.id),
      writeFile: createWriteFileTool(this.containerManager, botConfig.id),
      glob: createGlobTool(this.containerManager, botConfig.id),
      grep: createGrepTool(this.containerManager, botConfig.id)
    };
  }

  async run(messages) {
    return await this.agent.run({ messages });
  }
}
```

## bash-tool Package

The `bash-tool` package from Vercel provides:

```javascript
import { createBashTool } from 'bash-tool';

const { tools } = await createBashTool({
  files: readWriteFs,          // Filesystem context
  extraInstructions: '',        // Additional prompt
});

// tools contains: bash, readFile, writeFile
```

**Limitation**: bash-tool uses `just-bash`, a simulated bash interpreter. It does NOT execute real binaries.

From the [Vercel docs](https://github.com/vercel-labs/bash-tool):

> A simulated bash environment with an in-memory virtual filesystem, written in TypeScript. Binaries or even WASM are inherently unsupported.

**This is why we use Docker for real execution.**

## MCP Integration

Both SDKs support MCP:

### Vercel AI SDK + MCP

```javascript
import { anthropic } from '@ai-sdk/anthropic';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

// Start MCP client
const mcpClient = new Client({ name: 'my-app', version: '1.0.0' });
await mcpClient.connect(transport);

// Get MCP tools
const { tools: mcpTools } = await mcpClient.listTools();

// Convert to AI SDK format
const tools = {};
for (const tool of mcpTools) {
  tools[tool.name] = {
    description: tool.description,
    parameters: tool.inputSchema,
    execute: async (params) => mcpClient.callTool({ name: tool.name, arguments: params })
  };
}

// Use with agent
const result = await generateText({
  model: anthropic('claude-sonnet-4-5'),
  prompt: 'List my GitHub repos',
  tools
});
```

### Claude Agent SDK + MCP

```javascript
import { ClaudeAgent } from '@anthropic-ai/claude-agent-sdk';

const agent = new ClaudeAgent({
  model: 'claude-sonnet-4-5',
  mcpServers: {
    github: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github']
    }
  }
});
```

## Resources

- [Vercel AI SDK Docs](https://ai-sdk.dev/docs/introduction)
- [Vercel AI SDK GitHub](https://github.com/vercel/ai)
- [AI SDK 6 Blog Post](https://vercel.com/blog/ai-sdk-6)
- [bash-tool GitHub](https://github.com/vercel-labs/bash-tool)
- [Claude Agent SDK Docs](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [Claude Agent SDK GitHub](https://github.com/anthropics/claude-agent-sdk-typescript)
- [MCP Protocol Docs](https://modelcontextprotocol.io/)
