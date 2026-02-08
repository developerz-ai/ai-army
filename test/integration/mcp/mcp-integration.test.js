/**
 * Integration tests for MCP (Model Context Protocol) components
 *
 * Tests the full MCP workflow with realistic scenarios:
 * - Starting MCP servers with stdio transport
 * - Connecting clients to servers
 * - Discovering and listing tools from servers
 * - Calling tools with parameters
 * - Converting MCP tools to Vercel AI SDK format
 * - Handling server crashes and restarts
 * - Managing multiple servers concurrently
 *
 * Uses mock transport and client to avoid spawning real child processes
 * while testing realistic interaction patterns between MCPManager, MCPClient,
 * and ToolConverter.
 *
 * Run with: npm run test:integration
 */

import { describe, test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { MCPManager } from '../../../src/mcp/mcp-manager.js';
import { MCPClient } from '../../../src/mcp/mcp-client.js';
import {
  convertMCPToolsToAITools,
  convertMCPToolsToToolMap,
} from '../../../src/mcp/tool-converter.js';

// ============================================================================
// Mock Factories
// ============================================================================

/**
 * Create a mock MCP SDK Client
 * @param {Object} [overrides={}] - Override default mock implementations
 * @returns {Object} Mock client instance
 */
function createMockSdkClient(overrides = {}) {
  return {
    connect: overrides.connect || mock.fn(async () => {}),
    close: overrides.close || mock.fn(async () => {}),
    listTools:
      overrides.listTools ||
      mock.fn(async () => ({
        tools: [
          {
            name: 'list_allowed_directories',
            description: 'List allowed directories',
            inputSchema: { type: 'object', properties: {}, required: [] },
          },
          {
            name: 'read_file',
            description: 'Read a file from the filesystem',
            inputSchema: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path'],
            },
          },
          {
            name: 'write_file',
            description: 'Write content to a file',
            inputSchema: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                content: { type: 'string' },
              },
              required: ['path', 'content'],
            },
          },
        ],
      })),
    callTool:
      overrides.callTool ||
      mock.fn(async toolRequest => {
        // toolRequest is { name: string, arguments: object }
        const toolName = toolRequest?.name || toolRequest;
        if (toolName === 'read_file') {
          return {
            content: [{ type: 'text', text: 'File content from MCP server' }],
          };
        }
        if (toolName === 'write_file') {
          return {
            content: [{ type: 'text', text: 'Successfully wrote file' }],
          };
        }
        return { content: [{ type: 'text', text: 'Tool executed' }] };
      }),
    getServerCapabilities: overrides.getServerCapabilities || mock.fn(() => ({ tools: {} })),
    getServerVersion:
      overrides.getServerVersion ||
      mock.fn(() => ({ name: 'filesystem-server', version: '1.0.0' })),
  };
}

/**
 * Create a mock StdioClientTransport
 * @param {Object} [overrides={}] - Override default mock implementations
 * @returns {Object} Mock transport instance
 */
function createMockTransport(overrides = {}) {
  return {
    start: overrides.start || mock.fn(async () => {}),
    close: overrides.close || mock.fn(async () => {}),
    onclose: null,
    onerror: null,
    onmessage: null,
  };
}

/**
 * Create a valid server config for testing
 * @param {Object} [overrides={}] - Override default config values
 * @returns {Object} Server configuration
 */
function createServerConfig(overrides = {}) {
  return {
    id: 'filesystem',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    env: { ALLOWED_PATHS: '/workspace' },
    ...overrides,
  };
}

// ============================================================================
// Integration Tests
// ============================================================================

