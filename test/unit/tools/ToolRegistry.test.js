/**
 * Unit tests for ToolRegistry
 *
 * Tests tool registration, bot-scoped tool retrieval, MCP integration,
 * input validation, and error handling.
 */

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry, ToolRegistryError } from '../../../src/tools/tool-registry.js';

/**
 * Create a mock ContainerPool
 * @returns {Object} Mock container pool
 */
function createMockContainerPool() {
  return {
    getContainer: async _botId => ({ id: 'mock-container' }),
    dockerManager: { exec: async () => ({ exitCode: 0, stdout: '', stderr: '' }) },
  };
}

/**
 * Create a mock McpManager
 * @param {Array} [tools=[]] - Tools to return from getToolsForBot
 * @returns {Object} Mock MCP manager
 */
function createMockMcpManager(tools = []) {
  return {
    getToolsForBot: async _botConfig => tools,
  };
}

/**
 * Create a simple tool factory for testing
 * @param {string} name - Tool name for identification
 * @returns {Function} Factory function
 */
function createMockToolFactory(name) {
  return (_containerPool, _botId, _config) => ({
    description: `Mock ${name} tool`,
    parameters: {},
    execute: async () => ({ success: true, tool: name }),
  });
}

/**
 * Create a tool factory that uses config
 * @returns {Function} Factory function
 */
function createConfigAwareFactory() {
  return (_containerPool, _botId, config) => ({
    description: 'Config-aware tool',
    parameters: {},
    config: config || {},
    execute: async () => ({ success: true }),
  });
}

