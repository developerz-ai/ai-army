# How to Add MCP Servers to Claude Code

## What is MCP?

**Model Context Protocol (MCP)** allows AI assistants to access external tools and data sources like filesystems, databases, APIs, and more. MCP servers expose tools that the AI can use during conversations.

## Adding MCP Servers to Claude Code

### 1. Find Your Claude Code Config

Claude Code's MCP servers are configured in:
```bash
~/.claude/config.json
```

### 2. Add MCP Server Configuration

Edit the config file and add an `mcpServers` section:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/yourusername"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "your-github-token"
      }
    },
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": {
        "DATABASE_URL": "postgresql://user:pass@localhost:5432/db"
      }
    }
  }
}
```

### 3. Available MCP Servers

Popular MCP servers you can add:

| Server | Package | Use Case |
|--------|---------|----------|
| **Filesystem** | `@modelcontextprotocol/server-filesystem` | Read/write local files |
| **GitHub** | `@modelcontextprotocol/server-github` | Manage repos, PRs, issues |
| **Postgres** | `@modelcontextprotocol/server-postgres` | Query databases |
| **Memory** | `@modelcontextprotocol/server-memory` | Persistent knowledge graphs |
| **Brave Search** | `@anthropic/mcp-server-brave-search` | Web search |
| **Slack** | `@anthropic/mcp-server-slack` | Slack integration |
| **Puppeteer** | `@modelcontextprotocol/server-puppeteer` | Browser automation |

### 4. Restart Claude Code

After editing the config:
```bash
# Exit Claude Code (Ctrl+D or exit)
# Restart it
claude
```

### 5. Verify MCP Servers Loaded

Claude Code will show which MCP servers loaded at startup:
```
🔌 MCP Servers:
  - filesystem (14 tools)
  - github (12 tools)
```

## AI Army MCP Configuration

For AI Army bots, configure MCP in two places:

### Global Configuration (`config.json`)

Define MCP servers globally:
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    }
  }
}
```

### Bot Configuration (`bots/my-bot/config.json`)

Enable MCP servers for specific bots:
```json
{
  "id": "my-bot",
  "soul": "./soul.md",
  "provider": "openrouter",
  "model": "openrouter/aurora-alpha",
  "tools": ["bash", "readFile", "writeFile"],
  "mcpServers": ["filesystem"]
}
```

## Testing MCP Integration

### Test in AI Army

```bash
# Send message to bot with MCP tools
curl -X POST http://localhost:3000/api/bots/test-bot/message \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test",
    "text": "List files in /tmp using MCP filesystem tools",
    "sessionId": "test-1"
  }'
```

### Test in Claude Code

Just ask Claude to use the MCP tools:
```
> List files in my home directory using the filesystem MCP server
> Search GitHub for issues related to MCP
> Query the database for user records
```

## Troubleshooting

### MCP Server Won't Start

1. **Check if npx is available:**
   ```bash
   which npx
   npm --version
   ```

2. **Test the MCP server manually:**
   ```bash
   npx -y @modelcontextprotocol/server-filesystem /tmp
   ```

3. **Check Claude Code logs:**
   ```bash
   # Look for MCP-related errors
   tail -f ~/.claude/logs/main.log | grep MCP
   ```

### Tools Not Available to AI

1. **Verify MCP server loaded:**
   - Check startup logs for "MCP Servers: filesystem (14 tools)"

2. **Check bot configuration:**
   - Ensure `"mcpServers": ["filesystem"]` is in bot config

3. **Restart the system:**
   ```bash
   docker-compose restart app
   ```

## Current Status - AI Army Production

✅ **MCP Server: filesystem**
- Status: Running
- Tools: 14 available
- Path: /tmp
- Integration: Working with test-bot

✅ **Test Results**
- Bot can execute bash commands ✅
- Bot can create files ✅
- Bot can read files ✅
- MCP tools loaded ✅

## Next Steps

1. **Add more MCP servers** to expand bot capabilities
2. **Configure GitHub MCP** for repository operations
3. **Add Postgres MCP** for database queries
4. **Test web search** with Brave MCP server

## Resources

- [MCP Documentation](https://modelcontextprotocol.io)
- [Official MCP Servers](https://github.com/modelcontextprotocol/servers)
- [Anthropic MCP Servers](https://github.com/anthropics/mcp-servers)
- [Claude Code MCP Guide](https://docs.anthropic.com/claude/docs/mcp)
