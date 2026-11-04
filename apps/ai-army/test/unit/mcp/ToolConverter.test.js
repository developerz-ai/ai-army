/**
 * Unit tests for MCP Tool Converter
 *
 * Tests JSON Schema to Zod conversion, MCP tool to Vercel AI SDK tool
 * conversion, result parsing, error handling, and the batch conversion
 * helpers. Uses mock MCPClient objects to avoid real server connections.
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
// zod is used transitively by the tool-converter module under test
import {
  ToolConverterError,
  jsonSchemaToZod,
  convertMCPToolToAITool,
  convertMCPToolsToAITools,
  convertMCPToolsToToolMap,
} from '../../../src/mcp/tool-converter.js';

/**
 * Create a mock MCPClient with a callTool method
 * @param {Object} [overrides={}] - Override default mock implementations
 * @returns {Object} Mock MCPClient instance
 */
function createMockMcpClient(overrides = {}) {
  return {
    callTool:
      overrides.callTool ||
      mock.fn(async () => ({
        content: [{ type: 'text', text: 'Tool result' }],
      })),
  };
}

/**
 * Create a sample MCP tool definition
 * @param {Object} [overrides={}] - Override default values
 * @returns {Object} MCP tool definition
 */
function createMockMcpTool(overrides = {}) {
  return {
    name: 'list_repos',
    description: 'List GitHub repositories',
    inputSchema: {
      type: 'object',
      properties: {
        org: { type: 'string', description: 'Organization name' },
        limit: { type: 'number', description: 'Max results' },
      },
      required: ['org'],
    },
    ...overrides,
  };
}

// ==========================================================================
// jsonSchemaToZod
// ==========================================================================

