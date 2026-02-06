/**
 * Unit tests for AgentRunner
 *
 * Tests agent execution with mocked AI SDK (generateText/streamText),
 * multi-step tool calling, streaming, error handling, and validation.
 * All AI SDK calls are mocked - no real API calls are made.
 */

import { describe, test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { AgentRunner, AgentRunnerError } from '../../../src/agent/agent-runner.js';

// ─── Mock Factories ──────────────────────────────────────────────

/**
 * Create a mock ModelFactory
 * @param {Object} [modelInstance] - Model instance to return
 * @returns {Object} Mock model factory
 */
function createMockModelFactory(modelInstance) {
  const model = modelInstance || {
    modelId: 'claude-sonnet-4-5',
    provider: 'anthropic.messages',
    specificationVersion: 'v1',
  };

  return {
    createModel: mock.fn((_provider, _modelName, _apiKey) => model),
  };
}

/**
 * Create a mock ModelFactory that throws
 * @param {string} [message='Model creation failed'] - Error message
 * @returns {Object} Mock model factory
 */
function createFailingModelFactory(message = 'Model creation failed') {
  return {
    createModel: mock.fn(() => {
      throw new Error(message);
    }),
  };
}

/**
 * Create a mock ToolRegistry
 * @param {Object} [tools={}] - Tools to return from getToolsForBot
 * @returns {Object} Mock tool registry
 */
function createMockToolRegistry(tools = {}) {
  return {
    getToolsForBot: mock.fn(async _botConfig => tools),
  };
}

/**
 * Create a mock ToolRegistry that throws
 * @param {string} [message='Tool resolution failed'] - Error message
 * @returns {Object} Mock tool registry
 */
function createFailingToolRegistry(message = 'Tool resolution failed') {
  return {
    getToolsForBot: mock.fn(async () => {
      throw new Error(message);
    }),
  };
}

/**
 * Create a valid bot config for testing
 * @param {Object} [overrides={}] - Config overrides
 * @returns {Object} Bot config
 */
function createBotConfig(overrides = {}) {
  return {
    id: 'test-bot',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    tools: ['bash', 'readFile'],
    maxSteps: 30,
    ...overrides,
  };
}

/**
 * Create test messages
 * @param {string} [content='Hello'] - User message content
 * @returns {Array<Object>} Messages array
 */
function createMessages(content = 'Hello') {
  return [{ role: 'user', content }];
}

// ─── Tests ────────────────────────────────────────────────────────

describe('AgentRunner', () => {
  let modelFactory;
  let toolRegistry;
  let runner;

  beforeEach(() => {
    modelFactory = createMockModelFactory();
    toolRegistry = createMockToolRegistry();
    runner = new AgentRunner(modelFactory, toolRegistry);
  });

  describe('constructor', () => {
    test('creates instance with modelFactory and toolRegistry', () => {
      const instance = new AgentRunner(modelFactory, toolRegistry);

      assert.ok(instance instanceof AgentRunner);
      assert.equal(instance.modelFactory, modelFactory);
      assert.equal(instance.toolRegistry, toolRegistry);
    });

    test('throws AgentRunnerError when modelFactory is not provided', () => {
      assert.throws(
        () => new AgentRunner(null, toolRegistry),
        err => {
          assert.ok(err instanceof AgentRunnerError);
          assert.equal(err.name, 'AgentRunnerError');
          assert.match(err.message, /ModelFactory is required/);
          assert.equal(err.operation, 'constructor');
          return true;
        }
      );
    });

    test('throws AgentRunnerError when modelFactory is undefined', () => {
      assert.throws(
        () => new AgentRunner(undefined, toolRegistry),
        err => {
          assert.ok(err instanceof AgentRunnerError);
          assert.match(err.message, /ModelFactory is required/);
          return true;
        }
      );
    });

    test('throws AgentRunnerError when toolRegistry is not provided', () => {
      assert.throws(
        () => new AgentRunner(modelFactory, null),
        err => {
          assert.ok(err instanceof AgentRunnerError);
          assert.match(err.message, /ToolRegistry is required/);
          assert.equal(err.operation, 'constructor');
          return true;
        }
      );
    });

    test('throws AgentRunnerError when toolRegistry is undefined', () => {
      assert.throws(
        () => new AgentRunner(modelFactory, undefined),
        err => {
          assert.ok(err instanceof AgentRunnerError);
          assert.match(err.message, /ToolRegistry is required/);
          return true;
        }
      );
    });
  });

  describe('run()', () => {
    // We need to mock the generateText import. Since we can't easily
    // mock ES module imports in node:test without --experimental-test-module-mocks,
    // we'll test via _resolveConfig and validation paths, and use
    // integration-style tests for the actual generateText behavior.

    describe('validation', () => {
      test('throws on null botConfig', async () => {
        await assert.rejects(
          () => runner.run(null, createMessages()),
          err => {
            assert.ok(err instanceof AgentRunnerError);
            assert.match(err.message, /Bot config must be an object/);
            assert.equal(err.operation, 'run');
            return true;
          }
        );
      });

      test('throws on undefined botConfig', async () => {
        await assert.rejects(
          () => runner.run(undefined, createMessages()),
          err => {
            assert.ok(err instanceof AgentRunnerError);
            assert.match(err.message, /Bot config must be an object/);
            return true;
          }
        );
      });

      test('throws on non-object botConfig', async () => {
        await assert.rejects(
          () => runner.run('not-an-object', createMessages()),
          err => {
            assert.ok(err instanceof AgentRunnerError);
            assert.match(err.message, /Bot config must be an object/);
            return true;
          }
        );
      });

      test('throws when botConfig.id is missing', async () => {
        await assert.rejects(
          () => runner.run({ provider: 'anthropic', model: 'x' }, createMessages()),
          err => {
            assert.ok(err instanceof AgentRunnerError);
            assert.match(err.message, /Bot config must have a string "id" property/);
            return true;
          }
        );
      });

      test('throws when botConfig.id is empty string', async () => {
        await assert.rejects(
          () => runner.run({ id: '', provider: 'anthropic', model: 'x' }, createMessages()),
          err => {
            assert.ok(err instanceof AgentRunnerError);
            assert.match(err.message, /Bot config must have a string "id" property/);
            return true;
          }
        );
      });

      test('throws when botConfig.provider is missing', async () => {
        await assert.rejects(
          () => runner.run({ id: 'bot', model: 'x' }, createMessages()),
          err => {
            assert.ok(err instanceof AgentRunnerError);
            assert.match(err.message, /Bot config must have a string "provider" property/);
            assert.equal(err.botId, 'bot');
            return true;
          }
        );
      });

      test('throws when botConfig.model is missing', async () => {
        await assert.rejects(
          () => runner.run({ id: 'bot', provider: 'anthropic' }, createMessages()),
          err => {
            assert.ok(err instanceof AgentRunnerError);
            assert.match(err.message, /Bot config must have a string "model" property/);
            assert.equal(err.botId, 'bot');
            return true;
          }
        );
      });

      test('throws on non-array messages', async () => {
        await assert.rejects(
          () => runner.run(createBotConfig(), 'not-an-array'),
          err => {
            assert.ok(err instanceof AgentRunnerError);
            assert.match(err.message, /Messages must be an array/);
            assert.equal(err.operation, 'run');
            return true;
          }
        );
      });

      test('throws on null messages', async () => {
        await assert.rejects(
          () => runner.run(createBotConfig(), null),
          err => {
            assert.ok(err instanceof AgentRunnerError);
            assert.match(err.message, /Messages must be an array/);
            return true;
          }
        );
      });

      test('throws on empty messages array', async () => {
        await assert.rejects(
          () => runner.run(createBotConfig(), []),
          err => {
            assert.ok(err instanceof AgentRunnerError);
            assert.match(err.message, /Messages array must not be empty/);
            return true;
          }
        );
      });
    });

    describe('model and tool resolution', () => {
      test('calls modelFactory.createModel with botConfig values', async () => {
        const config = createBotConfig({
          apiKey: 'sk-test-key',
        });

        // Will fail at generateText since we can't mock it, but we can
        // verify the factory was called correctly
        try {
          await runner.run(config, createMessages());
        } catch (_err) {
          // Expected - generateText isn't mocked
        }

        assert.equal(modelFactory.createModel.mock.calls.length, 1);
        const call = modelFactory.createModel.mock.calls[0];
        assert.equal(call.arguments[0], 'anthropic');
        assert.equal(call.arguments[1], 'claude-sonnet-4-5');
        assert.equal(call.arguments[2], 'sk-test-key');
      });

      test('calls toolRegistry.getToolsForBot with botConfig', async () => {
        const config = createBotConfig();

        try {
          await runner.run(config, createMessages());
        } catch (_err) {
          // Expected
        }

        assert.equal(toolRegistry.getToolsForBot.mock.calls.length, 1);
        const call = toolRegistry.getToolsForBot.mock.calls[0];
        assert.equal(call.arguments[0], config);
      });

      test('wraps model creation errors', async () => {
        const failingFactory = createFailingModelFactory('API key invalid');
        const failRunner = new AgentRunner(failingFactory, toolRegistry);

        await assert.rejects(
          () => failRunner.run(createBotConfig(), createMessages()),
          err => {
            assert.ok(err instanceof AgentRunnerError);
            assert.match(err.message, /Failed to create model for bot "test-bot"/);
            assert.match(err.message, /API key invalid/);
            assert.equal(err.operation, '_resolveConfig');
            assert.equal(err.botId, 'test-bot');
            assert.ok(err.cause instanceof Error);
            return true;
          }
        );
      });

      test('wraps tool resolution errors', async () => {
        const failingRegistry = createFailingToolRegistry('Container not found');
        const failRunner = new AgentRunner(modelFactory, failingRegistry);

        await assert.rejects(
          () => failRunner.run(createBotConfig(), createMessages()),
          err => {
            assert.ok(err instanceof AgentRunnerError);
            assert.match(err.message, /Failed to resolve tools for bot "test-bot"/);
            assert.match(err.message, /Container not found/);
            assert.equal(err.operation, '_resolveConfig');
            assert.equal(err.botId, 'test-bot');
            assert.ok(err.cause instanceof Error);
            return true;
          }
        );
      });
    });

    describe('generateText integration', () => {
      test('calls generateText and returns structured result', async t => {
        const mockResult = {
          text: 'The files are: hello.txt, world.txt',
          toolCalls: [
            {
              toolName: 'bash',
              args: { command: 'ls /home/agent' },
            },
          ],
          usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          steps: [{ text: '', toolCalls: [] }],
          finishReason: 'stop',
        };

        // Mock the generateText import at module level
        const generateTextMock = t.mock.module('ai', {
          namedExports: {
            generateText: mock.fn(async () => mockResult),
            streamText: mock.fn(),
          },
        });

        // Re-import to pick up the mock
        const { AgentRunner: MockedRunner } = await import(
          `../../../src/agent/agent-runner.js?t1=${Date.now()}`
        );

        const mockRunner = new MockedRunner(modelFactory, toolRegistry);
        const result = await mockRunner.run(createBotConfig(), createMessages());

        assert.equal(result.text, 'The files are: hello.txt, world.txt');
        assert.equal(result.toolCalls.length, 1);
        assert.equal(result.toolCalls[0].toolName, 'bash');
        assert.equal(result.usage.totalTokens, 150);
        assert.equal(result.finishReason, 'stop');
        assert.ok(Array.isArray(result.steps));

        generateTextMock.restore();
      });

      test('returns empty toolCalls array when no tools called', async t => {
        const mockResult = {
          text: 'Hello! How can I help?',
          toolCalls: undefined,
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          steps: [],
          finishReason: 'stop',
        };

        const generateTextMock = t.mock.module('ai', {
          namedExports: {
            generateText: mock.fn(async () => mockResult),
            streamText: mock.fn(),
          },
        });

        const { AgentRunner: MockedRunner } = await import(
          `../../../src/agent/agent-runner.js?t2=${Date.now()}`
        );

        const mockRunner = new MockedRunner(modelFactory, toolRegistry);
        const result = await mockRunner.run(createBotConfig(), createMessages());

        assert.deepEqual(result.toolCalls, []);
        assert.equal(result.text, 'Hello! How can I help?');

        generateTextMock.restore();
      });

      test('returns empty usage when undefined', async t => {
        const mockResult = {
          text: 'response',
          toolCalls: [],
          usage: undefined,
          finishReason: 'stop',
        };

        const generateTextMock = t.mock.module('ai', {
          namedExports: {
            generateText: mock.fn(async () => mockResult),
            streamText: mock.fn(),
          },
        });

        const { AgentRunner: MockedRunner } = await import(
          `../../../src/agent/agent-runner.js?t3=${Date.now()}`
        );

        const mockRunner = new MockedRunner(modelFactory, toolRegistry);
        const result = await mockRunner.run(createBotConfig(), createMessages());

        assert.deepEqual(result.usage, {});

        generateTextMock.restore();
      });

      test('uses default maxSteps of 30 when not specified', async t => {
        let capturedArgs;
        const generateTextMock = t.mock.module('ai', {
          namedExports: {
            generateText: mock.fn(async args => {
              capturedArgs = args;
              return { text: 'ok', toolCalls: [], usage: {}, finishReason: 'stop' };
            }),
            streamText: mock.fn(),
          },
        });

        const { AgentRunner: MockedRunner } = await import(
          `../../../src/agent/agent-runner.js?t4=${Date.now()}`
        );

        const config = createBotConfig({ maxSteps: undefined });
        delete config.maxSteps;

        const mockRunner = new MockedRunner(modelFactory, toolRegistry);
        await mockRunner.run(config, createMessages());

        assert.equal(capturedArgs.maxSteps, 30);

        generateTextMock.restore();
      });

      test('uses custom maxSteps from botConfig', async t => {
        let capturedArgs;
        const generateTextMock = t.mock.module('ai', {
          namedExports: {
            generateText: mock.fn(async args => {
              capturedArgs = args;
              return { text: 'ok', toolCalls: [], usage: {}, finishReason: 'stop' };
            }),
            streamText: mock.fn(),
          },
        });

        const { AgentRunner: MockedRunner } = await import(
          `../../../src/agent/agent-runner.js?t5=${Date.now()}`
        );

        const config = createBotConfig({ maxSteps: 10 });
        const mockRunner = new MockedRunner(modelFactory, toolRegistry);
        await mockRunner.run(config, createMessages());

        assert.equal(capturedArgs.maxSteps, 10);

        generateTextMock.restore();
      });

      test('passes temperature when specified', async t => {
        let capturedArgs;
        const generateTextMock = t.mock.module('ai', {
          namedExports: {
            generateText: mock.fn(async args => {
              capturedArgs = args;
              return { text: 'ok', toolCalls: [], usage: {}, finishReason: 'stop' };
            }),
            streamText: mock.fn(),
          },
        });

        const { AgentRunner: MockedRunner } = await import(
          `../../../src/agent/agent-runner.js?t6=${Date.now()}`
        );

        const config = createBotConfig({ temperature: 0.7 });
        const mockRunner = new MockedRunner(modelFactory, toolRegistry);
        await mockRunner.run(config, createMessages());

        assert.equal(capturedArgs.temperature, 0.7);

        generateTextMock.restore();
      });

      test('omits temperature when not specified', async t => {
        let capturedArgs;
        const generateTextMock = t.mock.module('ai', {
          namedExports: {
            generateText: mock.fn(async args => {
              capturedArgs = args;
              return { text: 'ok', toolCalls: [], usage: {}, finishReason: 'stop' };
            }),
            streamText: mock.fn(),
          },
        });

        const { AgentRunner: MockedRunner } = await import(
          `../../../src/agent/agent-runner.js?t7=${Date.now()}`
        );

        const config = createBotConfig();
        delete config.temperature;
        const mockRunner = new MockedRunner(modelFactory, toolRegistry);
        await mockRunner.run(config, createMessages());

        assert.equal(capturedArgs.temperature, undefined);

        generateTextMock.restore();
      });

      test('passes resolved model and tools to generateText', async t => {
        let capturedArgs;
        const mockModel = { modelId: 'test-model', provider: 'test' };
        const mockTools = {
          bash: { description: 'Run bash', execute: async () => ({}) },
        };

        const generateTextMock = t.mock.module('ai', {
          namedExports: {
            generateText: mock.fn(async args => {
              capturedArgs = args;
              return { text: 'ok', toolCalls: [], usage: {}, finishReason: 'stop' };
            }),
            streamText: mock.fn(),
          },
        });

        const { AgentRunner: MockedRunner } = await import(
          `../../../src/agent/agent-runner.js?t8=${Date.now()}`
        );

        const factory = createMockModelFactory(mockModel);
        const registry = createMockToolRegistry(mockTools);
        const mockRunner = new MockedRunner(factory, registry);

        const messages = [{ role: 'user', content: 'test' }];
        await mockRunner.run(createBotConfig(), messages);

        assert.equal(capturedArgs.model, mockModel);
        assert.equal(capturedArgs.tools, mockTools);
        assert.equal(capturedArgs.messages, messages);

        generateTextMock.restore();
      });

      test('wraps generateText errors with context', async t => {
        const generateTextMock = t.mock.module('ai', {
          namedExports: {
            generateText: mock.fn(async () => {
              throw new Error('Rate limit exceeded');
            }),
            streamText: mock.fn(),
          },
        });

        const { AgentRunner: MockedRunner } = await import(
          `../../../src/agent/agent-runner.js?t9=${Date.now()}`
        );

        const mockRunner = new MockedRunner(modelFactory, toolRegistry);

        await assert.rejects(
          () => mockRunner.run(createBotConfig(), createMessages()),
          err => {
            // Use err.name instead of instanceof because module mocking
            // re-imports create a separate AgentRunnerError class
            assert.equal(err.name, 'AgentRunnerError');
            assert.match(err.message, /Agent run failed for bot "test-bot"/);
            assert.match(err.message, /Rate limit exceeded/);
            assert.equal(err.operation, 'run');
            assert.equal(err.botId, 'test-bot');
            assert.ok(err.cause instanceof Error);
            return true;
          }
        );

        generateTextMock.restore();
      });

      test('handles multi-step tool calls result', async t => {
        const mockResult = {
          text: 'File created and verified.',
          toolCalls: [
            { toolName: 'writeFile', args: { path: '/tmp/test.txt', content: 'hello' } },
            { toolName: 'readFile', args: { path: '/tmp/test.txt' } },
          ],
          usage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 },
          steps: [
            { text: '', toolCalls: [{ toolName: 'writeFile' }] },
            { text: '', toolCalls: [{ toolName: 'readFile' }] },
            { text: 'File created and verified.' },
          ],
          finishReason: 'stop',
        };

        const generateTextMock = t.mock.module('ai', {
          namedExports: {
            generateText: mock.fn(async () => mockResult),
            streamText: mock.fn(),
          },
        });

        const { AgentRunner: MockedRunner } = await import(
          `../../../src/agent/agent-runner.js?t10=${Date.now()}`
        );

        const mockRunner = new MockedRunner(modelFactory, toolRegistry);
        const result = await mockRunner.run(createBotConfig(), createMessages());

        assert.equal(result.text, 'File created and verified.');
        assert.equal(result.toolCalls.length, 2);
        assert.equal(result.toolCalls[0].toolName, 'writeFile');
        assert.equal(result.toolCalls[1].toolName, 'readFile');
        assert.equal(result.steps.length, 3);
        assert.equal(result.usage.totalTokens, 300);

        generateTextMock.restore();
      });
    });
  });

  describe('stream()', () => {
    describe('validation', () => {
      test('throws on null botConfig', async () => {
        await assert.rejects(
          () => runner.stream(null, createMessages(), () => {}),
          err => {
            assert.ok(err instanceof AgentRunnerError);
            assert.match(err.message, /Bot config must be an object/);
            assert.equal(err.operation, 'stream');
            return true;
          }
        );
      });

      test('throws on non-array messages', async () => {
        await assert.rejects(
          () => runner.stream(createBotConfig(), 'not-array', () => {}),
          err => {
            assert.ok(err instanceof AgentRunnerError);
            assert.match(err.message, /Messages must be an array/);
            return true;
          }
        );
      });

      test('throws on empty messages', async () => {
        await assert.rejects(
          () => runner.stream(createBotConfig(), [], () => {}),
          err => {
            assert.ok(err instanceof AgentRunnerError);
            assert.match(err.message, /Messages array must not be empty/);
            return true;
          }
        );
      });

      test('throws when onChunk is not a function', async () => {
        await assert.rejects(
          () => runner.stream(createBotConfig(), createMessages(), 'not-a-function'),
          err => {
            assert.ok(err instanceof AgentRunnerError);
            assert.match(err.message, /onChunk callback must be a function/);
            assert.equal(err.operation, 'stream');
            assert.equal(err.botId, 'test-bot');
            return true;
          }
        );
      });

      test('throws when onChunk is null', async () => {
        await assert.rejects(
          () => runner.stream(createBotConfig(), createMessages(), null),
          err => {
            assert.ok(err instanceof AgentRunnerError);
            assert.match(err.message, /onChunk callback must be a function/);
            return true;
          }
        );
      });

      test('throws when onChunk is undefined', async () => {
        await assert.rejects(
          () => runner.stream(createBotConfig(), createMessages(), undefined),
          err => {
            assert.ok(err instanceof AgentRunnerError);
            assert.match(err.message, /onChunk callback must be a function/);
            return true;
          }
        );
      });

      test('throws when missing botConfig.provider', async () => {
        await assert.rejects(
          () => runner.stream({ id: 'bot', model: 'x' }, createMessages(), () => {}),
          err => {
            assert.ok(err instanceof AgentRunnerError);
            assert.match(err.message, /Bot config must have a string "provider" property/);
            return true;
          }
        );
      });
    });

    describe('streamText integration', () => {
      test('streams text chunks via onChunk callback', async t => {
        const chunks = ['Hello', ' ', 'World', '!'];

        async function* mockTextStream() {
          for (const chunk of chunks) {
            yield chunk;
          }
        }

        const mockStreamResult = {
          textStream: mockTextStream(),
          toolCalls: [],
          usage: Promise.resolve({ promptTokens: 10, completionTokens: 5, totalTokens: 15 }),
          finishReason: Promise.resolve('stop'),
          then(resolve) {
            resolve({
              toolCalls: [],
              usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
              finishReason: 'stop',
            });
          },
        };

        const streamTextMock = t.mock.module('ai', {
          namedExports: {
            generateText: mock.fn(),
            streamText: mock.fn(() => mockStreamResult),
          },
        });

        const { AgentRunner: MockedRunner } = await import(
          `../../../src/agent/agent-runner.js?s1=${Date.now()}`
        );

        const receivedChunks = [];
        const onChunk = chunk => receivedChunks.push(chunk);

        const mockRunner = new MockedRunner(modelFactory, toolRegistry);
        const result = await mockRunner.stream(createBotConfig(), createMessages(), onChunk);

        assert.deepEqual(receivedChunks, chunks);
        assert.equal(result.text, 'Hello World!');
        assert.deepEqual(result.toolCalls, []);
        assert.equal(result.usage.totalTokens, 15);

        streamTextMock.restore();
      });

      test('wraps streamText errors with context', async t => {
        const streamTextMock = t.mock.module('ai', {
          namedExports: {
            generateText: mock.fn(),
            streamText: mock.fn(() => {
              throw new Error('Stream initialization failed');
            }),
          },
        });

        const { AgentRunner: MockedRunner } = await import(
          `../../../src/agent/agent-runner.js?s2=${Date.now()}`
        );

        const mockRunner = new MockedRunner(modelFactory, toolRegistry);

        await assert.rejects(
          () => mockRunner.stream(createBotConfig(), createMessages(), () => {}),
          err => {
            // Use err.name instead of instanceof because module mocking
            // re-imports create a separate AgentRunnerError class
            assert.equal(err.name, 'AgentRunnerError');
            assert.match(err.message, /Agent stream failed for bot "test-bot"/);
            assert.match(err.message, /Stream initialization failed/);
            assert.equal(err.operation, 'stream');
            assert.equal(err.botId, 'test-bot');
            return true;
          }
        );

        streamTextMock.restore();
      });

      test('wraps model creation errors in stream', async () => {
        const failingFactory = createFailingModelFactory('Invalid API key');
        const failRunner = new AgentRunner(failingFactory, toolRegistry);

        await assert.rejects(
          () => failRunner.stream(createBotConfig(), createMessages(), () => {}),
          err => {
            assert.ok(err instanceof AgentRunnerError);
            assert.match(err.message, /Failed to create model for bot "test-bot"/);
            assert.match(err.message, /Invalid API key/);
            return true;
          }
        );
      });

      test('wraps tool resolution errors in stream', async () => {
        const failingRegistry = createFailingToolRegistry('Docker unavailable');
        const failRunner = new AgentRunner(modelFactory, failingRegistry);

        await assert.rejects(
          () => failRunner.stream(createBotConfig(), createMessages(), () => {}),
          err => {
            assert.ok(err instanceof AgentRunnerError);
            assert.match(err.message, /Failed to resolve tools for bot "test-bot"/);
            assert.match(err.message, /Docker unavailable/);
            return true;
          }
        );
      });

      test('aborts stream when onChunk callback throws', async t => {
        let abortSignalUsed;
        const callbackError = new Error('onChunk processing failed');

        async function* mockTextStream() {
          yield 'first chunk';
          yield 'second chunk';
        }

        const mockStreamResult = {
          textStream: mockTextStream(),
          then(resolve) {
            resolve({
              toolCalls: [],
              usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
              finishReason: 'stop',
            });
          },
        };

        const streamTextMock = t.mock.module('ai', {
          namedExports: {
            generateText: mock.fn(),
            streamText: mock.fn(args => {
              abortSignalUsed = args.abortSignal;
              return mockStreamResult;
            }),
          },
        });

        const { AgentRunner: MockedRunner } = await import(
          `../../../src/agent/agent-runner.js?s_onchunk=${Date.now()}`
        );

        const mockRunner = new MockedRunner(modelFactory, toolRegistry);

        // onChunk throws on the first chunk
        const failingOnChunk = () => {
          throw callbackError;
        };

        await assert.rejects(
          () => mockRunner.stream(createBotConfig(), createMessages(), failingOnChunk),
          err => {
            assert.equal(err.name, 'AgentRunnerError');
            assert.match(err.message, /Agent stream failed for bot "test-bot"/);
            assert.match(err.message, /onChunk processing failed/);
            return true;
          }
        );

        // Verify the abort signal was triggered
        assert.ok(abortSignalUsed, 'Should have passed abortSignal to streamText');
        assert.ok(abortSignalUsed.aborted, 'AbortSignal should be aborted after onChunk error');

        streamTextMock.restore();
      });

      test('passes abortSignal to streamText for timeout handling', async t => {
        let capturedArgs;

        async function* mockTextStream() {
          yield 'Hello';
        }

        const mockStreamResult = {
          textStream: mockTextStream(),
          then(resolve) {
            resolve({
              toolCalls: [],
              usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
              finishReason: 'stop',
            });
          },
        };

        const streamTextMock = t.mock.module('ai', {
          namedExports: {
            generateText: mock.fn(),
            streamText: mock.fn(args => {
              capturedArgs = args;
              return mockStreamResult;
            }),
          },
        });

        const { AgentRunner: MockedRunner } = await import(
          `../../../src/agent/agent-runner.js?s3=${Date.now()}`
        );

        const mockRunner = new MockedRunner(modelFactory, toolRegistry);
        await mockRunner.stream(createBotConfig({ timeout: 30000 }), createMessages(), () => {});

        assert.ok(capturedArgs.abortSignal, 'Should pass abortSignal to streamText');
        assert.ok(
          capturedArgs.abortSignal instanceof AbortSignal,
          'abortSignal should be an AbortSignal instance'
        );

        streamTextMock.restore();
      });

      test('times out on long-running stream', async t => {
        async function* slowTextStream() {
          yield 'start';
          // Simulate a long-running stream that never finishes
          await new Promise((_resolve, reject) => {
            // This will be rejected when the abort signal fires
            const check = setInterval(() => {
              // Check is just to keep the promise alive
            }, 100);
            setTimeout(() => {
              clearInterval(check);
              reject(new DOMException('The operation was aborted', 'AbortError'));
            }, 200);
          });
        }

        const mockStreamResult = {
          textStream: slowTextStream(),
          then(resolve) {
            resolve({
              toolCalls: [],
              usage: {},
              finishReason: 'stop',
            });
          },
        };

        const streamTextMock = t.mock.module('ai', {
          namedExports: {
            generateText: mock.fn(),
            streamText: mock.fn(() => mockStreamResult),
          },
        });

        const { AgentRunner: MockedRunner } = await import(
          `../../../src/agent/agent-runner.js?s4=${Date.now()}`
        );

        const mockRunner = new MockedRunner(modelFactory, toolRegistry);

        await assert.rejects(
          () => mockRunner.stream(createBotConfig({ timeout: 50 }), createMessages(), () => {}),
          err => {
            assert.equal(err.name, 'AgentRunnerError');
            assert.match(err.message, /Stream timed out after 50ms/);
            assert.equal(err.operation, 'stream');
            assert.equal(err.botId, 'test-bot');
            return true;
          }
        );

        streamTextMock.restore();
      });

      test('cleans up timeout timer on successful completion', async t => {
        const chunks = ['done'];

        async function* mockTextStream() {
          for (const chunk of chunks) {
            yield chunk;
          }
        }

        const mockStreamResult = {
          textStream: mockTextStream(),
          then(resolve) {
            resolve({
              toolCalls: [],
              usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
              finishReason: 'stop',
            });
          },
        };

        const streamTextMock = t.mock.module('ai', {
          namedExports: {
            generateText: mock.fn(),
            streamText: mock.fn(() => mockStreamResult),
          },
        });

        const { AgentRunner: MockedRunner } = await import(
          `../../../src/agent/agent-runner.js?s5=${Date.now()}`
        );

        const mockRunner = new MockedRunner(modelFactory, toolRegistry);

        // Should complete without timeout (timeout is long)
        const result = await mockRunner.stream(
          createBotConfig({ timeout: 60000 }),
          createMessages(),
          () => {}
        );

        assert.equal(result.text, 'done');
        assert.equal(result.finishReason, 'stop');

        streamTextMock.restore();
      });
    });
  });

  describe('_resolveConfig()', () => {
    test('resolves model, tools, and generateOptions', async () => {
      const config = createBotConfig({
        maxSteps: 15,
        temperature: 0.5,
        timeout: 60000,
      });

      const resolved = await runner._resolveConfig(config);

      assert.ok(resolved.model, 'Should have model');
      assert.ok(resolved.tools !== undefined, 'Should have tools');
      assert.equal(resolved.generateOptions.maxSteps, 15);
      assert.equal(resolved.generateOptions.temperature, 0.5);
      assert.equal(resolved.generateOptions.timeout, 60000);
    });

    test('uses default maxSteps when not in config', async () => {
      const config = createBotConfig();
      delete config.maxSteps;

      const resolved = await runner._resolveConfig(config);

      assert.equal(resolved.generateOptions.maxSteps, 30);
    });

    test('uses default timeout when not in config', async () => {
      const config = createBotConfig();

      const resolved = await runner._resolveConfig(config);

      assert.equal(resolved.generateOptions.timeout, 120_000);
    });

    test('preserves explicit maxSteps of 0 via nullish coalescing', async () => {
      const config = createBotConfig({ maxSteps: 0 });

      const resolved = await runner._resolveConfig(config);

      assert.equal(resolved.generateOptions.maxSteps, 0);
    });

    test('preserves explicit timeout of 0 via nullish coalescing', async () => {
      const config = createBotConfig({ timeout: 0 });

      const resolved = await runner._resolveConfig(config);

      assert.equal(resolved.generateOptions.timeout, 0);
    });

    test('passes apiKey to modelFactory when present', async () => {
      const config = createBotConfig({ apiKey: 'sk-test-123' });

      await runner._resolveConfig(config);

      const call = modelFactory.createModel.mock.calls[0];
      assert.equal(call.arguments[2], 'sk-test-123');
    });

    test('passes undefined apiKey when not in config', async () => {
      const config = createBotConfig();

      await runner._resolveConfig(config);

      const call = modelFactory.createModel.mock.calls[0];
      assert.equal(call.arguments[2], undefined);
    });
  });

  describe('AgentRunnerError', () => {
    test('extends Error with correct name', () => {
      const err = new AgentRunnerError('test error');

      assert.ok(err instanceof Error);
      assert.equal(err.name, 'AgentRunnerError');
      assert.equal(err.message, 'test error');
    });

    test('stores operation and botId metadata', () => {
      const err = new AgentRunnerError('fail', {
        operation: 'run',
        botId: 'support-bot',
      });

      assert.equal(err.operation, 'run');
      assert.equal(err.botId, 'support-bot');
    });

    test('stores cause for error chaining', () => {
      const original = new Error('original');
      const err = new AgentRunnerError('wrapped', { cause: original });

      assert.equal(err.cause, original);
    });

    test('defaults optional fields to undefined', () => {
      const err = new AgentRunnerError('test');

      assert.equal(err.operation, undefined);
      assert.equal(err.botId, undefined);
      assert.equal(err.cause, undefined);
    });
  });
});
