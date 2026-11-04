/**
 * Integration tests for AgentRunner
 *
 * Tests the AgentRunner with real ModelFactory and ToolRegistry instances,
 * validating the full pipeline: bot config → model resolution → tool
 * resolution → AI generation → structured result.
 *
 * Since we cannot make real API calls in CI (no API keys), the `ai` module
 * (generateText/streamText) is mocked via `t.mock.module()`. However, all
 * other components are real:
 * - Real ModelFactory.createModel() (creates actual provider instances)
 * - Real ToolRegistry with registered tool factories
 * - Real config validation and deep merge logic
 *
 * This file covers:
 * - Full pipeline with ModelFactory + ToolRegistry
 * - Multi-step tool calling simulation
 * - Streaming with real components
 * - Error propagation from real dependencies
 * - Concurrent agent runs
 * - Timeout behavior
 * - Bot config variations (custom maxSteps, temperature, etc.)
 */

import { describe, test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ModelFactory } from '../../../src/models/model-factory.js';
import { ToolRegistry } from '../../../src/tools/tool-registry.js';

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * Create a mock ContainerPool for ToolRegistry
 * @returns {Object} Mock container pool
 */
function createMockContainerPool() {
  return {
    getContainer: mock.fn(async _botId => ({
      id: 'mock-container-123',
      exec: mock.fn(async () => ({
        start: mock.fn(async () => ({})),
      })),
    })),
    hasContainer: mock.fn(_botId => true),
  };
}

/**
 * Create a simple tool factory for testing
 * @param {string} name - Tool name
 * @param {Function} [executeFn] - Custom execute function
 * @returns {Function} Tool factory function
 */
function createTestToolFactory(name, executeFn) {
  return (_containerPool, _botId, _config) => ({
    description: `Test ${name} tool`,
    parameters: {
      type: 'object',
      properties: {
        input: { type: 'string' },
      },
      required: ['input'],
    },
    execute: executeFn || (async ({ input }) => ({ result: `${name}: ${input}` })),
  });
}

/**
 * Create a valid bot config for testing
 * @param {Object} [overrides={}] - Config overrides
 * @returns {Object} Bot config
 */
function createBotConfig(overrides = {}) {
  return {
    id: 'integration-test-bot',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    apiKey: 'sk-ant-test-key-integration',
    tools: [],
    maxSteps: 30,
    ...overrides,
  };
}

/**
 * Create test messages
 * @param {string} [content='Hello, how can you help?'] - User message content
 * @returns {Array<Object>} Messages array
 */
function createMessages(content = 'Hello, how can you help?') {
  return [{ role: 'user', content }];
}

/**
 * Create messages with system prompt
 * @param {string} systemPrompt - System prompt content
 * @param {string} userMessage - User message content
 * @returns {Array<Object>} Messages array
 */
function createMessagesWithSystem(systemPrompt, userMessage) {
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];
}

