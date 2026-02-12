#!/usr/bin/env node

/**
 * AI Army MCP Server - Connect Claude Code to AI Army
 *
 * This MCP server allows Claude Code to communicate with AI Army bots
 * via the REST API. Add this to Claude Code's config.json to talk to
 * your bot army from within Claude Code!
 *
 * Usage in Claude Code config.json:
 * {
 *   "mcpServers": {
 *     "ai-army": {
 *       "command": "node",
 *       "args": ["/path/to/ai-army/mcp-servers/ai-army-client/index.js"],
 *       "env": {
 *         "AI_ARMY_URL": "http://15.204.245.151:3000",
 *         "AI_ARMY_TOKEN": "optional-auth-token"
 *       }
 *     }
 *   }
 * }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Configuration from environment
const AI_ARMY_URL = process.env.AI_ARMY_URL || 'http://localhost:3000';
const AI_ARMY_TOKEN = process.env.AI_ARMY_TOKEN || '';

/**
 * Make authenticated request to AI Army API
 */
async function aiArmyRequest(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(AI_ARMY_TOKEN && { 'Authorization': `Bearer ${AI_ARMY_TOKEN}` }),
  };

  const response = await fetch(`${AI_ARMY_URL}${path}`, {
    ...options,
    headers: { ...headers, ...options.headers },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`AI Army API error: ${response.status} ${error}`);
  }

  return response.json();
}

/**
 * Create and configure the MCP server
 */
const server = new Server(
  {
    name: 'ai-army-client',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

/**
 * List available tools
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  try {
    // Get list of available bots from AI Army
    const { data: bots } = await aiArmyRequest('/api/bots');

    const tools = bots.map(bot => ({
      name: `talk_to_${bot.id.replace(/-/g, '_')}`,
      description: `Send a message to the ${bot.id} bot running on AI Army. The bot uses ${bot.model} and can execute bash commands, read/write files in its container.`,
      inputSchema: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'Message to send to the bot',
          },
          sessionId: {
            type: 'string',
            description: 'Optional session ID for conversation continuity',
          },
        },
        required: ['message'],
      },
    }));

    // Add meta tools
    tools.push({
      name: 'list_ai_army_bots',
      description: 'List all available bots in AI Army with their status and configuration',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    });

    tools.push({
      name: 'get_ai_army_status',
      description: 'Get the health status and metrics of the AI Army system',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    });

    return { tools };
  } catch (error) {
    console.error('Error listing tools:', error);
    return { tools: [] };
  }
});

/**
 * Handle tool execution
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // Handle meta tools
    if (name === 'list_ai_army_bots') {
      const { data: bots } = await aiArmyRequest('/api/bots');
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(bots, null, 2),
          },
        ],
      };
    }

    if (name === 'get_ai_army_status') {
      const status = await aiArmyRequest('/health');
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(status, null, 2),
          },
        ],
      };
    }

    // Handle bot messaging tools
    if (name.startsWith('talk_to_')) {
      const botId = name.replace('talk_to_', '').replace(/_/g, '-');
      const { message, sessionId } = args;

      const response = await aiArmyRequest(`/api/bots/${botId}/message`, {
        method: 'POST',
        body: JSON.stringify({
          userId: 'claude-code-user',
          text: message,
          sessionId: sessionId || `claude-code-${Date.now()}`,
        }),
      });

      return {
        content: [
          {
            type: 'text',
            text: response.text || `[Bot executed in ${response.durationMs}ms but returned no text. Tools used: ${response.usage?.totalTokens || 0} tokens]`,
          },
        ],
        isError: false,
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

/**
 * Start the server
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('AI Army MCP Server running');
  console.error(`Connected to: ${AI_ARMY_URL}`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