describe('jsonSchemaToZod', () => {
  describe('string type', () => {
    test('converts string type', () => {
      const schema = jsonSchemaToZod({ type: 'string' });
      const result = schema.safeParse('hello');

      assert.equal(result.success, true);
      assert.equal(result.data, 'hello');
    });

    test('rejects non-string for string type', () => {
      const schema = jsonSchemaToZod({ type: 'string' });
      const result = schema.safeParse(42);

      assert.equal(result.success, false);
    });

    test('converts string with enum', () => {
      const schema = jsonSchemaToZod({
        type: 'string',
        enum: ['low', 'medium', 'high'],
      });

      assert.equal(schema.safeParse('low').success, true);
      assert.equal(schema.safeParse('medium').success, true);
      assert.equal(schema.safeParse('invalid').success, false);
    });

    test('applies description to string type', () => {
      const schema = jsonSchemaToZod({
        type: 'string',
        description: 'A test string',
      });

      assert.equal(schema.description, 'A test string');
    });
  });

  describe('number type', () => {
    test('converts number type', () => {
      const schema = jsonSchemaToZod({ type: 'number' });

      assert.equal(schema.safeParse(42).success, true);
      assert.equal(schema.safeParse(3.14).success, true);
      assert.equal(schema.safeParse('not a number').success, false);
    });
  });

  describe('integer type', () => {
    test('converts integer type', () => {
      const schema = jsonSchemaToZod({ type: 'integer' });

      assert.equal(schema.safeParse(42).success, true);
      assert.equal(schema.safeParse(3.14).success, false);
    });
  });

  describe('boolean type', () => {
    test('converts boolean type', () => {
      const schema = jsonSchemaToZod({ type: 'boolean' });

      assert.equal(schema.safeParse(true).success, true);
      assert.equal(schema.safeParse(false).success, true);
      assert.equal(schema.safeParse('true').success, false);
    });
  });

  describe('null type', () => {
    test('converts null type', () => {
      const schema = jsonSchemaToZod({ type: 'null' });

      assert.equal(schema.safeParse(null).success, true);
      assert.equal(schema.safeParse('not null').success, false);
    });
  });

  describe('array type', () => {
    test('converts array of strings', () => {
      const schema = jsonSchemaToZod({
        type: 'array',
        items: { type: 'string' },
      });

      assert.equal(schema.safeParse(['a', 'b']).success, true);
      assert.equal(schema.safeParse([1, 2]).success, false);
    });

    test('converts array without items (unknown items)', () => {
      const schema = jsonSchemaToZod({ type: 'array' });

      assert.equal(schema.safeParse([1, 'a', true]).success, true);
      assert.equal(schema.safeParse('not array').success, false);
    });

    test('converts nested arrays', () => {
      const schema = jsonSchemaToZod({
        type: 'array',
        items: {
          type: 'array',
          items: { type: 'number' },
        },
      });

      assert.equal(schema.safeParse([[1, 2], [3]]).success, true);
      assert.equal(schema.safeParse([['a']]).success, false);
    });
  });

  describe('object type', () => {
    test('converts object with required and optional properties', () => {
      const schema = jsonSchemaToZod({
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name'],
      });

      assert.equal(schema.safeParse({ name: 'Alice', age: 30 }).success, true);
      assert.equal(schema.safeParse({ name: 'Bob' }).success, true);
      assert.equal(schema.safeParse({ age: 30 }).success, false);
    });

    test('converts object without properties', () => {
      const schema = jsonSchemaToZod({ type: 'object' });

      assert.equal(schema.safeParse({}).success, true);
    });

    test('converts object without required array', () => {
      const schema = jsonSchemaToZod({
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
      });

      // All properties should be optional when no required array
      assert.equal(schema.safeParse({}).success, true);
      assert.equal(schema.safeParse({ name: 'Alice' }).success, true);
    });

    test('converts nested objects', () => {
      const schema = jsonSchemaToZod({
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              email: { type: 'string' },
            },
            required: ['name'],
          },
        },
        required: ['user'],
      });

      assert.equal(schema.safeParse({ user: { name: 'Alice' } }).success, true);
      assert.equal(schema.safeParse({ user: { email: 'a@b.com' } }).success, false);
    });
  });

  describe('anyOf / oneOf', () => {
    test('converts anyOf to z.union', () => {
      const schema = jsonSchemaToZod({
        anyOf: [{ type: 'string' }, { type: 'number' }],
      });

      assert.equal(schema.safeParse('hello').success, true);
      assert.equal(schema.safeParse(42).success, true);
      assert.equal(schema.safeParse(true).success, false);
    });

    test('converts oneOf to z.union', () => {
      const schema = jsonSchemaToZod({
        oneOf: [{ type: 'string' }, { type: 'boolean' }],
      });

      assert.equal(schema.safeParse('hello').success, true);
      assert.equal(schema.safeParse(true).success, true);
      assert.equal(schema.safeParse(42).success, false);
    });

    test('handles single-item anyOf', () => {
      const schema = jsonSchemaToZod({
        anyOf: [{ type: 'string' }],
      });

      assert.equal(schema.safeParse('hello').success, true);
      assert.equal(schema.safeParse(42).success, false);
    });
  });

  describe('edge cases', () => {
    test('returns z.unknown() for null input', () => {
      const schema = jsonSchemaToZod(null);

      assert.equal(schema.safeParse('anything').success, true);
      assert.equal(schema.safeParse(42).success, true);
    });

    test('returns z.unknown() for undefined input', () => {
      const schema = jsonSchemaToZod(undefined);

      assert.equal(schema.safeParse('anything').success, true);
    });

    test('returns z.unknown() for non-object input', () => {
      const schema = jsonSchemaToZod('string');

      assert.equal(schema.safeParse(42).success, true);
    });

    test('returns z.unknown() for unknown type', () => {
      const schema = jsonSchemaToZod({ type: 'custom_type' });

      assert.equal(schema.safeParse('anything').success, true);
    });

    test('treats schema with properties but no type as object', () => {
      const schema = jsonSchemaToZod({
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      });

      assert.equal(schema.safeParse({ name: 'Alice' }).success, true);
      assert.equal(schema.safeParse({}).success, false);
    });
  });
});

// ==========================================================================
// convertMCPToolToAITool
// ==========================================================================