// ─── Unique query string counter for module re-imports ────────────
let importCounter = 0;
function nextImportId() {
  return `integ_${++importCounter}_${Date.now()}`;
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('AgentRunner Integration', () => {
  let containerPool;
  let toolRegistry;

  beforeEach(() => {
    containerPool = createMockContainerPool();
    toolRegistry = new ToolRegistry(containerPool);
  });

  // =========================================================================
  // Full Pipeline: ModelFactory + ToolRegistry + AgentRunner
  // =========================================================================

  describe('full pipeline with real ModelFactory and ToolRegistry', () => {
    test('runs agent with real ModelFactory and ToolRegistry', async t => {
      const mockResult = {
        text: 'I can help you with many things!',
        toolCalls: [],
        usage: { promptTokens: 50, completionTokens: 25, totalTokens: 75 },
        steps: [],
        finishReason: 'stop',
      };

      let capturedArgs;
      const aiMock = t.mock.module('ai', {
        namedExports: {
          generateText: mock.fn(async args => {
            capturedArgs = args;
            return mockResult;
          }),
          streamText: mock.fn(),
        },
      });

      const { AgentRunner } = await import(`../../../src/agent/agent-runner.js?${nextImportId()}`);

      const runner = new AgentRunner(ModelFactory, toolRegistry);
      const botConfig = createBotConfig();
      const messages = createMessages();

      const result = await runner.run(botConfig, messages);

      // Verify result structure
      assert.equal(result.text, 'I can help you with many things!');
      assert.deepEqual(result.toolCalls, []);
      assert.equal(result.usage.totalTokens, 75);
      assert.equal(result.finishReason, 'stop');

      // Verify model was created by real ModelFactory
      assert.ok(capturedArgs.model, 'Model should be passed to generateText');
      assert.equal(capturedArgs.messages, messages);
      assert.equal(capturedArgs.maxSteps, 30);

      aiMock.restore();
    });

    test('resolves registered tools from real ToolRegistry', async t => {
      // Register test tools in real ToolRegistry
      toolRegistry.registerTool('testBash', createTestToolFactory('bash'));
      toolRegistry.registerTool('testRead', createTestToolFactory('readFile'));

      let capturedArgs;
      const aiMock = t.mock.module('ai', {
        namedExports: {
          generateText: mock.fn(async args => {
            capturedArgs = args;
            return {
              text: 'Done!',
              toolCalls: [],
              usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
              steps: [],
              finishReason: 'stop',
            };
          }),
          streamText: mock.fn(),
        },
      });

      const { AgentRunner } = await import(`../../../src/agent/agent-runner.js?${nextImportId()}`);

      const runner = new AgentRunner(ModelFactory, toolRegistry);
      const botConfig = createBotConfig({ tools: ['testBash', 'testRead'] });

      await runner.run(botConfig, createMessages());

      // Verify tools were resolved from real ToolRegistry
      assert.ok(capturedArgs.tools, 'Tools should be passed to generateText');
      assert.ok(capturedArgs.tools.testBash, 'testBash tool should be resolved');
      assert.ok(capturedArgs.tools.testRead, 'testRead tool should be resolved');
      assert.equal(capturedArgs.tools.testBash.description, 'Test bash tool');
      assert.equal(capturedArgs.tools.testRead.description, 'Test readFile tool');

      aiMock.restore();
    });

    test('passes resolved tools with working execute functions', async t => {
      let capturedTools;
      toolRegistry.registerTool(
        'calculator',
        createTestToolFactory('calc', async ({ input }) => ({
          result: `Calculated: ${input}`,
          value: 42,
        }))
      );

      const aiMock = t.mock.module('ai', {
        namedExports: {
          generateText: mock.fn(async args => {
            capturedTools = args.tools;
            return {
              text: 'Result is 42',
              toolCalls: [{ toolName: 'calculator', args: { input: '6 * 7' } }],
              usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
              steps: [],
              finishReason: 'stop',
            };
          }),
          streamText: mock.fn(),
        },
      });

      const { AgentRunner } = await import(`../../../src/agent/agent-runner.js?${nextImportId()}`);

      const runner = new AgentRunner(ModelFactory, toolRegistry);
      await runner.run(createBotConfig({ tools: ['calculator'] }), createMessages());

      // Verify the tool's execute function works
      const execResult = await capturedTools.calculator.execute({ input: 'test' });
      assert.equal(execResult.result, 'Calculated: test');
      assert.equal(execResult.value, 42);

      aiMock.restore();
    });
  });

  // =========================================================================
  // Multi-Step Tool Calling
  // =========================================================================

  describe('multi-step tool calling simulation', () => {
    test('handles multi-step result with tool call chain', async t => {
      toolRegistry.registerTool('bash', createTestToolFactory('bash'));
      toolRegistry.registerTool('readFile', createTestToolFactory('readFile'));

      const multiStepResult = {
        text: 'I found 3 JavaScript files in the src directory.',
        toolCalls: [
          { toolName: 'bash', args: { input: 'ls src/' } },
          { toolName: 'readFile', args: { input: 'src/index.js' } },
        ],
        usage: { promptTokens: 150, completionTokens: 80, totalTokens: 230 },
        steps: [
          {
            text: '',
            toolCalls: [{ toolName: 'bash', args: { input: 'ls src/' } }],
            toolResults: [{ toolName: 'bash', result: 'index.js\nutils.js\napp.js' }],
          },
          {
            text: '',
            toolCalls: [{ toolName: 'readFile', args: { input: 'src/index.js' } }],
            toolResults: [{ toolName: 'readFile', result: 'export function main() {}' }],
          },
          {
            text: 'I found 3 JavaScript files in the src directory.',
            toolCalls: [],
          },
        ],
        finishReason: 'stop',
      };

      const aiMock = t.mock.module('ai', {
        namedExports: {
          generateText: mock.fn(async () => multiStepResult),
          streamText: mock.fn(),
        },
      });

      const { AgentRunner } = await import(`../../../src/agent/agent-runner.js?${nextImportId()}`);

      const runner = new AgentRunner(ModelFactory, toolRegistry);
      const result = await runner.run(
        createBotConfig({ tools: ['bash', 'readFile'] }),
        createMessages('List all JavaScript files in the src directory')
      );

      assert.equal(result.text, 'I found 3 JavaScript files in the src directory.');
      assert.equal(result.toolCalls.length, 2);
      assert.equal(result.toolCalls[0].toolName, 'bash');
      assert.equal(result.toolCalls[1].toolName, 'readFile');
      assert.equal(result.steps.length, 3);
      assert.equal(result.usage.totalTokens, 230);
      assert.equal(result.finishReason, 'stop');

      aiMock.restore();
    });

    test('handles result with maxSteps reached (stop_sequence)', async t => {
      toolRegistry.registerTool('bash', createTestToolFactory('bash'));

      const aiMock = t.mock.module('ai', {
        namedExports: {
          generateText: mock.fn(async () => ({
            text: '',
            toolCalls: [{ toolName: 'bash', args: { input: 'echo step' } }],
            usage: { promptTokens: 500, completionTokens: 300, totalTokens: 800 },
            steps: Array.from({ length: 5 }, (_, i) => ({
              text: '',
              toolCalls: [{ toolName: 'bash', args: { input: `echo step ${i}` } }],
            })),
            finishReason: 'length',
          })),
          streamText: mock.fn(),
        },
      });

      const { AgentRunner } = await import(`../../../src/agent/agent-runner.js?${nextImportId()}`);

      const runner = new AgentRunner(ModelFactory, toolRegistry);
      const result = await runner.run(
        createBotConfig({ tools: ['bash'], maxSteps: 5 }),
        createMessages('Do something complex')
      );

      assert.equal(result.finishReason, 'length');
      assert.equal(result.steps.length, 5);

      aiMock.restore();
    });

    test('passes custom maxSteps to generateText', async t => {
      let capturedArgs;
      const aiMock = t.mock.module('ai', {
        namedExports: {
          generateText: mock.fn(async args => {
            capturedArgs = args;
            return {
              text: 'ok',
              toolCalls: [],
              usage: {},
              steps: [],
              finishReason: 'stop',
            };
          }),
          streamText: mock.fn(),
        },
      });

      const { AgentRunner } = await import(`../../../src/agent/agent-runner.js?${nextImportId()}`);

      const runner = new AgentRunner(ModelFactory, toolRegistry);
      await runner.run(createBotConfig({ maxSteps: 10 }), createMessages());

      assert.equal(capturedArgs.maxSteps, 10);

      aiMock.restore();
    });
  });

  // =========================================================================
  // Streaming with Real Components
  // =========================================================================

  describe('streaming with real ModelFactory and ToolRegistry', () => {
    test('streams text via onChunk callback with real components', async t => {
      toolRegistry.registerTool('bash', createTestToolFactory('bash'));

      const chunks = ['Here ', 'are ', 'your ', 'files: ', 'a.js, b.js'];

      async function* mockTextStream() {
        for (const chunk of chunks) {
          yield chunk;
        }
      }

      const mockStreamResult = {
        textStream: mockTextStream(),
        then(resolve) {
          resolve({
            toolCalls: [{ toolName: 'bash', args: { input: 'ls' } }],
            usage: { promptTokens: 30, completionTokens: 15, totalTokens: 45 },
            finishReason: 'stop',
          });
        },
      };

      const aiMock = t.mock.module('ai', {
        namedExports: {
          generateText: mock.fn(),
          streamText: mock.fn(() => mockStreamResult),
        },
      });

      const { AgentRunner } = await import(`../../../src/agent/agent-runner.js?${nextImportId()}`);

      const receivedChunks = [];
      const runner = new AgentRunner(ModelFactory, toolRegistry);
      const result = await runner.stream(
        createBotConfig({ tools: ['bash'] }),
        createMessages('List files'),
        chunk => receivedChunks.push(chunk)
      );

      assert.deepEqual(receivedChunks, chunks);
      assert.equal(result.text, 'Here are your files: a.js, b.js');
      assert.equal(result.usage.totalTokens, 45);
      assert.equal(result.finishReason, 'stop');

      aiMock.restore();
    });

    test('stream resolves tools from real ToolRegistry', async t => {
      toolRegistry.registerTool('grep', createTestToolFactory('grep'));
      toolRegistry.registerTool('readFile', createTestToolFactory('readFile'));

      let capturedArgs;
      async function* mockTextStream() {
        yield 'Found matches.';
      }

      const aiMock = t.mock.module('ai', {
        namedExports: {
          generateText: mock.fn(),
          streamText: mock.fn(args => {
            capturedArgs = args;
            return {
              textStream: mockTextStream(),
              then(resolve) {
                resolve({
                  toolCalls: [],
                  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
                  finishReason: 'stop',
                });
              },
            };
          }),
        },
      });

      const { AgentRunner } = await import(`../../../src/agent/agent-runner.js?${nextImportId()}`);

      const runner = new AgentRunner(ModelFactory, toolRegistry);
      await runner.stream(
        createBotConfig({ tools: ['grep', 'readFile'] }),
        createMessages('Search for errors'),
        () => {}
      );

      assert.ok(capturedArgs.tools.grep, 'grep tool should be resolved');
      assert.ok(capturedArgs.tools.readFile, 'readFile tool should be resolved');

      aiMock.restore();
    });
  });

  // =========================================================================
  // Error Propagation from Real Dependencies
  // =========================================================================

  describe('error propagation from real components', () => {
    test('propagates ModelFactory error for unsupported provider', async t => {
      const aiMock = t.mock.module('ai', {
        namedExports: {
          generateText: mock.fn(),
          streamText: mock.fn(),
        },
      });

      const { AgentRunner } = await import(`../../../src/agent/agent-runner.js?${nextImportId()}`);

      const runner = new AgentRunner(ModelFactory, toolRegistry);

      await assert.rejects(
        () => runner.run(createBotConfig({ provider: 'unsupported-provider' }), createMessages()),
        err => {
          assert.equal(err.name, 'AgentRunnerError');
          assert.match(err.message, /Failed to create model/);
          assert.match(err.message, /unsupported-provider|Unsupported provider/i);
          assert.equal(err.operation, '_resolveConfig');
          assert.ok(err.cause);
          return true;
        }
      );

      aiMock.restore();
    });

    test('propagates ModelFactory error for missing model name', async t => {
      const aiMock = t.mock.module('ai', {
        namedExports: {
          generateText: mock.fn(),
          streamText: mock.fn(),
        },
      });

      const { AgentRunner } = await import(`../../../src/agent/agent-runner.js?${nextImportId()}`);

      const runner = new AgentRunner(ModelFactory, toolRegistry);

      // The validation in AgentRunner will catch missing model first
      await assert.rejects(
        () => runner.run({ id: 'bot', provider: 'anthropic', model: '' }, createMessages()),
        err => {
          assert.equal(err.name, 'AgentRunnerError');
          return true;
        }
      );

      aiMock.restore();
    });

    test('propagates ToolRegistry error for tool creation failure', async t => {
      // Register a tool factory that throws
      toolRegistry.registerTool('broken', () => {
        throw new Error('Docker daemon not running');
      });

      const aiMock = t.mock.module('ai', {
        namedExports: {
          generateText: mock.fn(),
          streamText: mock.fn(),
        },
      });

      const { AgentRunner } = await import(`../../../src/agent/agent-runner.js?${nextImportId()}`);

      const runner = new AgentRunner(ModelFactory, toolRegistry);

      await assert.rejects(
        () => runner.run(createBotConfig({ tools: ['broken'] }), createMessages()),
        err => {
          assert.equal(err.name, 'AgentRunnerError');
          assert.match(err.message, /Failed to resolve tools/);
          assert.ok(err.cause);
          return true;
        }
      );

      aiMock.restore();
    });

    test('wraps generateText API errors with context', async t => {
      const aiMock = t.mock.module('ai', {
        namedExports: {
          generateText: mock.fn(async () => {
            const err = new Error('401 Unauthorized: Invalid API key');
            err.status = 401;
            throw err;
          }),
          streamText: mock.fn(),
        },
      });

      const { AgentRunner } = await import(`../../../src/agent/agent-runner.js?${nextImportId()}`);

      const runner = new AgentRunner(ModelFactory, toolRegistry);

      await assert.rejects(
        () => runner.run(createBotConfig(), createMessages()),
        err => {
          assert.equal(err.name, 'AgentRunnerError');
          assert.match(err.message, /Agent run failed for bot "integration-test-bot"/);
          assert.match(err.message, /401 Unauthorized/);
          assert.equal(err.operation, 'run');
          assert.equal(err.botId, 'integration-test-bot');
          assert.ok(err.cause);
          assert.equal(err.cause.status, 401);
          return true;
        }
      );

      aiMock.restore();
    });

    test('wraps rate limit errors with context', async t => {
      const aiMock = t.mock.module('ai', {
        namedExports: {
          generateText: mock.fn(async () => {
            const err = new Error('429 Too Many Requests: Rate limit exceeded');
            err.status = 429;
            throw err;
          }),
          streamText: mock.fn(),
        },
      });

      const { AgentRunner } = await import(`../../../src/agent/agent-runner.js?${nextImportId()}`);

      const runner = new AgentRunner(ModelFactory, toolRegistry);

      await assert.rejects(
        () => runner.run(createBotConfig(), createMessages()),
        err => {
          assert.equal(err.name, 'AgentRunnerError');
          assert.match(err.message, /Rate limit exceeded/);
          assert.equal(err.botId, 'integration-test-bot');
          assert.ok(err.cause);
          return true;
        }
      );

      aiMock.restore();
    });

    test('wraps stream errors with context', async t => {
      const aiMock = t.mock.module('ai', {
        namedExports: {
          generateText: mock.fn(),
          streamText: mock.fn(() => {
            throw new Error('Connection refused');
          }),
        },
      });

      const { AgentRunner } = await import(`../../../src/agent/agent-runner.js?${nextImportId()}`);

      const runner = new AgentRunner(ModelFactory, toolRegistry);

      await assert.rejects(
        () => runner.stream(createBotConfig(), createMessages(), () => {}),
        err => {
          assert.equal(err.name, 'AgentRunnerError');
          assert.match(err.message, /Agent stream failed/);
          assert.match(err.message, /Connection refused/);
          assert.equal(err.operation, 'stream');
          return true;
        }
      );

      aiMock.restore();
    });
  });

  // =========================================================================
  // Bot Config Variations
  // =========================================================================

  describe('bot config variations', () => {
    test('passes temperature to generateText when specified', async t => {
      let capturedArgs;
      const aiMock = t.mock.module('ai', {
        namedExports: {
          generateText: mock.fn(async args => {
            capturedArgs = args;
            return {
              text: 'Creative response!',
              toolCalls: [],
              usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
              steps: [],
              finishReason: 'stop',
            };
          }),
          streamText: mock.fn(),
        },
      });

      const { AgentRunner } = await import(`../../../src/agent/agent-runner.js?${nextImportId()}`);

      const runner = new AgentRunner(ModelFactory, toolRegistry);
      await runner.run(createBotConfig({ temperature: 0.9 }), createMessages());

      assert.equal(capturedArgs.temperature, 0.9);

      aiMock.restore();
    });

    test('omits temperature when not specified', async t => {
      let capturedArgs;
      const aiMock = t.mock.module('ai', {
        namedExports: {
          generateText: mock.fn(async args => {
            capturedArgs = args;
            return {
              text: 'ok',
              toolCalls: [],
              usage: {},
              steps: [],
              finishReason: 'stop',
            };
          }),
          streamText: mock.fn(),
        },
      });

      const { AgentRunner } = await import(`../../../src/agent/agent-runner.js?${nextImportId()}`);

      const runner = new AgentRunner(ModelFactory, toolRegistry);
      const config = createBotConfig();
      delete config.temperature;
      await runner.run(config, createMessages());

      assert.equal(capturedArgs.temperature, undefined);

      aiMock.restore();
    });

    test('supports system message in messages array', async t => {
      let capturedArgs;
      const aiMock = t.mock.module('ai', {
        namedExports: {
          generateText: mock.fn(async args => {
            capturedArgs = args;
            return {
              text: 'As a helpful coding assistant...',
              toolCalls: [],
              usage: { promptTokens: 40, completionTokens: 20, totalTokens: 60 },
              steps: [],
              finishReason: 'stop',
            };
          }),
          streamText: mock.fn(),
        },
      });

      const { AgentRunner } = await import(`../../../src/agent/agent-runner.js?${nextImportId()}`);

      const runner = new AgentRunner(ModelFactory, toolRegistry);
      const messages = createMessagesWithSystem(
        'You are a helpful coding assistant.',
        'How do I use async/await?'
      );

      await runner.run(createBotConfig(), messages);

      assert.equal(capturedArgs.messages.length, 2);
      assert.equal(capturedArgs.messages[0].role, 'system');
      assert.equal(capturedArgs.messages[1].role, 'user');

      aiMock.restore();
    });

    test('handles bot with no tools (empty tools array)', async t => {
      let capturedArgs;
      const aiMock = t.mock.module('ai', {
        namedExports: {
          generateText: mock.fn(async args => {
            capturedArgs = args;
            return {
              text: 'I can answer questions but cannot run tools.',
              toolCalls: [],
              usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
              steps: [],
              finishReason: 'stop',
            };
          }),
          streamText: mock.fn(),
        },
      });

      const { AgentRunner } = await import(`../../../src/agent/agent-runner.js?${nextImportId()}`);

      const runner = new AgentRunner(ModelFactory, toolRegistry);
      const result = await runner.run(createBotConfig({ tools: [] }), createMessages());

      assert.equal(result.text, 'I can answer questions but cannot run tools.');
      assert.deepEqual(result.toolCalls, []);
      // Tools should be an empty object when no tools are configured
      assert.deepEqual(capturedArgs.tools, {});

      aiMock.restore();
    });

    test('skips unregistered tool names gracefully', async t => {
      toolRegistry.registerTool('bash', createTestToolFactory('bash'));

      let capturedArgs;
      const aiMock = t.mock.module('ai', {
        namedExports: {
          generateText: mock.fn(async args => {
            capturedArgs = args;
            return {
              text: 'ok',
              toolCalls: [],
              usage: {},
              steps: [],
              finishReason: 'stop',
            };
          }),
          streamText: mock.fn(),
        },
      });

      const { AgentRunner } = await import(`../../../src/agent/agent-runner.js?${nextImportId()}`);

      const runner = new AgentRunner(ModelFactory, toolRegistry);
      await runner.run(createBotConfig({ tools: ['bash', 'nonexistentTool'] }), createMessages());

      // Only bash should be resolved; nonexistentTool silently skipped
      assert.ok(capturedArgs.tools.bash, 'bash should be resolved');
      assert.equal(
        capturedArgs.tools.nonexistentTool,
        undefined,
        'nonexistentTool should be skipped'
      );

      aiMock.restore();
    });

    test('uses different providers via ModelFactory', async t => {
      let capturedArgs;
      const aiMock = t.mock.module('ai', {
        namedExports: {
          generateText: mock.fn(async args => {
            capturedArgs = args;
            return {
              text: 'Response from OpenAI model',
              toolCalls: [],
              usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
              steps: [],
              finishReason: 'stop',
            };
          }),
          streamText: mock.fn(),
        },
      });

      const { AgentRunner } = await import(`../../../src/agent/agent-runner.js?${nextImportId()}`);

      const runner = new AgentRunner(ModelFactory, toolRegistry);
      const result = await runner.run(
        createBotConfig({
          provider: 'openai',
          model: 'gpt-4o',
          apiKey: 'sk-openai-test-key',
        }),
        createMessages()
      );

      assert.equal(result.text, 'Response from OpenAI model');
      assert.ok(capturedArgs.model, 'Model should be created by ModelFactory');

      aiMock.restore();
    });
  });

  // =========================================================================
  // Concurrent Agent Runs
  // =========================================================================

  describe('concurrent agent runs', () => {
    test('handles multiple concurrent runs with different bots', async t => {
      let callCount = 0;
      const aiMock = t.mock.module('ai', {
        namedExports: {
          generateText: mock.fn(async args => {
            callCount++;
            const botId = args.messages[0].content;
            // Simulate different response times
            await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
            return {
              text: `Response for: ${botId}`,
              toolCalls: [],
              usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
              steps: [],
              finishReason: 'stop',
            };
          }),
          streamText: mock.fn(),
        },
      });

      const { AgentRunner } = await import(`../../../src/agent/agent-runner.js?${nextImportId()}`);

      const runner = new AgentRunner(ModelFactory, toolRegistry);

      const results = await Promise.all([
        runner.run(createBotConfig({ id: 'bot-1' }), createMessages('bot-1')),
        runner.run(createBotConfig({ id: 'bot-2' }), createMessages('bot-2')),
        runner.run(createBotConfig({ id: 'bot-3' }), createMessages('bot-3')),
      ]);

      assert.equal(results.length, 3);
      assert.equal(callCount, 3);

      // Each response should correspond to its bot
      const texts = results.map(r => r.text);
      assert.ok(texts.includes('Response for: bot-1'));
      assert.ok(texts.includes('Response for: bot-2'));
      assert.ok(texts.includes('Response for: bot-3'));

      aiMock.restore();
    });

    test('concurrent errors do not affect other runs', async t => {
      let callIndex = 0;
      const aiMock = t.mock.module('ai', {
        namedExports: {
          generateText: mock.fn(async () => {
            callIndex++;
            if (callIndex === 2) {
              throw new Error('API error for second call');
            }
            return {
              text: `Success #${callIndex}`,
              toolCalls: [],
              usage: {},
              steps: [],
              finishReason: 'stop',
            };
          }),
          streamText: mock.fn(),
        },
      });

      const { AgentRunner } = await import(`../../../src/agent/agent-runner.js?${nextImportId()}`);

      const runner = new AgentRunner(ModelFactory, toolRegistry);

      const results = await Promise.allSettled([
        runner.run(createBotConfig({ id: 'ok-bot-1' }), createMessages('first')),
        runner.run(createBotConfig({ id: 'fail-bot' }), createMessages('second')),
        runner.run(createBotConfig({ id: 'ok-bot-2' }), createMessages('third')),
      ]);

      assert.equal(results[0].status, 'fulfilled');
      assert.equal(results[1].status, 'rejected');
      assert.equal(results[2].status, 'fulfilled');

      assert.equal(results[1].reason.name, 'AgentRunnerError');
      assert.match(results[1].reason.message, /API error for second call/);

      aiMock.restore();
    });
  });

  // =========================================================================
  // Timeout Behavior
  // =========================================================================

  describe('timeout behavior', () => {
    test('times out when generation takes too long', async t => {
      const aiMock = t.mock.module('ai', {
        namedExports: {
          generateText: mock.fn(async () => {
            // Simulate a long-running generation that exceeds timeout
            await new Promise(resolve => setTimeout(resolve, 2000));
            return {
              text: 'This should never be returned',
              toolCalls: [],
              usage: {},
              steps: [],
              finishReason: 'stop',
            };
          }),
          streamText: mock.fn(),
        },
      });

      const { AgentRunner } = await import(`../../../src/agent/agent-runner.js?${nextImportId()}`);

      const runner = new AgentRunner(ModelFactory, toolRegistry);

      await assert.rejects(
        () =>
          runner.run(
            createBotConfig({ timeout: 100 }), // Very short timeout
            createMessages()
          ),
        err => {
          assert.equal(err.name, 'AgentRunnerError');
          assert.match(err.message, /timed out/i);
          return true;
        }
      );

      aiMock.restore();
    });

    test('completes within timeout for fast responses', async t => {
      const aiMock = t.mock.module('ai', {
        namedExports: {
          generateText: mock.fn(async () => ({
            text: 'Quick response',
            toolCalls: [],
            usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
            steps: [],
            finishReason: 'stop',
          })),
          streamText: mock.fn(),
        },
      });

      const { AgentRunner } = await import(`../../../src/agent/agent-runner.js?${nextImportId()}`);

      const runner = new AgentRunner(ModelFactory, toolRegistry);
      const result = await runner.run(createBotConfig({ timeout: 5000 }), createMessages());

      assert.equal(result.text, 'Quick response');
      assert.equal(result.finishReason, 'stop');

      aiMock.restore();
    });

    test('stream times out when streaming takes too long', async t => {
      async function* slowStream(signal) {
        yield 'start';
        await new Promise((_resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('never')), 5000);
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('The operation was aborted', 'AbortError'));
          });
        });
      }

      const aiMock = t.mock.module('ai', {
        namedExports: {
          generateText: mock.fn(),
          streamText: mock.fn(args => {
            const stream = slowStream(args.abortSignal);
            return {
              textStream: stream,
              then(resolve) {
                resolve({
                  toolCalls: [],
                  usage: {},
                  finishReason: 'stop',
                });
              },
            };
          }),
        },
      });

      const { AgentRunner } = await import(`../../../src/agent/agent-runner.js?${nextImportId()}`);

      const runner = new AgentRunner(ModelFactory, toolRegistry);

      await assert.rejects(
        () => runner.stream(createBotConfig({ timeout: 100 }), createMessages(), () => {}),
        err => {
          assert.equal(err.name, 'AgentRunnerError');
          assert.match(err.message, /Stream timed out/i);
          assert.equal(err.operation, 'stream');
          return true;
        }
      );

      aiMock.restore();
    });

    test('stream completes within timeout for fast responses', async t => {
      async function* fastStream() {
        yield 'quick';
        yield ' response';
      }

      const aiMock = t.mock.module('ai', {
        namedExports: {
          generateText: mock.fn(),
          streamText: mock.fn(() => ({
            textStream: fastStream(),
            then(resolve) {
              resolve({
                toolCalls: [],
                usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
                finishReason: 'stop',
              });
            },
          })),
        },
      });

      const { AgentRunner } = await import(`../../../src/agent/agent-runner.js?${nextImportId()}`);

      const runner = new AgentRunner(ModelFactory, toolRegistry);
      const receivedChunks = [];
      const result = await runner.stream(
        createBotConfig({ timeout: 5000 }),
        createMessages(),
        chunk => receivedChunks.push(chunk)
      );

      assert.equal(result.text, 'quick response');
      assert.deepEqual(receivedChunks, ['quick', ' response']);
      assert.equal(result.finishReason, 'stop');

      aiMock.restore();
    });
  });

  // =========================================================================
  // Result Structure Validation
  // =========================================================================

  describe('result structure consistency', () => {
    test('result always has text, toolCalls, usage, steps, finishReason', async t => {
      const aiMock = t.mock.module('ai', {
        namedExports: {
          generateText: mock.fn(async () => ({
            text: 'response',
            toolCalls: undefined,
            usage: undefined,
            steps: undefined,
            finishReason: 'stop',
          })),
          streamText: mock.fn(),
        },
      });

      const { AgentRunner } = await import(`../../../src/agent/agent-runner.js?${nextImportId()}`);

      const runner = new AgentRunner(ModelFactory, toolRegistry);
      const result = await runner.run(createBotConfig(), createMessages());

      assert.equal(typeof result.text, 'string');
      assert.ok(Array.isArray(result.toolCalls));
      assert.equal(typeof result.usage, 'object');
      assert.ok(Array.isArray(result.steps));
      assert.equal(typeof result.finishReason, 'string');

      aiMock.restore();
    });

    test('stream result has text, toolCalls, usage, finishReason', async t => {
      async function* mockTextStream() {
        yield 'streamed response';
      }

      const aiMock = t.mock.module('ai', {
        namedExports: {
          generateText: mock.fn(),
          streamText: mock.fn(() => ({
            textStream: mockTextStream(),
            then(resolve) {
              resolve({
                toolCalls: undefined,
                usage: undefined,
                finishReason: 'stop',
              });
            },
          })),
        },
      });

      const { AgentRunner } = await import(`../../../src/agent/agent-runner.js?${nextImportId()}`);

      const runner = new AgentRunner(ModelFactory, toolRegistry);
      const result = await runner.stream(createBotConfig(), createMessages(), () => {});

      assert.equal(typeof result.text, 'string');
      assert.ok(Array.isArray(result.toolCalls));
      assert.equal(typeof result.usage, 'object');
      assert.equal(typeof result.finishReason, 'string');

      aiMock.restore();
    });

    test('usage stats reflect token consumption', async t => {
      const aiMock = t.mock.module('ai', {
        namedExports: {
          generateText: mock.fn(async () => ({
            text: 'detailed response with many tokens',
            toolCalls: [],
            usage: {
              promptTokens: 1500,
              completionTokens: 800,
              totalTokens: 2300,
            },
            steps: [],
            finishReason: 'stop',
          })),
          streamText: mock.fn(),
        },
      });

      const { AgentRunner } = await import(`../../../src/agent/agent-runner.js?${nextImportId()}`);

      const runner = new AgentRunner(ModelFactory, toolRegistry);
      const result = await runner.run(createBotConfig(), createMessages());

      assert.equal(result.usage.promptTokens, 1500);
      assert.equal(result.usage.completionTokens, 800);
      assert.equal(result.usage.totalTokens, 2300);

      aiMock.restore();
    });
  });

  // =========================================================================
  // Multi-Turn Conversations
  // =========================================================================

  describe('multi-turn conversation support', () => {
    test('passes multi-turn messages to generateText', async t => {
      let capturedArgs;
      const aiMock = t.mock.module('ai', {
        namedExports: {
          generateText: mock.fn(async args => {
            capturedArgs = args;
            return {
              text: 'Based on our conversation, here is my answer.',
              toolCalls: [],
              usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
              steps: [],
              finishReason: 'stop',
            };
          }),
          streamText: mock.fn(),
        },
      });

      const { AgentRunner } = await import(`../../../src/agent/agent-runner.js?${nextImportId()}`);

      const runner = new AgentRunner(ModelFactory, toolRegistry);
      const messages = [
        { role: 'system', content: 'You are a coding assistant.' },
        { role: 'user', content: 'What is JavaScript?' },
        { role: 'assistant', content: 'JavaScript is a programming language.' },
        { role: 'user', content: 'How do I use async/await?' },
      ];

      const result = await runner.run(createBotConfig(), messages);

      assert.equal(capturedArgs.messages.length, 4);
      assert.equal(capturedArgs.messages[0].role, 'system');
      assert.equal(capturedArgs.messages[3].role, 'user');
      assert.equal(result.text, 'Based on our conversation, here is my answer.');

      aiMock.restore();
    });
  });
});
