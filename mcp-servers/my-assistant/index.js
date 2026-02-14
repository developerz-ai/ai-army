#!/usr/bin/env node
/**
 * My Assistant - MCP Server for Sebastian's AI Army bot
 * Connects to sebastian-buza-assistant via AI Army REST API
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const AI_ARMY_URL = process.env.AI_ARMY_URL || 'http://vps-944c38ff.vps.ovh.net:3000';
const API_KEY = process.env.API_KEY || '';
const BOT_ID = process.env.BOT_ID || 'sebastian-buza-assistant';
const USER_ID = process.env.USER_ID || 'sebastian-buza';

async function sendMessage(message, sessionId) {
  const response = await fetch(`${AI_ARMY_URL}/api/bots/${BOT_ID}/message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      userId: USER_ID,
      text: message,
      sessionId: sessionId || `mcp-${Date.now()}`,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error: ${response.status} ${error}`);
  }

  return response.json();
}

const server = new Server(
  { name: 'my-assistant', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'ask_assistant',
    description: 'Ask your personal AI assistant. It has bash, file operations, and can help with coding, system tasks, and more.',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Your message or question' },
      },
      required: ['message'],
    },
  }],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'ask_assistant') {
    try {
      const response = await sendMessage(args.message);
      const text = response.text || `[Executed in ${response.durationMs}ms]`;
      return {
        content: [{ type: 'text', text }],
        isError: false,
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  }

  throw new Error(`Unknown tool: ${name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('My Assistant MCP Server running');
  console.error(`Bot: ${BOT_ID}`);
  console.error(`Server: ${AI_ARMY_URL}`);
}

main().catch(console.error);
