# MCP & Tools - Model Context Protocol Integration

## Overview

**MCP (Model Context Protocol)** is a standard for connecting AI models to external tools and data sources. It provides a unified interface for:
- Tool definitions and execution
- Resource access (files, databases, APIs)
- Prompt templates

In AI Assistant Army, MCP servers are:
- Defined globally in `config.json`
- Attached per-bot by name
- Shared across bots (single process, multiple connections)

## MCP Server Configuration

### Global Definition

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    },
    "notion": {
      "command": "npx",
      "args": ["-y", "@notionhq/mcp"],
      "env": {
        "NOTION_TOKEN": "${NOTION_TOKEN}"
      }
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/data/shared"]
    },
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": {
        "DATABASE_URL": "${DATABASE_URL}"
      }
    },
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"]
    },
    "brave-search": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-server-brave-search"],
      "env": {
        "BRAVE_API_KEY": "${BRAVE_API_KEY}"
      }
    },
    "slack-mcp": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-server-slack"],
      "env": {
        "SLACK_TOKEN": "${SLACK_USER_TOKEN}"
      }
    },
    "linear": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-server-linear"],
      "env": {
        "LINEAR_API_KEY": "${LINEAR_API_KEY}"
      }
    },
    "custom-api": {
      "command": "node",
      "args": ["./mcp-servers/custom-api/index.js"],
      "env": {
        "API_KEY": "${CUSTOM_API_KEY}"
      }
    }
  }
}
```

### Per-Bot Attachment

```json
{
  "bots": {
    "work": {
      "mcpServers": ["github", "notion", "slack-mcp"]
    },
    "devops": {
      "mcpServers": ["github", "postgres", "linear"]
    },
    "family": {
      "mcpServers": []
    }
  }
}
```

## MCP Manager Implementation

```javascript
// src/mcp/mcp-manager.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn } from 'child_process';

export class McpManager {
  private servers = new Map();
  private clients = new Map();

  async startServer(name, config) {
    if (this.servers.has(name)) {
      return this.clients.get(name);
    }

    // Resolve environment variables
    const env = {
      ...process.env,
      ...Object.fromEntries(
        Object.entries(config.env || {}).map(([k, v]) =>
          [k, this.resolveEnvVar(v)]
        )
      )
    };

    // Spawn the server process
    const proc = spawn(config.command, config.args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    proc.stderr.on('data', (data) => {
      console.error(`[MCP:${name}] ${data.toString()}`);
    });

    proc.on('exit', (code) => {
      console.log(`[MCP:${name}] exited with code ${code}`);
      this.servers.delete(name);
      this.clients.delete(name);
    });

    // Create MCP client
    const transport = new StdioClientTransport({
      reader: proc.stdout,
      writer: proc.stdin
    });

    const client = new Client({
      name: `ai-army-${name}`,
      version: '1.0.0'
    });

    await client.connect(transport);

    this.servers.set(name, proc);
    this.clients.set(name, client);

    console.log(`[MCP:${name}] started and connected`);
    return client;
  }

  async getToolsForBot(botConfig) {
    const tools = [];

    for (const serverName of botConfig.mcpServers || []) {
      const client = await this.startServer(
        serverName,
        this.serverConfigs[serverName]
      );

      // Get tools from this server
      const { tools: serverTools } = await client.listTools();

      for (const tool of serverTools) {
        tools.push({
          name: `${serverName}__${tool.name}`,
          description: tool.description,
          parameters: tool.inputSchema,
          execute: async (params) => {
            return await client.callTool({
              name: tool.name,
              arguments: params
            });
          }
        });
      }
    }

    return tools;
  }

  async stopServer(name) {
    const proc = this.servers.get(name);
    const client = this.clients.get(name);

    if (client) {
      await client.close();
    }

    if (proc) {
      proc.kill();
    }

    this.servers.delete(name);
    this.clients.delete(name);
  }

  async stopAll() {
    for (const name of this.servers.keys()) {
      await this.stopServer(name);
    }
  }

  resolveEnvVar(value) {
    const match = value.match(/^\$\{(.+?)\}$/);
    if (match) {
      return process.env[match[1]] || '';
    }
    return value;
  }
}
```

## Built-in Tools

In addition to MCP servers, bots have access to built-in tools:

| Tool | Description |
|------|-------------|
| `bash` | Execute bash commands in container |
| `readFile` | Read file contents |
| `writeFile` | Write/create files |
| `glob` | Find files by pattern |
| `grep` | Search file contents |
| `webSearch` | Search the web |
| `webFetch` | Fetch URL contents |

### Tool Configuration Per Bot

```json
{
  "tools": ["bash", "readFile", "writeFile", "glob", "grep"],
  "toolConfig": {
    "bash": {
      "timeout": 60000,
      "maxOutputSize": 100000
    },
    "webSearch": {
      "provider": "brave",
      "maxResults": 10
    },
    "webFetch": {
      "maxSize": 1000000,
      "allowedDomains": ["docs.python.org", "developer.mozilla.org"]
    }
  }
}
```

## Tool Registry

```javascript
// src/tools/registry.ts
import { createBashTool, createReadFileTool, createWriteFileTool } from './files.js';
import { createGlobTool, createGrepTool } from './search.js';
import { createWebSearchTool, createWebFetchTool } from './web.js';

export class ToolRegistry {
  private containerManager: ContainerManager;
  private mcpManager: McpManager;
  private builtinTools: Map<string, Function>;