describe('convertMCPToolToAITool', () => {
  let mcpClient;

  beforeEach(() => {
    mcpClient = createMockMcpClient();
  });

  describe('validation', () => {
    test('throws when mcpTool is null', () => {
      assert.throws(
        () => convertMCPToolToAITool(null, 'github', mcpClient),
        err => {
          assert.equal(err.name, 'ToolConverterError');
          assert.match(err.message, /non-null object/);
          assert.equal(err.operation, 'convertMCPToolToAITool');
          return true;
        }
      );
    });

    test('throws when mcpTool is not an object', () => {
      assert.throws(
        () => convertMCPToolToAITool('invalid', 'github', mcpClient),
        err => {
          assert.equal(err.name, 'ToolConverterError');
          assert.match(err.message, /non-null object/);
          return true;
        }
      );
    });

    test('throws when mcpTool.name is missing', () => {
      assert.throws(
        () => convertMCPToolToAITool({}, 'github', mcpClient),
        err => {
          assert.equal(err.name, 'ToolConverterError');
          assert.match(err.message, /non-empty string "name"/);
          return true;
        }
      );
    });

    test('throws when mcpTool.name is empty', () => {
      assert.throws(
        () => convertMCPToolToAITool({ name: '' }, 'github', mcpClient),
        err => {
          assert.equal(err.name, 'ToolConverterError');
          assert.match(err.message, /non-empty string "name"/);
          return true;
        }
      );
    });

    test('throws when serverId is missing', () => {
      assert.throws(
        () => convertMCPToolToAITool(createMockMcpTool(), '', mcpClient),
        err => {
          assert.equal(err.name, 'ToolConverterError');
          assert.match(err.message, /Server ID must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws when serverId is null', () => {
      assert.throws(
        () => convertMCPToolToAITool(createMockMcpTool(), null, mcpClient),
        err => {
          assert.equal(err.name, 'ToolConverterError');
          assert.match(err.message, /Server ID must be a non-empty string/);
          return true;
        }
      );
    });

    test('throws when mcpClient is null', () => {
      assert.throws(
        () => convertMCPToolToAITool(createMockMcpTool(), 'github', null),
        err => {
          assert.equal(err.name, 'ToolConverterError');
          assert.match(err.message, /callTool\(\) method/);
          return true;
        }
      );
    });

    test('throws when mcpClient lacks callTool', () => {
      assert.throws(
        () => convertMCPToolToAITool(createMockMcpTool(), 'github', {}),
        err => {
          assert.equal(err.name, 'ToolConverterError');
          assert.match(err.message, /callTool\(\) method/);
          return true;
        }
      );
    });
  });

  describe('tool naming', () => {
    test('namespaces tool name as serverId__toolName', () => {
      const result = convertMCPToolToAITool(createMockMcpTool(), 'github', mcpClient);

      assert.equal(result.name, 'github__list_repos');
    });

    test('uses different server IDs for different namespaces', () => {
      const result1 = convertMCPToolToAITool(createMockMcpTool(), 'github', mcpClient);
      const result2 = convertMCPToolToAITool(createMockMcpTool(), 'gitlab', mcpClient);

      assert.equal(result1.name, 'github__list_repos');
      assert.equal(result2.name, 'gitlab__list_repos');
    });
  });

  describe('description', () => {
    test('uses tool description from MCP tool', () => {
      const result = convertMCPToolToAITool(createMockMcpTool(), 'github', mcpClient);

      assert.equal(result.tool.description, 'List GitHub repositories');
    });

    test('falls back to default description when description is empty', () => {
      const mcpTool = createMockMcpTool({ description: '' });
      const result = convertMCPToolToAITool(mcpTool, 'github', mcpClient);

      assert.equal(result.tool.description, 'MCP tool: list_repos');
    });

    test('falls back to default description when description is undefined', () => {
      const mcpTool = createMockMcpTool({ description: undefined });
      const result = convertMCPToolToAITool(mcpTool, 'github', mcpClient);

      assert.equal(result.tool.description, 'MCP tool: list_repos');
    });
  });

  describe('parameters conversion', () => {
    test('converts inputSchema to Zod parameters', () => {
      const result = convertMCPToolToAITool(createMockMcpTool(), 'github', mcpClient);

      // Validate the parameters accept correct input
      const parseResult = result.tool.parameters.safeParse({ org: 'anthropic' });
      assert.equal(parseResult.success, true);
    });

    test('rejects invalid parameters per schema', () => {
      const result = convertMCPToolToAITool(createMockMcpTool(), 'github', mcpClient);

      // Missing required 'org' field
      const parseResult = result.tool.parameters.safeParse({ limit: 10 });
      assert.equal(parseResult.success, false);
    });

    test('handles tool with no inputSchema', () => {
      const mcpTool = createMockMcpTool({ inputSchema: undefined });
      const result = convertMCPToolToAITool(mcpTool, 'github', mcpClient);

      // Should accept empty object
      const parseResult = result.tool.parameters.safeParse({});
      assert.equal(parseResult.success, true);
    });
  });

  describe('execute()', () => {
    test('calls MCPClient.callTool with correct tool name and params', async () => {
      const result = convertMCPToolToAITool(createMockMcpTool(), 'github', mcpClient);
      const params = { org: 'anthropic', limit: 5 };

      await result.tool.execute(params);

      assert.equal(mcpClient.callTool.mock.calls.length, 1);
      const [toolName, toolParams] = mcpClient.callTool.mock.calls[0].arguments;
      assert.equal(toolName, 'list_repos');
      assert.deepEqual(toolParams, params);
    });

    test('uses original tool name (not namespaced) for MCP call', async () => {
      const result = convertMCPToolToAITool(createMockMcpTool(), 'github', mcpClient);

      await result.tool.execute({ org: 'anthropic' });

      const [toolName] = mcpClient.callTool.mock.calls[0].arguments;
      assert.equal(toolName, 'list_repos');
    });

    test('returns parsed text content from MCP result', async () => {
      mcpClient = createMockMcpClient({
        callTool: mock.fn(async () => ({
          content: [
            { type: 'text', text: 'repo1' },
            { type: 'text', text: 'repo2' },
          ],
        })),
      });

      const result = convertMCPToolToAITool(createMockMcpTool(), 'github', mcpClient);
      const output = await result.tool.execute({ org: 'anthropic' });

      assert.equal(output.content, 'repo1\nrepo2');
      assert.equal(output.error, undefined);
    });

    test('returns error result when MCP call fails', async () => {
      mcpClient = createMockMcpClient({
        callTool: mock.fn(async () => {
          throw new Error('Connection lost');
        }),
      });

      const result = convertMCPToolToAITool(createMockMcpTool(), 'github', mcpClient);
      const output = await result.tool.execute({ org: 'anthropic' });

      assert.equal(output.error, true);
      assert.match(output.content, /Connection lost/);
    });

    test('returns error result when MCP result has isError', async () => {
      mcpClient = createMockMcpClient({
        callTool: mock.fn(async () => ({
          content: [{ type: 'text', text: 'Not found' }],
          isError: true,
        })),
      });

      const result = convertMCPToolToAITool(createMockMcpTool(), 'github', mcpClient);
      const output = await result.tool.execute({ org: 'anthropic' });

      assert.equal(output.error, true);
      assert.equal(output.content, 'Not found');
    });

    test('handles empty content array', async () => {
      mcpClient = createMockMcpClient({
        callTool: mock.fn(async () => ({
          content: [],
        })),
      });

      const result = convertMCPToolToAITool(createMockMcpTool(), 'github', mcpClient);
      const output = await result.tool.execute({ org: 'anthropic' });

      assert.equal(output.content, '');
    });

    test('handles non-text content types', async () => {
      mcpClient = createMockMcpClient({
        callTool: mock.fn(async () => ({
          content: [
            { type: 'image', data: 'base64data' },
            { type: 'text', text: 'Caption' },
          ],
        })),
      });

      const result = convertMCPToolToAITool(createMockMcpTool(), 'github', mcpClient);
      const output = await result.tool.execute({ org: 'anthropic' });

      assert.equal(output.content, 'Caption');
    });

    test('handles null result from callTool', async () => {
      mcpClient = createMockMcpClient({
        callTool: mock.fn(async () => null),
      });

      const result = convertMCPToolToAITool(createMockMcpTool(), 'github', mcpClient);
      const output = await result.tool.execute({ org: 'anthropic' });

      assert.equal(output.content, '');
    });
  });
});

// ==========================================================================
// convertMCPToolsToAITools
// ==========================================================================

describe('convertMCPToolsToAITools', () => {
  let mcpClient;

  beforeEach(() => {
    mcpClient = createMockMcpClient();
  });

  test('converts multiple MCP tools', () => {
    const mcpTools = [
      createMockMcpTool({ name: 'list_repos', description: 'List repos' }),
      createMockMcpTool({ name: 'create_issue', description: 'Create issue' }),
    ];

    const result = convertMCPToolsToAITools(mcpTools, 'github', mcpClient);

    assert.equal(result.length, 2);
    assert.equal(result[0].name, 'github__list_repos');
    assert.equal(result[1].name, 'github__create_issue');
  });

  test('returns empty array for empty tools list', () => {
    const result = convertMCPToolsToAITools([], 'github', mcpClient);

    assert.deepEqual(result, []);
  });

  test('throws when mcpTools is not an array', () => {
    assert.throws(
      () => convertMCPToolsToAITools('not-array', 'github', mcpClient),
      err => {
        assert.equal(err.name, 'ToolConverterError');
        assert.match(err.message, /must be an array/);
        return true;
      }
    );
  });

  test('throws when serverId is empty', () => {
    assert.throws(
      () => convertMCPToolsToAITools([], '', mcpClient),
      err => {
        assert.equal(err.name, 'ToolConverterError');
        assert.match(err.message, /Server ID/);
        return true;
      }
    );
  });

  test('throws when mcpClient lacks callTool', () => {
    assert.throws(
      () => convertMCPToolsToAITools([], 'github', {}),
      err => {
        assert.equal(err.name, 'ToolConverterError');
        assert.match(err.message, /callTool/);
        return true;
      }
    );
  });

  test('each converted tool has name and tool properties', () => {
    const mcpTools = [createMockMcpTool()];
    const result = convertMCPToolsToAITools(mcpTools, 'github', mcpClient);

    assert.ok(result[0].name);
    assert.ok(result[0].tool);
    assert.ok(result[0].tool.description);
    assert.ok(result[0].tool.parameters);
    assert.equal(typeof result[0].tool.execute, 'function');
  });
});

// ==========================================================================
// convertMCPToolsToToolMap
// ==========================================================================

describe('convertMCPToolsToToolMap', () => {
  let mcpClient;

  beforeEach(() => {
    mcpClient = createMockMcpClient();
  });

  test('returns object keyed by namespaced tool name', () => {
    const mcpTools = [
      createMockMcpTool({ name: 'list_repos' }),
      createMockMcpTool({ name: 'create_issue' }),
    ];

    const result = convertMCPToolsToToolMap(mcpTools, 'github', mcpClient);

    assert.ok(result['github__list_repos']);
    assert.ok(result['github__create_issue']);
    assert.equal(Object.keys(result).length, 2);
  });

  test('returns empty object for empty tools list', () => {
    const result = convertMCPToolsToToolMap([], 'github', mcpClient);

    assert.deepEqual(result, {});
  });

  test('tool values are Vercel AI SDK tool objects', () => {
    const mcpTools = [createMockMcpTool()];
    const result = convertMCPToolsToToolMap(mcpTools, 'github', mcpClient);
    const toolObj = result['github__list_repos'];

    assert.ok(toolObj.description);
    assert.ok(toolObj.parameters);
    assert.equal(typeof toolObj.execute, 'function');
  });

  test('tool execute routes to MCPClient.callTool', async () => {
    const mcpTools = [createMockMcpTool()];
    const result = convertMCPToolsToToolMap(mcpTools, 'github', mcpClient);
    const toolObj = result['github__list_repos'];

    await toolObj.execute({ org: 'anthropic' });

    assert.equal(mcpClient.callTool.mock.calls.length, 1);
    const [toolName] = mcpClient.callTool.mock.calls[0].arguments;
    assert.equal(toolName, 'list_repos');
  });
});

// ==========================================================================
// ToolConverterError
// ==========================================================================

describe('ToolConverterError', () => {
  test('is an instance of Error', () => {
    const error = new ToolConverterError('Test error');
    assert.ok(error instanceof Error);
  });

  test('has correct name', () => {
    const error = new ToolConverterError('Test error');
    assert.equal(error.name, 'ToolConverterError');
  });

  test('stores message', () => {
    const error = new ToolConverterError('Something went wrong');
    assert.equal(error.message, 'Something went wrong');
  });

  test('stores operation', () => {
    const error = new ToolConverterError('Test', { operation: 'convertSchema' });
    assert.equal(error.operation, 'convertSchema');
  });

  test('stores toolName', () => {
    const error = new ToolConverterError('Test', { toolName: 'list_repos' });
    assert.equal(error.toolName, 'list_repos');
  });

  test('stores serverId', () => {
    const error = new ToolConverterError('Test', { serverId: 'github' });
    assert.equal(error.serverId, 'github');
  });

  test('stores cause', () => {
    const cause = new Error('Original error');
    const error = new ToolConverterError('Test', { cause });
    assert.equal(error.cause, cause);
  });

  test('stores all options together', () => {
    const cause = new Error('Original');
    const error = new ToolConverterError('Multi-option error', {
      cause,
      operation: 'convertSchema',
      toolName: 'list_repos',
      serverId: 'github',
    });

    assert.equal(error.cause, cause);
    assert.equal(error.operation, 'convertSchema');
    assert.equal(error.toolName, 'list_repos');
    assert.equal(error.serverId, 'github');
  });

  test('defaults optional fields to undefined', () => {
    const error = new ToolConverterError('Test');
    assert.equal(error.operation, undefined);
    assert.equal(error.toolName, undefined);
    assert.equal(error.serverId, undefined);
    assert.equal(error.cause, undefined);
  });
});