describe('ToolRegistry', () => {
  let containerPool;
  let mcpManager;
  let registry;

  beforeEach(() => {
    containerPool = createMockContainerPool();
    mcpManager = createMockMcpManager();
    registry = new ToolRegistry(containerPool, mcpManager);
  });

  describe('constructor', () => {
    test('creates instance with containerPool and mcpManager', () => {
      const reg = new ToolRegistry(containerPool, mcpManager);

      assert.ok(reg instanceof ToolRegistry);
      assert.equal(reg.containerPool, containerPool);
      assert.equal(reg.mcpManager, mcpManager);
    });

    test('creates instance with containerPool only (mcpManager optional)', () => {
      const reg = new ToolRegistry(containerPool);

      assert.ok(reg instanceof ToolRegistry);
      assert.equal(reg.containerPool, containerPool);
      assert.equal(reg.mcpManager, null);
    });

    test('throws ToolRegistryError when containerPool is not provided', () => {
      assert.throws(
        () => new ToolRegistry(null),
        err => {
          assert.ok(err instanceof ToolRegistryError);
          assert.equal(err.name, 'ToolRegistryError');
          assert.match(err.message, /ContainerPool is required/);
          assert.equal(err.operation, 'constructor');
          return true;
        }
      );
    });

    test('throws ToolRegistryError when containerPool is undefined', () => {
      assert.throws(
        () => new ToolRegistry(undefined),
        err => {
          assert.ok(err instanceof ToolRegistryError);
          assert.match(err.message, /ContainerPool is required/);
          return true;
        }
      );
    });

    test('starts with empty builtinTools map', () => {
      const reg = new ToolRegistry(containerPool);

      assert.equal(reg.builtinTools.size, 0);
    });
  });

  describe('registerTool()', () => {
    test('registers a tool factory by name', () => {
      const factory = createMockToolFactory('bash');
      registry.registerTool('bash', factory);

      assert.equal(registry.hasTool('bash'), true);
    });

    test('registers multiple tools', () => {
      registry.registerTool('bash', createMockToolFactory('bash'));
      registry.registerTool('readFile', createMockToolFactory('readFile'));
      registry.registerTool('writeFile', createMockToolFactory('writeFile'));

      assert.equal(registry.builtinTools.size, 3);
      assert.equal(registry.hasTool('bash'), true);
      assert.equal(registry.hasTool('readFile'), true);
      assert.equal(registry.hasTool('writeFile'), true);
    });

    test('overwrites existing tool with same name', () => {
      const factory1 = createMockToolFactory('v1');
      const factory2 = createMockToolFactory('v2');

      registry.registerTool('bash', factory1);
      registry.registerTool('bash', factory2);

      assert.equal(registry.builtinTools.size, 1);
      assert.equal(registry.builtinTools.get('bash'), factory2);
    });

    test('throws on empty string name', () => {
      assert.throws(
        () => registry.registerTool('', createMockToolFactory('x')),
        err => {
          assert.ok(err instanceof ToolRegistryError);
          assert.match(err.message, /Tool name must be a non-empty string/);
          assert.equal(err.operation, 'registerTool');
          return true;
        }
      );
    });

    test('throws on null name', () => {
      assert.throws(
        () => registry.registerTool(null, createMockToolFactory('x')),
        err => {
          assert.ok(err instanceof ToolRegistryError);
          assert.match(err.message, /Tool name must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws on undefined name', () => {
      assert.throws(
        () => registry.registerTool(undefined, createMockToolFactory('x')),
        err => {
          assert.ok(err instanceof ToolRegistryError);
          assert.match(err.message, /Tool name must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws on non-string name (number)', () => {
      assert.throws(
        () => registry.registerTool(42, createMockToolFactory('x')),
        err => {
          assert.ok(err instanceof ToolRegistryError);
          assert.match(err.message, /Tool name must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws on non-function factory', () => {
      assert.throws(
        () => registry.registerTool('bash', 'not-a-function'),
        err => {
          assert.ok(err instanceof ToolRegistryError);
          assert.match(err.message, /Tool factory for "bash" must be a function/);
          assert.equal(err.operation, 'registerTool');
          assert.equal(err.toolName, 'bash');
          return true;
        }
      );
    });

    test('throws on null factory', () => {
      assert.throws(
        () => registry.registerTool('bash', null),
        err => {
          assert.ok(err instanceof ToolRegistryError);
          assert.match(err.message, /must be a function/);
          return true;
        }
      );
    });

    test('throws on object factory', () => {
      assert.throws(
        () => registry.registerTool('bash', {}),
        err => {
          assert.ok(err instanceof ToolRegistryError);
          assert.match(err.message, /must be a function/);
          return true;
        }
      );
    });
  });

  describe('hasTool()', () => {
    test('returns true for registered tools', () => {
      registry.registerTool('bash', createMockToolFactory('bash'));

      assert.equal(registry.hasTool('bash'), true);
    });

    test('returns false for unregistered tools', () => {
      assert.equal(registry.hasTool('bash'), false);
      assert.equal(registry.hasTool('unknown'), false);
    });

    test('returns false for undefined/null/empty', () => {
      assert.equal(registry.hasTool(undefined), false);
      assert.equal(registry.hasTool(null), false);
      assert.equal(registry.hasTool(''), false);
    });
  });

  describe('getRegisteredToolNames()', () => {
    test('returns empty array when no tools registered', () => {
      const names = registry.getRegisteredToolNames();

      assert.ok(Array.isArray(names));
      assert.equal(names.length, 0);
    });

    test('returns names of all registered tools', () => {
      registry.registerTool('bash', createMockToolFactory('bash'));
      registry.registerTool('readFile', createMockToolFactory('readFile'));
      registry.registerTool('writeFile', createMockToolFactory('writeFile'));

      const names = registry.getRegisteredToolNames();

      assert.equal(names.length, 3);
      assert.ok(names.includes('bash'));
      assert.ok(names.includes('readFile'));
      assert.ok(names.includes('writeFile'));
    });

    test('returns a defensive copy', () => {
      registry.registerTool('bash', createMockToolFactory('bash'));

      const first = registry.getRegisteredToolNames();
      const second = registry.getRegisteredToolNames();

      assert.notEqual(first, second);
      assert.deepEqual(first, second);

      first.push('mutated');
      const third = registry.getRegisteredToolNames();
      assert.equal(third.length, 1);
    });
  });

  describe('unregisterTool()', () => {
    test('removes a registered tool and returns true', () => {
      registry.registerTool('bash', createMockToolFactory('bash'));

      const result = registry.unregisterTool('bash');

      assert.equal(result, true);
      assert.equal(registry.hasTool('bash'), false);
    });

    test('returns false for non-existent tool', () => {
      const result = registry.unregisterTool('nonexistent');

      assert.equal(result, false);
    });

    test('only removes the specified tool', () => {
      registry.registerTool('bash', createMockToolFactory('bash'));
      registry.registerTool('readFile', createMockToolFactory('readFile'));

      registry.unregisterTool('bash');

      assert.equal(registry.hasTool('bash'), false);
      assert.equal(registry.hasTool('readFile'), true);
    });
  });

  describe('getToolsForBot()', () => {
    test('returns empty object when bot has no tools or mcpServers', async () => {
      const tools = await registry.getToolsForBot({ id: 'test-bot' });

      assert.deepEqual(tools, {});
    });

    test('returns empty object when tools array is empty', async () => {
      const tools = await registry.getToolsForBot({
        id: 'test-bot',
        tools: [],
        mcpServers: [],
      });

      assert.deepEqual(tools, {});
    });

    test('resolves registered built-in tools', async () => {
      registry.registerTool('bash', createMockToolFactory('bash'));
      registry.registerTool('readFile', createMockToolFactory('readFile'));

      const tools = await registry.getToolsForBot({
        id: 'support',
        tools: ['bash', 'readFile'],
      });

      assert.ok(tools.bash, 'Should have bash tool');
      assert.ok(tools.readFile, 'Should have readFile tool');
      assert.equal(tools.bash.description, 'Mock bash tool');
      assert.equal(tools.readFile.description, 'Mock readFile tool');
    });

    test('only includes tools listed in botConfig.tools', async () => {
      registry.registerTool('bash', createMockToolFactory('bash'));
      registry.registerTool('readFile', createMockToolFactory('readFile'));
      registry.registerTool('writeFile', createMockToolFactory('writeFile'));

      const tools = await registry.getToolsForBot({
        id: 'support',
        tools: ['bash'],
      });

      assert.ok(tools.bash, 'Should have bash');
      assert.equal(tools.readFile, undefined, 'Should not have readFile');
      assert.equal(tools.writeFile, undefined, 'Should not have writeFile');
    });

    test('silently skips unregistered tool names', async () => {
      registry.registerTool('bash', createMockToolFactory('bash'));

      const tools = await registry.getToolsForBot({
        id: 'support',
        tools: ['bash', 'nonexistent', 'alsoMissing'],
      });

      assert.ok(tools.bash, 'Should have bash');
      assert.equal(Object.keys(tools).length, 1, 'Should only have 1 tool');
    });

    test('handles tools array with null and undefined values', async () => {
      registry.registerTool('bash', createMockToolFactory('bash'));

      const tools = await registry.getToolsForBot({
        id: 'support',
        tools: ['bash', null, undefined, ''],
      });

      // Only bash should be present
      assert.ok(tools.bash);
      assert.equal(Object.keys(tools).length, 1);
    });

    test('handles toolConfig with nested objects', async () => {
      const factory = createConfigAwareFactory();
      registry.registerTool('advancedTool', factory);

      const complexConfig = {
        timeout: 5000,
        options: { retry: true, maxRetries: 3 },
        headers: { 'X-Custom': 'value' },
      };

      const tools = await registry.getToolsForBot({
        id: 'support',
        tools: ['advancedTool'],
        toolConfig: { advancedTool: complexConfig },
      });

      assert.deepEqual(tools.advancedTool.config, complexConfig);
    });

    test('passes toolConfig to factory function', async () => {
      const factory = createConfigAwareFactory();
      registry.registerTool('customTool', factory);

      const toolConfig = { timeout: 60000, maxOutputSize: 100000 };
      const tools = await registry.getToolsForBot({
        id: 'support',
        tools: ['customTool'],
        toolConfig: { customTool: toolConfig },
      });

      assert.deepEqual(tools.customTool.config, toolConfig);
    });

    test('passes undefined toolConfig when not specified', async () => {
      const factory = createConfigAwareFactory();
      registry.registerTool('customTool', factory);

      const tools = await registry.getToolsForBot({
        id: 'support',
        tools: ['customTool'],
      });

      assert.deepEqual(tools.customTool.config, {});
    });

    test('passes containerPool to factory function', async () => {
      let receivedPool;
      const factory = (pool, _botId, _config) => {
        receivedPool = pool;
        return { description: 'test', parameters: {}, execute: async () => ({}) };
      };
      registry.registerTool('testTool', factory);

      await registry.getToolsForBot({
        id: 'bot-1',
        tools: ['testTool'],
      });

      assert.equal(receivedPool, containerPool);
    });

    test('passes botId to factory function', async () => {
      let receivedBotId;
      const factory = (_pool, botId, _config) => {
        receivedBotId = botId;
        return { description: 'test', parameters: {}, execute: async () => ({}) };
      };
      registry.registerTool('testTool', factory);

      await registry.getToolsForBot({
        id: 'my-bot',
        tools: ['testTool'],
      });

      assert.equal(receivedBotId, 'my-bot');
    });

    describe('MCP tool integration', () => {
      test('includes MCP tools from mcpManager', async () => {
        const mcpTools = [
          {
            name: 'github__list_repos',
            description: 'List repositories',
            parameters: {},
            execute: async () => ({}),
          },
          {
            name: 'github__create_issue',
            description: 'Create an issue',
            parameters: {},
            execute: async () => ({}),
          },
        ];
        const reg = new ToolRegistry(containerPool, createMockMcpManager(mcpTools));

        const tools = await reg.getToolsForBot({
          id: 'support',
          mcpServers: ['github'],
        });

        assert.ok(tools['github__list_repos']);
        assert.ok(tools['github__create_issue']);
        assert.equal(tools['github__list_repos'].description, 'List repositories');
      });

      test('combines built-in and MCP tools', async () => {
        const mcpTools = [
          {
            name: 'notion__search',
            description: 'Search Notion',
            parameters: {},
            execute: async () => ({}),
          },
        ];
        const reg = new ToolRegistry(containerPool, createMockMcpManager(mcpTools));
        reg.registerTool('bash', createMockToolFactory('bash'));

        const tools = await reg.getToolsForBot({
          id: 'support',
          tools: ['bash'],
          mcpServers: ['notion'],
        });

        assert.ok(tools.bash, 'Should have bash');
        assert.ok(tools['notion__search'], 'Should have notion search');
        assert.equal(Object.keys(tools).length, 2);
      });

      test('skips MCP resolution when mcpManager is null', async () => {
        const reg = new ToolRegistry(containerPool, null);
        reg.registerTool('bash', createMockToolFactory('bash'));

        const tools = await reg.getToolsForBot({
          id: 'support',
          tools: ['bash'],
          mcpServers: ['github'],
        });

        assert.ok(tools.bash);
        assert.equal(Object.keys(tools).length, 1);
      });

      test('skips MCP resolution when mcpServers is empty', async () => {
        let mcpCalled = false;
        const mgr = {
          getToolsForBot: async () => {
            mcpCalled = true;
            return [];
          },
        };
        const reg = new ToolRegistry(containerPool, mgr);

        await reg.getToolsForBot({
          id: 'support',
          mcpServers: [],
        });

        assert.equal(mcpCalled, false, 'McpManager should not be called');
      });

      test('skips MCP resolution when mcpServers is undefined', async () => {
        let mcpCalled = false;
        const mgr = {
          getToolsForBot: async () => {
            mcpCalled = true;
            return [];
          },
        };
        const reg = new ToolRegistry(containerPool, mgr);

        await reg.getToolsForBot({ id: 'support' });

        assert.equal(mcpCalled, false, 'McpManager should not be called');
      });
    });

    describe('error handling', () => {
      test('throws on null botConfig', async () => {
        await assert.rejects(
          () => registry.getToolsForBot(null),
          err => {
            assert.ok(err instanceof ToolRegistryError);
            assert.match(err.message, /Bot config must be an object/);
            assert.equal(err.operation, 'getToolsForBot');
            return true;
          }
        );
      });

      test('throws on undefined botConfig', async () => {
        await assert.rejects(
          () => registry.getToolsForBot(undefined),
          err => {
            assert.ok(err instanceof ToolRegistryError);
            assert.match(err.message, /Bot config must be an object/);
            return true;
          }
        );
      });

      test('throws on non-object botConfig (string)', async () => {
        await assert.rejects(
          () => registry.getToolsForBot('not-an-object'),
          err => {
            assert.ok(err instanceof ToolRegistryError);
            assert.match(err.message, /Bot config must be an object/);
            return true;
          }
        );
      });

      test('throws when botConfig.id is missing', async () => {
        await assert.rejects(
          () => registry.getToolsForBot({ tools: ['bash'] }),
          err => {
            assert.ok(err instanceof ToolRegistryError);
            assert.match(err.message, /Bot config must have a string "id" property/);
            assert.equal(err.operation, 'getToolsForBot');
            return true;
          }
        );
      });

      test('throws when botConfig.id is empty string', async () => {
        await assert.rejects(
          () => registry.getToolsForBot({ id: '', tools: ['bash'] }),
          err => {
            assert.ok(err instanceof ToolRegistryError);
            assert.match(err.message, /Bot config must have a string "id" property/);
            return true;
          }
        );
      });

      test('throws when botConfig.id is not a string', async () => {
        await assert.rejects(
          () => registry.getToolsForBot({ id: 42 }),
          err => {
            assert.ok(err instanceof ToolRegistryError);
            assert.match(err.message, /Bot config must have a string "id" property/);
            return true;
          }
        );
      });

      test('wraps factory errors with context', async () => {
        const failingFactory = () => {
          throw new Error('factory exploded');
        };
        registry.registerTool('badTool', failingFactory);

        await assert.rejects(
          () => registry.getToolsForBot({ id: 'bot-1', tools: ['badTool'] }),
          err => {
            assert.ok(err instanceof ToolRegistryError);
            assert.match(err.message, /Failed to create tool "badTool" for bot "bot-1"/);
            assert.match(err.message, /factory exploded/);
            assert.equal(err.operation, 'getToolsForBot');
            assert.equal(err.toolName, 'badTool');
            assert.equal(err.botId, 'bot-1');
            assert.ok(err.cause instanceof Error);
            assert.equal(err.cause.message, 'factory exploded');
            return true;
          }
        );
      });

      test('wraps MCP errors with context', async () => {
        const failingMcpManager = {
          getToolsForBot: async () => {
            throw new Error('MCP connection failed');
          },
        };
        const reg = new ToolRegistry(containerPool, failingMcpManager);

        await assert.rejects(
          () => reg.getToolsForBot({ id: 'bot-1', mcpServers: ['github'] }),
          err => {
            assert.ok(err instanceof ToolRegistryError);
            assert.match(err.message, /Failed to get MCP tools for bot "bot-1"/);
            assert.match(err.message, /MCP connection failed/);
            assert.equal(err.operation, 'getToolsForBot');
            assert.equal(err.botId, 'bot-1');
            assert.ok(err.cause instanceof Error);
            return true;
          }
        );
      });

      test('handles MCP tools with duplicate names', async () => {
        const mcpTools = [
          { name: 'sharedTool', description: 'First', execute: async () => ({}) },
          { name: 'sharedTool', description: 'Second', execute: async () => ({}) },
        ];
        const reg = new ToolRegistry(containerPool, createMockMcpManager(mcpTools));

        const tools = await reg.getToolsForBot({
          id: 'support',
          mcpServers: ['github'],
        });

        // Last one wins
        assert.equal(tools.sharedTool.description, 'Second');
      });

      test('handles empty MCP tools array', async () => {
        const reg = new ToolRegistry(containerPool, createMockMcpManager([]));

        const tools = await reg.getToolsForBot({
          id: 'support',
          mcpServers: ['github'],
        });

        assert.deepEqual(tools, {});
      });
    });

    describe('event emission', () => {
      test('emits toolError event when factory fails', async () => {
        let emittedEvent = null;
        const mockEmitter = {
          emitToolError: (botId, details) => {
            emittedEvent = { botId, details };
          },
        };
        const reg = new ToolRegistry(containerPool, null, { eventEmitter: mockEmitter });

        const failingFactory = () => {
          throw new Error('factory failed');
        };
        reg.registerTool('badTool', failingFactory);

        await assert.rejects(() => reg.getToolsForBot({ id: 'bot-1', tools: ['badTool'] }));

        assert.ok(emittedEvent, 'Event should be emitted');
        assert.equal(emittedEvent.botId, 'bot-1');
        assert.equal(emittedEvent.details.toolName, 'badTool');
        assert.ok(emittedEvent.details.error instanceof Error);
      });

      test('emits toolError event when MCP fails', async () => {
        let emittedEvent = null;
        const mockEmitter = {
          emitToolError: (botId, details) => {
            emittedEvent = { botId, details };
          },
        };
        const failingMcp = {
          getToolsForBot: async () => {
            throw new Error('MCP failed');
          },
        };
        const reg = new ToolRegistry(containerPool, failingMcp, { eventEmitter: mockEmitter });

        await assert.rejects(() => reg.getToolsForBot({ id: 'bot-1', mcpServers: ['github'] }));

        assert.ok(emittedEvent, 'Event should be emitted');
        assert.equal(emittedEvent.botId, 'bot-1');
        assert.equal(emittedEvent.details.toolName, 'mcp');
        assert.ok(emittedEvent.details.error instanceof Error);
      });

      test('emits toolError event when skill tools fail', async () => {
        let emittedEvent = null;
        const mockEmitter = {
          emitToolError: (botId, details) => {
            emittedEvent = { botId, details };
          },
        };
        const failingSkillReg = {
          getSkillTools: () => {
            throw new Error('skill failed');
          },
        };
        const reg = new ToolRegistry(containerPool, null, {
          eventEmitter: mockEmitter,
          skillRegistry: failingSkillReg,
        });

        await assert.rejects(() => reg.getToolsForBot({ id: 'bot-1', skills: ['broken'] }));

        assert.ok(emittedEvent, 'Event should be emitted');
        assert.equal(emittedEvent.botId, 'bot-1');
        assert.equal(emittedEvent.details.toolName, 'skills');
        assert.ok(emittedEvent.details.error instanceof Error);
      });

      test('continues when eventEmitter throws during emission', async () => {
        const mockEmitter = {
          emitToolError: () => {
            throw new Error('emitter broken');
          },
        };
        const reg = new ToolRegistry(containerPool, null, { eventEmitter: mockEmitter });

        const failingFactory = () => {
          throw new Error('factory failed');
        };
        reg.registerTool('badTool', failingFactory);

        // Should still throw the factory error, not the emitter error
        await assert.rejects(
          () => reg.getToolsForBot({ id: 'bot-1', tools: ['badTool'] }),
          err => {
            assert.match(err.message, /Failed to create tool/);
            return true;
          }
        );
      });

      test('does not emit events when eventEmitter is null', async () => {
        const reg = new ToolRegistry(containerPool, null, { eventEmitter: null });

        const failingFactory = () => {
          throw new Error('factory failed');
        };
        reg.registerTool('badTool', failingFactory);

        // Should throw without attempting to emit
        await assert.rejects(() => reg.getToolsForBot({ id: 'bot-1', tools: ['badTool'] }));
      });

      test('does not emit when eventEmitter lacks the method', async () => {
        const mockEmitter = {}; // Missing emitToolError method
        const reg = new ToolRegistry(containerPool, null, { eventEmitter: mockEmitter });

        const failingFactory = () => {
          throw new Error('factory failed');
        };
        reg.registerTool('badTool', failingFactory);

        // Should throw without attempting to emit
        await assert.rejects(() => reg.getToolsForBot({ id: 'bot-1', tools: ['badTool'] }));
      });
    });
  });

  describe('skill tool integration', () => {
    /**
     * Create a mock SkillRegistry
     * @param {Object} [tools={}] - Tools to return from getSkillTools
     * @returns {Object} Mock skill registry
     */
    function createMockSkillRegistry(tools = {}) {
      return {
        getSkillTools: skillNames => {
          if (!Array.isArray(skillNames) || skillNames.length === 0) return {};
          return tools;
        },
        hasSkill: _name => true,
      };
    }

    test('includes skill tools from skillRegistry', async () => {
      const skillTools = {
        lintCode: { description: 'Lint code', execute: async () => ({}) },
        formatCode: { description: 'Format code', execute: async () => ({}) },
      };
      const reg = new ToolRegistry(containerPool, null, {
        skillRegistry: createMockSkillRegistry(skillTools),
      });

      const tools = await reg.getToolsForBot({
        id: 'support',
        skills: ['code-review'],
      });

      assert.ok(tools.lintCode);
      assert.ok(tools.formatCode);
      assert.equal(tools.lintCode.description, 'Lint code');
    });

    test('combines built-in and skill tools', async () => {
      const skillTools = {
        lintCode: { description: 'Lint code', execute: async () => ({}) },
      };
      const reg = new ToolRegistry(containerPool, null, {
        skillRegistry: createMockSkillRegistry(skillTools),
      });
      reg.registerTool('bash', createMockToolFactory('bash'));

      const tools = await reg.getToolsForBot({
        id: 'support',
        tools: ['bash'],
        skills: ['code-review'],
      });

      assert.ok(tools.bash, 'Should have bash');
      assert.ok(tools.lintCode, 'Should have lintCode from skill');
      assert.equal(Object.keys(tools).length, 2);
    });

    test('built-in tools take precedence over skill tools with same name', async () => {
      const skillTools = {
        bash: { description: 'Skill bash', execute: async () => ({}) },
      };
      const reg = new ToolRegistry(containerPool, null, {
        skillRegistry: createMockSkillRegistry(skillTools),
      });
      reg.registerTool('bash', createMockToolFactory('bash'));

      const tools = await reg.getToolsForBot({
        id: 'support',
        tools: ['bash'],
        skills: ['code-review'],
      });

      // Built-in bash should take precedence
      assert.equal(tools.bash.description, 'Mock bash tool');
    });

    test('MCP tools take precedence over skill tools with same name', async () => {
      const mcpTools = [
        {
          name: 'sharedTool',
          description: 'MCP version',
          execute: async () => ({}),
        },
      ];
      const skillTools = {
        sharedTool: { description: 'Skill version', execute: async () => ({}) },
      };
      const reg = new ToolRegistry(containerPool, createMockMcpManager(mcpTools), {
        skillRegistry: createMockSkillRegistry(skillTools),
      });

      const tools = await reg.getToolsForBot({
        id: 'support',
        mcpServers: ['github'],
        skills: ['code-review'],
      });

      assert.equal(tools.sharedTool.description, 'MCP version');
    });

    test('combines all three tool sources (builtin, MCP, skill)', async () => {
      const mcpTools = [
        { name: 'github__list_repos', description: 'MCP tool', execute: async () => ({}) },
      ];
      const skillTools = {
        lintCode: { description: 'Skill tool', execute: async () => ({}) },
      };
      const reg = new ToolRegistry(containerPool, createMockMcpManager(mcpTools), {
        skillRegistry: createMockSkillRegistry(skillTools),
      });
      reg.registerTool('bash', createMockToolFactory('bash'));

      const tools = await reg.getToolsForBot({
        id: 'support',
        tools: ['bash'],
        mcpServers: ['github'],
        skills: ['code-review'],
      });

      assert.ok(tools.bash, 'Should have builtin tool');
      assert.ok(tools['github__list_repos'], 'Should have MCP tool');
      assert.ok(tools.lintCode, 'Should have skill tool');
      assert.equal(Object.keys(tools).length, 3);
    });

    test('precedence: MCP > builtin > skill (all three have same name)', async () => {
      const mcpTools = [
        { name: 'conflictTool', description: 'MCP version', execute: async () => ({}) },
      ];
      const skillTools = {
        conflictTool: { description: 'Skill version', execute: async () => ({}) },
      };
      const reg = new ToolRegistry(containerPool, createMockMcpManager(mcpTools), {
        skillRegistry: createMockSkillRegistry(skillTools),
      });
      reg.registerTool('conflictTool', createMockToolFactory('builtin'));

      const tools = await reg.getToolsForBot({
        id: 'support',
        tools: ['conflictTool'],
        mcpServers: ['mcp-server'],
        skills: ['code-review'],
      });

      // MCP should win (overwrites builtin, which overwrites skill)
      assert.equal(tools.conflictTool.description, 'MCP version');
    });

    test('skips skill resolution when skillRegistry is null', async () => {
      const reg = new ToolRegistry(containerPool, null);
      reg.registerTool('bash', createMockToolFactory('bash'));

      const tools = await reg.getToolsForBot({
        id: 'support',
        tools: ['bash'],
        skills: ['code-review'],
      });

      assert.ok(tools.bash);
      assert.equal(Object.keys(tools).length, 1);
    });

    test('skips skill resolution when skills array is empty', async () => {
      let skillsCalled = false;
      const reg = new ToolRegistry(containerPool, null, {
        skillRegistry: {
          getSkillTools: () => {
            skillsCalled = true;
            return {};
          },
        },
      });

      await reg.getToolsForBot({
        id: 'support',
        skills: [],
      });

      assert.equal(skillsCalled, false, 'getSkillTools should not be called');
    });

    test('skips skill resolution when skills is undefined', async () => {
      let skillsCalled = false;
      const reg = new ToolRegistry(containerPool, null, {
        skillRegistry: {
          getSkillTools: () => {
            skillsCalled = true;
            return {};
          },
        },
      });

      await reg.getToolsForBot({ id: 'support' });

      assert.equal(skillsCalled, false, 'getSkillTools should not be called');
    });

    test('wraps skill tool errors with context', async () => {
      const reg = new ToolRegistry(containerPool, null, {
        skillRegistry: {
          getSkillTools: () => {
            throw new Error('skill loading failed');
          },
        },
      });

      await assert.rejects(
        () => reg.getToolsForBot({ id: 'bot-1', skills: ['broken-skill'] }),
        err => {
          assert.ok(err instanceof ToolRegistryError);
          assert.match(err.message, /Failed to get skill tools for bot "bot-1"/);
          assert.match(err.message, /skill loading failed/);
          assert.equal(err.operation, 'getToolsForBot');
          assert.equal(err.botId, 'bot-1');
          assert.ok(err.cause instanceof Error);
          return true;
        }
      );
    });
  });

  describe('constructor with options', () => {
    test('accepts skillRegistry via options', () => {
      const mockSkillReg = { getSkillTools: () => ({}) };
      const reg = new ToolRegistry(containerPool, null, { skillRegistry: mockSkillReg });

      assert.equal(reg.skillRegistry, mockSkillReg);
    });

    test('defaults skillRegistry to null when not provided', () => {
      const reg = new ToolRegistry(containerPool);

      assert.equal(reg.skillRegistry, null);
    });

    test('accepts empty options object', () => {
      const reg = new ToolRegistry(containerPool, null, {});

      assert.equal(reg.skillRegistry, null);
    });

    test('accepts eventEmitter via options', () => {
      const mockEmitter = { emitToolError: () => {} };
      const reg = new ToolRegistry(containerPool, null, { eventEmitter: mockEmitter });

      assert.equal(reg.eventEmitter, mockEmitter);
    });

    test('defaults eventEmitter to null when not provided', () => {
      const reg = new ToolRegistry(containerPool);

      assert.equal(reg.eventEmitter, null);
    });
  });

  describe('getBuiltinToolNames() (static)', () => {
    test('returns array of known built-in tool names', () => {
      const names = ToolRegistry.getBuiltinToolNames();

      assert.ok(Array.isArray(names));
      assert.ok(names.length > 0);
      assert.ok(names.includes('bash'));
      assert.ok(names.includes('readFile'));
      assert.ok(names.includes('writeFile'));
      assert.ok(names.includes('glob'));
      assert.ok(names.includes('grep'));
      assert.ok(names.includes('webSearch'));
      assert.ok(names.includes('webFetch'));
    });

    test('returns 7 known tool names', () => {
      const names = ToolRegistry.getBuiltinToolNames();
      assert.equal(names.length, 7);
    });

    test('returns a defensive copy', () => {
      const first = ToolRegistry.getBuiltinToolNames();
      const second = ToolRegistry.getBuiltinToolNames();

      assert.notEqual(first, second);
      assert.deepEqual(first, second);

      first.push('custom');
      const third = ToolRegistry.getBuiltinToolNames();
      assert.equal(third.length, 7);
    });
  });

  describe('ToolRegistryError', () => {
    test('extends Error with correct name', () => {
      const err = new ToolRegistryError('test error');

      assert.ok(err instanceof Error);
      assert.equal(err.name, 'ToolRegistryError');
      assert.equal(err.message, 'test error');
    });

    test('stores operation, toolName, and botId metadata', () => {
      const err = new ToolRegistryError('fail', {
        operation: 'getToolsForBot',
        toolName: 'bash',
        botId: 'support',
      });

      assert.equal(err.operation, 'getToolsForBot');
      assert.equal(err.toolName, 'bash');
      assert.equal(err.botId, 'support');
    });

    test('stores cause for error chaining', () => {
      const original = new Error('original');
      const err = new ToolRegistryError('wrapped', { cause: original });

      assert.equal(err.cause, original);
    });

    test('cause property is properly set via Error constructor', () => {
      const rootCause = new TypeError('root cause error');
      const err = new ToolRegistryError('wrapper error', { cause: rootCause });

      // Verify cause is accessible via standard Error API
      assert.ok(err.cause instanceof TypeError);
      assert.equal(err.cause.message, 'root cause error');
      assert.equal(err.cause, rootCause);
    });

    test('cause property works with non-Error objects', () => {
      const causeObj = { code: 'ECONNREFUSED', details: 'Connection refused' };
      const err = new ToolRegistryError('connection failed', { cause: causeObj });

      assert.deepEqual(err.cause, causeObj);
    });

    test('defaults optional fields to undefined', () => {
      const err = new ToolRegistryError('test');

      assert.equal(err.operation, undefined);
      assert.equal(err.toolName, undefined);
      assert.equal(err.botId, undefined);
      assert.equal(err.cause, undefined);
    });

    test('stack trace includes error name and message', () => {
      const err = new ToolRegistryError('test error');

      assert.ok(err.stack);
      assert.match(err.stack, /ToolRegistryError: test error/);
    });
  });
});