  constructor(containerManager, mcpManager) {
    this.containerManager = containerManager;
    this.mcpManager = mcpManager;

    this.builtinTools = new Map([
      ['bash', createBashTool],
      ['readFile', createReadFileTool],
      ['writeFile', createWriteFileTool],
      ['glob', createGlobTool],
      ['grep', createGrepTool],
      ['webSearch', createWebSearchTool],
      ['webFetch', createWebFetchTool]
    ]);
  }

  async getToolsForBot(botConfig) {
    const tools = {};

    // Add built-in tools
    for (const toolName of botConfig.tools || []) {
      const createTool = this.builtinTools.get(toolName);
      if (createTool) {
        tools[toolName] = createTool(
          this.containerManager,
          botConfig.id,
          botConfig.toolConfig?.[toolName]
        );
      }
    }

    // Add MCP tools
    const mcpTools = await this.mcpManager.getToolsForBot(botConfig);
    for (const tool of mcpTools) {
      tools[tool.name] = tool;
    }

    return tools;
  }
}
```

## Web Tools

```javascript
// src/tools/web.ts
import { tool } from 'ai';
import { z } from 'zod';

export function createWebSearchTool(containerManager, botId, config = {}) {
  return tool({
    description: 'Search the web for information',
    parameters: z.object({
      query: z.string().describe('Search query'),
      maxResults: z.number().optional().describe('Max results to return')
    }),

    execute: async ({ query, maxResults = 10 }) => {
      // Use Brave Search API, Serper, or similar
      const response = await fetch(`https://api.search.brave.com/res/v1/web/search`, {
        headers: {
          'X-Subscription-Token': process.env.BRAVE_API_KEY,
          'Accept': 'application/json'
        },
        method: 'GET',
        query: { q: query, count: maxResults }
      });

      const data = await response.json();

      return {
        success: true,
        results: data.web?.results?.map(r => ({
          title: r.title,
          url: r.url,
          description: r.description
        })) || []
      };
    }
  });
}

export function createWebFetchTool(containerManager, botId, config = {}) {
  return tool({
    description: 'Fetch and read content from a URL',
    parameters: z.object({
      url: z.string().url().describe('URL to fetch'),
      selector: z.string().optional().describe('CSS selector to extract specific content')
    }),

    execute: async ({ url, selector }) => {
      // Check domain allowlist
      const domain = new URL(url).hostname;
      if (config.allowedDomains?.length && !config.allowedDomains.includes(domain)) {
        return { success: false, error: `Domain ${domain} not allowed` };
      }

      const response = await fetch(url);
      const html = await response.text();

      // Convert to markdown or extract with selector
      const content = selector
        ? extractWithSelector(html, selector)
        : htmlToMarkdown(html);

      return {
        success: true,
        content: content.slice(0, config.maxSize || 100000)
      };
    }
  });
}
```

## Custom MCP Server Example

Create your own MCP servers for custom integrations:

```javascript
// mcp-servers/internal-api/index.js
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer({
  name: 'internal-api',
  version: '1.0.0'
});

// Define tools
server.tool(
  'get_user',
  'Get user information by ID',
  {
    type: 'object',
    properties: {
      userId: { type: 'string', description: 'User ID' }
    },
    required: ['userId']
  },
  async ({ userId }) => {
    const response = await fetch(`${process.env.API_BASE}/users/${userId}`, {
      headers: { 'Authorization': `Bearer ${process.env.API_KEY}` }
    });
    return { content: [{ type: 'text', text: JSON.stringify(await response.json()) }] };
  }
);

server.tool(
  'create_ticket',
  'Create a support ticket',
  {
    type: 'object',
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      priority: { type: 'string', enum: ['low', 'medium', 'high'] }
    },
    required: ['title', 'description']
  },
  async ({ title, description, priority = 'medium' }) => {
    const response = await fetch(`${process.env.API_BASE}/tickets`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ title, description, priority })
    });
    return { content: [{ type: 'text', text: JSON.stringify(await response.json()) }] };
  }
);

// Define resources
server.resource(
  'docs',
  'Internal documentation',
  'text/markdown',
  async () => {
    const docs = await fs.readFile('./docs/internal.md', 'utf8');
    return { content: [{ type: 'text', text: docs }] };
  }
);

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
```

## Available MCP Servers

### Official Anthropic Servers

| Server | Package | Description |
|--------|---------|-------------|
| GitHub | `@modelcontextprotocol/server-github` | GitHub API access |
| Filesystem | `@modelcontextprotocol/server-filesystem` | Local file access |
| PostgreSQL | `@modelcontextprotocol/server-postgres` | Database queries |
| Memory | `@modelcontextprotocol/server-memory` | Persistent memory store |
| Brave Search | `@anthropic/mcp-server-brave-search` | Web search |
| Slack | `@anthropic/mcp-server-slack` | Slack integration |
| Linear | `@anthropic/mcp-server-linear` | Linear issues |
| Sentry | `@anthropic/mcp-server-sentry` | Error tracking |

### Community Servers

| Server | Package | Description |
|--------|---------|-------------|
| Notion | `@notionhq/mcp` | Notion workspace |
| Google Drive | `mcp-server-gdrive` | Google Drive files |
| Jira | `mcp-server-jira` | Jira issues |
| AWS | `mcp-server-aws` | AWS services |

### Custom Servers

For internal APIs, databases, or proprietary systems, create custom MCP servers following the pattern above.