describe('MCP Integration Tests', () => {
  describe('MCPManager + MCPClient workflow', () => {
    let manager;
    let mockSdkClient;
    let mockTransport;

    beforeEach(() => {
      mockSdkClient = createMockSdkClient();
      mockTransport = createMockTransport();

      manager = new MCPManager({ logger: null });

      // Stub _connectServer to use mocks instead of real MCP SDK
      manager._connectServer = mock.fn(async server => {
        server.transport = mockTransport;
        server.client = mockSdkClient;

        // Discover tools
        const toolsResponse = await mockSdkClient.listTools();
        server.tools = toolsResponse.tools || [];
      });
    });

    afterEach(async () => {
      // Clean up any running servers
      await manager.stopAll();
    });

    test('start server → list tools → stop server', async () => {
      // Start server
      const config = createServerConfig();
      const server = await manager.startServer(config);

      assert.equal(server.id, 'filesystem');
      assert.equal(server.status, 'running');
      assert.equal(server.tools.length, 3);

      // List tools
      const tools = manager.getServerTools('filesystem');
      assert.equal(tools.length, 3);
      assert.equal(tools[0].name, 'list_allowed_directories');
      assert.equal(tools[1].name, 'read_file');
      assert.equal(tools[2].name, 'write_file');

      // Stop server
      await manager.stopServer('filesystem');
      assert.equal(manager.hasServer('filesystem'), false);
    });

    test('start multiple servers concurrently', async () => {
      // Start filesystem server
      const filesystemServer = await manager.startServer(createServerConfig({ id: 'filesystem' }));

      // Start github server
      const githubServer = await manager.startServer(
        createServerConfig({
          id: 'github',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
        })
      );

      assert.equal(manager.getServerCount(), 2);
      assert.ok(manager.hasServer('filesystem'));
      assert.ok(manager.hasServer('github'));

      assert.equal(filesystemServer.tools.length, 3);
      assert.equal(githubServer.tools.length, 3);

      // Stop all
      const results = await manager.stopAll();
      assert.equal(results.stopped.length, 2);
      assert.equal(results.failed.length, 0);
    });

    test('server crash triggers auto-restart', async () => {
      manager.maxRestarts = 3;
      manager.restartDelayMs = 10;

      let connectCallCount = 0;
      manager._connectServer = mock.fn(async server => {
        connectCallCount++;
        server.transport = createMockTransport();
        server.client = createMockSdkClient();
        server.tools = [];
        if (connectCallCount === 1) {
          // First connect - set up crash handler
          manager._setupCrashHandler(server);
        }
      });

      // Start server
      await manager.startServer(createServerConfig());
      const server = manager.getServer('filesystem');

      assert.equal(server.status, 'running');
      assert.equal(server.restartCount, 0);

      // Simulate crash
      server.transport.onclose();

      assert.equal(server.status, 'restarting');
      assert.equal(server.restartCount, 1);

      // Wait for restart
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify restart was attempted
      assert.ok(manager._connectServer.mock.calls.length >= 2);
    });

    test('get server returns accurate server state', async () => {
      await manager.startServer(createServerConfig());

      const server = manager.getServer('filesystem');

      assert.ok(server);
      assert.equal(server.id, 'filesystem');
      assert.equal(server.status, 'running');
      assert.ok(server.config);
      assert.ok(server.client);
      assert.ok(server.transport);
      assert.ok(Array.isArray(server.tools));
      assert.equal(server.restartCount, 0);
      assert.ok(server.createdAt instanceof Date);
    });
  });

  describe('MCPClient standalone workflow', () => {
    test('connect → listTools → callTool → disconnect', async () => {
      const mockSdkClient = createMockSdkClient();
      const mockTransport = createMockTransport();

      const client = new MCPClient({ logger: null });

      // Inject mocks to simulate connected state
      client._client = mockSdkClient;
      client._transport = mockTransport;
      client._state = 'connected';
      client._serverCapabilities = { tools: {} };
      client._serverVersion = { name: 'test-server', version: '1.0.0' };

      // List tools
      const tools = await client.listTools();
      assert.equal(tools.length, 3);
      assert.equal(tools[0].name, 'list_allowed_directories');
      assert.equal(tools[1].name, 'read_file');
      assert.equal(tools[2].name, 'write_file');

      // Call tool
      const result = await client.callTool('read_file', { path: '/workspace/test.txt' });
      assert.ok(result.content);
      assert.equal(result.content[0].type, 'text');
      assert.equal(result.content[0].text, 'File content from MCP server');

      // Verify SDK client was called
      assert.equal(mockSdkClient.callTool.mock.calls.length, 1);
      const callArgs = mockSdkClient.callTool.mock.calls[0].arguments[0];
      assert.equal(callArgs.name, 'read_file');
      assert.deepEqual(callArgs.arguments, { path: '/workspace/test.txt' });

      // Disconnect
      await client.disconnect();
      assert.equal(client.state, 'disconnected');
      assert.equal(client.isConnected, false);
    });

    test('handles tool error responses', async () => {
      const mockSdkClient = createMockSdkClient({
        callTool: mock.fn(async () => ({
          content: [{ type: 'text', text: 'File not found: /nonexistent.txt' }],
          isError: true,
        })),
      });

      const client = new MCPClient({ logger: null });
      client._client = mockSdkClient;
      client._transport = createMockTransport();
      client._state = 'connected';

      await assert.rejects(
        () => client.callTool('read_file', { path: '/nonexistent.txt' }),
        err => {
          assert.equal(err.name, 'MCPClientError');
          assert.match(err.message, /returned an error/);
          assert.match(err.message, /File not found/);
          return true;
        }
      );
    });
  });

  describe('ToolConverter integration with MCPClient', () => {
    let mcpClient;
    let mcpTools;

    beforeEach(() => {
      // Create a mock client that matches MCPClient's callTool signature (toolName, params)
      mcpClient = {
        callTool: mock.fn(async (toolName, _params) => {
          if (toolName === 'read_file') {
            return {
              content: [{ type: 'text', text: 'File content from MCP server' }],
            };
          }
          if (toolName === 'write_file') {
            return {
              content: [{ type: 'text', text: 'Successfully wrote file' }],
            };
          }
          return { content: [{ type: 'text', text: 'Tool executed' }] };
        }),
      };

      mcpTools = [
        {
          name: 'read_file',
          description: 'Read a file from the filesystem',
          inputSchema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
        },
        {
          name: 'write_file',
          description: 'Write content to a file',
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              content: { type: 'string' },
            },
            required: ['path', 'content'],
          },
        },
      ];
    });

    test('convertMCPToolsToAITools creates executable AI tools', async () => {
      const aiTools = convertMCPToolsToAITools(mcpTools, 'filesystem', mcpClient);

      assert.equal(aiTools.length, 2);

      // Check first tool
      assert.equal(aiTools[0].name, 'filesystem__read_file');
      assert.equal(aiTools[0].tool.description, 'Read a file from the filesystem');
      assert.ok(aiTools[0].tool.parameters);
      assert.equal(typeof aiTools[0].tool.execute, 'function');

      // Execute tool
      const result = await aiTools[0].tool.execute({ path: '/workspace/test.txt' });
      assert.ok(result.content);
      assert.equal(result.content, 'File content from MCP server');

      // Verify MCP client was called with original tool name
      assert.equal(mcpClient.callTool.mock.calls.length, 1);
      assert.equal(mcpClient.callTool.mock.calls[0].arguments[0], 'read_file');
    });

    test('convertMCPToolsToToolMap creates tool registry', async () => {
      const toolMap = convertMCPToolsToToolMap(mcpTools, 'filesystem', mcpClient);

      assert.ok(toolMap['filesystem__read_file']);
      assert.ok(toolMap['filesystem__write_file']);
      assert.equal(Object.keys(toolMap).length, 2);

      // Execute tool from map
      const readFileTool = toolMap['filesystem__read_file'];
      const result = await readFileTool.execute({ path: '/workspace/test.txt' });
      assert.equal(result.content, 'File content from MCP server');
    });

    test('tool parameter validation via Zod schema', async () => {
      const aiTools = convertMCPToolsToAITools(mcpTools, 'filesystem', mcpClient);
      const readFileTool = aiTools[0].tool;

      // Valid parameters
      const validResult = readFileTool.parameters.safeParse({ path: '/workspace/test.txt' });
      assert.equal(validResult.success, true);

      // Invalid parameters (missing required field)
      const invalidResult = readFileTool.parameters.safeParse({});
      assert.equal(invalidResult.success, false);
    });
  });

  describe('Full MCP stack integration', () => {
    let manager;
    let mockSdkClient;

    beforeEach(() => {
      mockSdkClient = createMockSdkClient();
      manager = new MCPManager({ logger: null });

      manager._connectServer = mock.fn(async server => {
        server.transport = createMockTransport();
        server.client = mockSdkClient;

        // Discover tools
        const toolsResponse = await mockSdkClient.listTools();
        server.tools = toolsResponse.tools || [];
      });
    });

    afterEach(async () => {
      await manager.stopAll();
    });

    test('MCPManager → ToolConverter → Tool Execution', async () => {
      // 1. Start MCP server
      await manager.startServer(createServerConfig());

      // 2. Get tools from manager
      const mcpTools = manager.getServerTools('filesystem');
      assert.equal(mcpTools.length, 3);

      // 3. Create a wrapper client for tool conversion
      // The server.client is the SDK client, so we need to wrap it to match MCPClient signature
      const wrappedClient = {
        callTool: mock.fn(async (toolName, params) => {
          // Call the SDK client with proper format
          return await mockSdkClient.callTool({ name: toolName, arguments: params });
        }),
      };

      // 4. Convert MCP tools to AI tools
      const aiTools = convertMCPToolsToAITools(mcpTools, 'filesystem', wrappedClient);
      assert.equal(aiTools.length, 3);

      // 5. Execute a tool
      const readFileTool = aiTools.find(t => t.name === 'filesystem__read_file');
      assert.ok(readFileTool);

      const result = await readFileTool.tool.execute({ path: '/workspace/test.txt' });
      assert.equal(result.content, 'File content from MCP server');
      assert.equal(result.error, undefined);

      // 6. Verify the full call chain
      assert.equal(wrappedClient.callTool.mock.calls.length, 1);
      const [toolName, toolParams] = wrappedClient.callTool.mock.calls[0].arguments;
      assert.equal(toolName, 'read_file');
      assert.deepEqual(toolParams, { path: '/workspace/test.txt' });
    });

    test('Multiple servers with namespaced tools', async () => {
      // Start filesystem server
      await manager.startServer(createServerConfig({ id: 'filesystem' }));

      // Start github server with different tools
      const githubClient = createMockSdkClient({
        listTools: mock.fn(async () => ({
          tools: [
            {
              name: 'list_repos',
              description: 'List repositories',
              inputSchema: { type: 'object', properties: {}, required: [] },
            },
          ],
        })),
      });

      manager._connectServer = mock.fn(async server => {
        if (server.id === 'github') {
          server.transport = createMockTransport();
          server.client = githubClient;
          const toolsResponse = await githubClient.listTools();
          server.tools = toolsResponse.tools || [];
        }
      });

      await manager.startServer(
        createServerConfig({
          id: 'github',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
        })
      );

      // Get tools from both servers
      const filesystemTools = manager.getServerTools('filesystem');
      const githubTools = manager.getServerTools('github');

      // Convert to AI tools
      const filesystemAITools = convertMCPToolsToAITools(
        filesystemTools,
        'filesystem',
        manager.getServer('filesystem').client
      );
      const githubAITools = convertMCPToolsToAITools(
        githubTools,
        'github',
        manager.getServer('github').client
      );

      // Verify namespacing prevents collisions
      const filesystemNames = filesystemAITools.map(t => t.name);
      const githubNames = githubAITools.map(t => t.name);

      assert.ok(filesystemNames.every(name => name.startsWith('filesystem__')));
      assert.ok(githubNames.every(name => name.startsWith('github__')));

      // No overlapping tool names
      const allNames = [...filesystemNames, ...githubNames];
      const uniqueNames = new Set(allNames);
      assert.equal(allNames.length, uniqueNames.size);
    });

    test('Error handling across the stack', async () => {
      // Start server with failing tool
      const failingClient = createMockSdkClient({
        callTool: mock.fn(async () => {
          throw new Error('Server connection lost');
        }),
      });

      manager._connectServer = mock.fn(async server => {
        server.transport = createMockTransport();
        server.client = failingClient;
        const toolsResponse = await failingClient.listTools();
        server.tools = toolsResponse.tools || [];
      });

      await manager.startServer(createServerConfig());

      const mcpTools = manager.getServerTools('filesystem');
      const aiTools = convertMCPToolsToAITools(mcpTools, 'filesystem', failingClient);

      const readFileTool = aiTools.find(t => t.name === 'filesystem__read_file');
      const result = await readFileTool.tool.execute({ path: '/workspace/test.txt' });

      // Error should be caught and returned as error result
      assert.equal(result.error, true);
      assert.match(result.content, /Server connection lost/);
    });
  });

  describe('Realistic workflow simulation', () => {
    test('Bot initialization with MCP tools', async () => {
      // Simulate bot manager starting MCP servers during initialization
      const manager = new MCPManager({ logger: null });

      const mockSdkClient = createMockSdkClient();
      manager._connectServer = mock.fn(async server => {
        server.transport = createMockTransport();
        server.client = mockSdkClient;
        const toolsResponse = await mockSdkClient.listTools();
        server.tools = toolsResponse.tools || [];
      });

      // Start MCP servers configured for a bot
      await manager.startServer(createServerConfig({ id: 'filesystem' }));

      // Get all tools from all servers
      const allServers = manager.listServers();
      assert.equal(allServers.length, 1);

      const allTools = [];
      for (const server of allServers) {
        const tools = manager.getServerTools(server.id);
        const aiTools = convertMCPToolsToAITools(tools, server.id, server.client);
        allTools.push(...aiTools);
      }

      // Verify we have namespaced tools ready for AI model
      assert.equal(allTools.length, 3);
      assert.ok(allTools.every(t => t.name.startsWith('filesystem__')));
      assert.ok(allTools.every(t => typeof t.tool.execute === 'function'));

      // Cleanup
      await manager.stopAll();
      assert.equal(manager.getServerCount(), 0);
    });
  });
});
