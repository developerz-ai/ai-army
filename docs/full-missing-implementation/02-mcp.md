# Missing: MCP Integration

**Status:** ❌ Not Implemented
**Priority:** High
**Design Doc:** [docs/idea/05-mcp-and-tools.md](../idea/05-mcp-and-tools.md)

## What's Missing

### 1. MCP Server Manager
```javascript
// src/mcp/mcp-manager.js - NOT IMPLEMENTED
class MCPManager {
  async startServer(serverConfig)
  async stopServer(serverId)
  async listServers()
  async getServerTools(serverId)
}
```

**Responsibilities:**
- Spawn MCP server processes (stdio transport)
- Maintain client connections to each server
- Handle server lifecycle (restart on crash)
- Expose tools from all servers to bots

### 2. MCP Client Wrapper
```javascript
// src/mcp/mcp-client.js - NOT IMPLEMENTED
class MCPClient {
  async connect(transport)
  async listTools()
  async callTool(name, params)
  async disconnect()
}
```

**Requirements:**
- Use `@modelcontextprotocol/sdk` (already in dependencies)
- Support stdio transport (spawn child process)
- Handle tool calls from AI model
- Parse tool results

### 3. Configuration Support

**config.json** - MCP section not processed:
```json
{
  "mcp": {
    "servers": {
      "github": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "env": {
          "GITHUB_TOKEN": "${GITHUB_TOKEN}"
        }
      },
      "filesystem": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem"],
        "env": {
          "ALLOWED_PATHS": "/workspace"
        }
      }
    }
  }
}
```

**Bot config** - Attach MCP servers:
```json
{
  "id": "work-bot",
  "soul": "./soul.md",
  "mcp": ["github", "filesystem"]
}
```

### 4. Tool Integration

**Bridge to Vercel AI SDK:**
```javascript
// Convert MCP tools to Vercel AI SDK tools
function convertMCPToolsToAITools(mcpTools) {
  return mcpTools.map(mcpTool => tool({
    description: mcpTool.description,
    parameters: mcpTool.inputSchema,
    execute: async (params) => {
      return await mcpClient.callTool(mcpTool.name, params);
    }
  }));
}
```

## Current State

**What Works:**
- `@modelcontextprotocol/sdk` dependency installed
- Custom tools in `src/tools/` (bash, files)
- Tool execution framework exists

**What Doesn't Work:**
- MCP server spawning
- MCP tool discovery
- MCP tool calls
- Per-bot MCP server attachment

## Implementation Path

### Step 1: MCP Manager Core
1. Create `MCPManager` class
2. Implement server spawning via child_process
3. Test with `@modelcontextprotocol/server-filesystem`
4. Add server registry (in-memory Map)

### Step 2: MCP Client Wrapper
1. Wrap `@modelcontextprotocol/sdk` Client
2. Implement stdio transport connection
3. Test tool listing and calling
4. Handle errors and disconnections

### Step 3: Configuration
1. Extend `ConfigValidator` to validate MCP config
2. Parse `config.mcp.servers` in `ConfigLoader`
3. Support env var substitution in MCP config
4. Validate bot-level MCP attachments

### Step 4: Tool Bridge
1. Convert MCP tools to Vercel AI SDK format
2. Inject MCP tools into bot's tool registry
3. Route tool calls through `MCPClient`
4. Handle tool execution results

### Step 5: Lifecycle Integration
1. Start MCP servers in `Orchestrator.start()`
2. Attach servers to bots in `BotManager.loadBot()`
3. Cleanup servers in `Orchestrator.stop()`
4. Handle server crashes (auto-restart)

### Step 6: Testing
1. Unit tests for MCPManager
2. Integration test with real MCP server
3. Test tool calling from AI model
4. Test server restart on crash

## Files to Create

```
src/mcp/mcp-manager.js
src/mcp/mcp-client.js
src/mcp/tool-converter.js
test/unit/mcp-manager.test.js
test/integration/mcp-server.test.js
```

## Dependencies

- ✅ @modelcontextprotocol/sdk (already in package.json)
- Child process (Node.js built-in)
- Process management (graceful shutdown)

## Example MCP Servers to Support

1. **GitHub** - Issues, PRs, repos
2. **Filesystem** - File operations
3. **Notion** - Pages and databases
4. **Linear** - Issue tracking
5. **Custom** - User-defined MCP servers

## Complexity: Medium
- Process management (child_process)
- Protocol implementation (stdio transport)
- Tool format conversion
- Error handling for external processes
