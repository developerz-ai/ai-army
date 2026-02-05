# Vercel AI SDK Agent Loop & Tool Execution

**Understanding the automatic multi-step tool calling loop in Vercel AI SDK 6**

---

## How the Agent Loop Works

The Vercel AI SDK provides **automatic multi-step tool calling** where the LLM can iteratively call tools, receive results, and continue processing until it reaches a final answer.

### Basic Flow

```
1. User sends message
   ↓
2. LLM receives message + tools + system prompt
   ↓
3. LLM decides: "I need to call a tool"
   ↓
4. Tool executes (e.g., bash command in Docker)
   ↓
5. Result returns to LLM
   ↓
6. LLM decides: "I need another tool" OR "I have the answer"
   ↓
7. Repeat steps 3-6 until LLM generates final text response
```

**Sources**:
- [Agents: Loop Control - AI SDK](https://ai-sdk.dev/docs/agents/loop-control)
- [How to build AI Agents with Vercel AI SDK](https://vercel.com/kb/guide/how-to-build-ai-agents-with-vercel-and-the-ai-sdk)
- [AI SDK 6 - Vercel](https://vercel.com/blog/ai-sdk-6)

---

## maxSteps Parameter

Controls the maximum number of iterations in the agent loop.

```javascript
import { generateText } from 'ai';

const result = await generateText({
  model,
  messages,
  tools,
  maxSteps: 30  // Default is 1 (no loop), set higher for multi-step
});
```

**Important**:
- `maxSteps: 1` - Single call, no tool loop (default)
- `maxSteps: 30` - Allow up to 30 iterations (recommended for agents)
- `maxSteps: Infinity` - ⚠️ **Not recommended** - model may never stop

**Why limit maxSteps?**
- Prevents infinite loops
- Controls costs (each step = API call)
- Ensures reasonable response times

**Sources**:
- [Tool is Invoked Multiple Times Based on maxSteps - GitHub](https://github.com/vercel/ai/issues/5195)
- [i don't understand something about tool calling loop - GitHub Discussion](https://github.com/vercel/ai/discussions/8514)

---

## Example: Multi-Step Tool Calling

```javascript
// User: "Create a file test.txt with 'hello' and then read it back"

const result = await generateText({
  model: anthropic('claude-sonnet-4-5'),
  messages: [
    { role: 'user', content: 'Create a file test.txt with "hello" and then read it back' }
  ],
  tools: {
    writeFile: tool({
      description: 'Write content to file',
      parameters: z.object({
        path: z.string(),
        content: z.string()
      }),
      execute: async ({ path, content }) => {
        await fs.writeFile(path, content);
        return { success: true };
      }
    }),
    readFile: tool({
      description: 'Read file contents',
      parameters: z.object({
        path: z.string()
      }),
      execute: async ({ path }) => {
        const content = await fs.readFile(path, 'utf8');
        return { content };
      }
    })
  },
  maxSteps: 30
});

// Agent loop:
// Step 1: LLM calls writeFile({ path: 'test.txt', content: 'hello' })
// Step 2: Tool executes, returns { success: true }
// Step 3: LLM receives result, calls readFile({ path: 'test.txt' })
// Step 4: Tool executes, returns { content: 'hello' }
// Step 5: LLM receives result, generates final response:
//         "I've created test.txt with the content 'hello' and read it back. The file contains: hello"

console.log(result.text);
// "I've created test.txt with the content 'hello' and read it back. The file contains: hello"

console.log(result.toolCalls);
// [
//   { name: 'writeFile', args: { path: 'test.txt', content: 'hello' }, result: { success: true } },
//   { name: 'readFile', args: { path: 'test.txt' }, result: { content: 'hello' } }
// ]
```

---

## Loop Control: stopWhen

You can control when the loop stops using the `stopWhen` parameter:

```javascript
const result = await generateText({
  model,
  messages,
  tools,
  maxSteps: 30,
  stopWhen: (step) => {
    // Stop if model calls 'finish' tool
    return step.toolCalls?.some(call => call.toolName === 'finish');
  }
});
```

**Use Cases**:
- Stop when specific tool is called (e.g., 'submit', 'finish')
- Stop when certain condition is met
- Custom termination logic

**Sources**:
- [Agents: Loop Control - AI SDK](https://ai-sdk.dev/docs/agents/loop-control)
- [Hookable Control Over Agent Loop Iterations - GitHub](https://github.com/vercel/ai/issues/4954)

---

## ToolLoopAgent Class (Production)

For production use, Vercel provides `ToolLoopAgent` class:

```javascript
import { ToolLoopAgent } from 'ai';

const agent = new ToolLoopAgent({
  model,
  tools,
  maxSteps: 30
});

const result = await agent.run({
  messages: [
    { role: 'user', content: 'Create and read file' }
  ]
});
```

**Benefits**:
- Handles complete tool execution loop
- Built-in error handling
- Retryable steps
- Observable (good for debugging)

**Sources**:
- [AI SDK Core: ToolLoopAgent](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent)
- [Build Your First Agent With Vercel's AI SDK](https://www.aihero.dev/agents-with-vercel-ai-sdk)

---

## Per-Step Control: prepareStep

Advanced: Control settings for each step in the loop:

```javascript
const result = await generateText({
  model,
  messages,
  tools,
  maxSteps: 30,
  prepareStep: async ({ step, tools }) => {
    // Modify tools or settings per step
    return {
      tools: step > 10 ? {} : tools,  // Disable tools after 10 steps
      temperature: 0.7
    };
  }
});
```

**Use Cases**:
- Gradually reduce available tools
- Adjust temperature per step
- Custom logic between steps

**Sources**:
- [Agents: Loop Control - AI SDK](https://ai-sdk.dev/docs/agents/loop-control)

---

## Streaming with Multi-Step

Streaming works with multi-step tool calling:

```javascript
import { streamText } from 'ai';

const { textStream, toolCalls } = await streamText({
  model,
  messages,
  tools,
  maxSteps: 30
});

// Stream text chunks to user
for await (const chunk of textStream) {
  process.stdout.write(chunk);
}

console.log('Tool calls:', toolCalls);
```

**User Experience**:
- User sees partial responses while tools execute
- Better perceived performance
- Can show "Thinking..." or "Using tools..." indicators

**Sources**:
- [Multi-Step & Generative UI - Vercel Academy](https://vercel.com/academy/ai-sdk/multi-step-and-generative-ui)

---

## AI SDK 6 Unified API

AI SDK 6 unified `generateObject` and `generateText` for multi-step with structured output:

```javascript
const result = await generateText({
  model,
  messages,
  tools,
  maxSteps: 30,
  output: {
    schema: z.object({
      summary: z.string(),
      actions: z.array(z.string())
    })
  }
});

// Agent can use tools, then return structured output at the end
console.log(result.object.summary);
console.log(result.object.actions);
```

**Sources**:
- [AI SDK 6 - Vercel](https://vercel.com/blog/ai-sdk-6)

---

## Best Practices for AI Army

### 1. Set Reasonable maxSteps
```javascript
const botConfig = {
  maxSteps: 30,  // Enough for complex tasks, not infinite
  // ...
};
```

### 2. Log Tool Calls for Debugging
```javascript
const result = await generateText({ model, messages, tools, maxSteps: 30 });

for (const toolCall of result.toolCalls || []) {
  logger.info({
    botId,
    sessionId,
    toolName: toolCall.name,
    args: toolCall.args,
    result: toolCall.result
  }, 'Tool executed');

  // Also save to database for audit
  await storage.query(
    'INSERT INTO tool_calls (bot_id, tool_name, params, result) VALUES ($1, $2, $3, $4)',
    [botId, toolCall.name, JSON.stringify(toolCall.args), JSON.stringify(toolCall.result)]
  );
}
```

### 3. Handle Errors in Tools
```javascript
const bashTool = tool({
  description: 'Execute bash command',
  parameters: z.object({ command: z.string() }),
  execute: async ({ command }) => {
    try {
      const result = await dockerManager.exec(container, command);
      return {
        success: result.exitCode === 0,
        stdout: result.stdout,
        stderr: result.stderr
      };
    } catch (err) {
      // Return error info to LLM (don't throw)
      return {
        success: false,
        error: err.message
      };
    }
  }
});
```

### 4. Set Timeouts
```javascript
// Tool-level timeout
const bashTool = tool({
  description: 'Execute bash command',
  parameters: z.object({
    command: z.string(),
    timeout: z.number().default(30000)  // 30s default
  }),
  execute: async ({ command, timeout }) => {
    return await dockerManager.exec(container, command, { timeout });
  }
});

// Overall generation timeout
const result = await Promise.race([
  generateText({ model, messages, tools, maxSteps: 30 }),
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Generation timeout')), 120000)
  )
]);
```

---

## Common Issues & Solutions

### Issue: Agent Loops Infinitely
**Cause**: maxSteps too high, model doesn't stop
**Solution**: Set `maxSteps: 30`, add `stopWhen` condition

### Issue: Tool Called Multiple Times Unnecessarily
**Cause**: Model confused or maxSteps too high
**Solution**: Improve tool descriptions, lower maxSteps

### Issue: Agent Doesn't Use Tools
**Cause**: maxSteps = 1 (default), or poor tool descriptions
**Solution**: Set `maxSteps: 30`, improve descriptions with examples

### Issue: Slow Responses
**Cause**: Too many steps, slow tools
**Solution**: Optimize tool execution, consider parallel tool calls (coming soon)

---

## Summary

| Parameter | Purpose | Recommended Value |
|-----------|---------|-------------------|
| maxSteps | Max loop iterations | 30 for agents, 1 for simple |
| stopWhen | Custom termination | Optional, for specific workflows |
| prepareStep | Per-step control | Advanced use only |
| timeout (tool) | Tool execution limit | 30s for bash, higher for slow ops |

**Key Takeaways**:
- ✅ Set `maxSteps: 30` for agentic behavior
- ✅ Log all tool calls for debugging/audit
- ✅ Return errors from tools (don't throw)
- ✅ Set timeouts at tool and generation level
- ✅ Use `ToolLoopAgent` for production

**Sources**:
- [Agents: Loop Control - AI SDK](https://ai-sdk.dev/docs/agents/loop-control)
- [How to build AI Agents with Vercel AI SDK](https://vercel.com/kb/guide/how-to-build-ai-agents-with-vercel-and-the-ai-sdk)
- [AI SDK 6 - Vercel](https://vercel.com/blog/ai-sdk-6)
- [ToolLoopAgent Reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent)
- [Multi-Step & Generative UI](https://vercel.com/academy/ai-sdk/multi-step-and-generative-ui)
