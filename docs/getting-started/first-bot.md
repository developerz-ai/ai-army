# Creating Your First Bot

This tutorial walks you through creating your first AI bot from scratch. By the end, you'll have a working bot that can interact via REST API.

## Prerequisites

- [AI Army installed](installation.md)
- Database migrations completed (`npx ai-army migrate`)
- API keys configured in `.env`

## Project Structure

First, understand the basic structure:

```
my-project/
├── config.json           # Main configuration
├── bots/                 # Bot definitions
│   └── my-bot/
│       ├── config.json   # Bot-specific config
│       └── soul.md       # Bot personality
├── .env                  # Environment variables (API keys)
└── data/                 # Bot workspaces (auto-created)
```

## Step 1: Initialize Project

If you haven't already, create a new project directory:

```bash
mkdir my-ai-army
cd my-ai-army
npm init -y
npm install ai-army
```

Initialize the AI Army structure:

```bash
npx ai-army init
```

This creates:
- `config.json` with default settings
- `bots/` directory
- `.env.example` file
- `.gitignore` with sensitive files

## Step 2: Configure Providers

Edit `config.json` to add your AI provider:

```json
{
  "defaults": {
    "model": {
      "provider": "anthropic",
      "model": "claude-sonnet-4-5"
    },
    "sandbox": {
      "type": "docker",
      "image": "node:22-slim"
    }
  },
  "providers": {
    "anthropic": {
      "type": "anthropic",
      "apiKey": "${ANTHROPIC_API_KEY}"
    }
  },
  "channels": {},
  "mcpServers": {}
}
```

> **Note:** The `${ANTHROPIC_API_KEY}` syntax pulls from your `.env` file securely.

## Step 3: Create Bot Directory

Create a directory for your first bot:

```bash
mkdir -p bots/helper
```

## Step 4: Write Bot Configuration

Create `bots/helper/config.json`:

```json
{
  "id": "helper",
  "soul": "./soul.md",
  "provider": "anthropic",
  "model": "claude-sonnet-4-5",
  "tools": [
    "bash",
    "readFile",
    "writeFile"
  ]
}
```

### Configuration Explained

- **`id`**: Unique identifier for your bot (must match directory name)
- **`soul`**: Path to personality file (relative to this config)
- **`provider`**: AI provider to use (defined in main `config.json`)
- **`model`**: Specific model variant
- **`tools`**: Built-in tools the bot can use

### Available Built-in Tools

- `bash` - Execute shell commands in sandbox
- `readFile` - Read files from workspace
- `writeFile` - Write files to workspace
- `listDirectory` - List directory contents

## Step 5: Define Bot Personality

Create `bots/helper/soul.md`:

```markdown
# Helper Bot

You are a helpful coding assistant specialized in JavaScript and Node.js.

## Core Values

- Be precise and accurate
- Provide working code examples
- Explain your reasoning
- Ask clarifying questions when needed

## Capabilities

- Write and debug JavaScript/Node.js code
- Execute bash commands to test solutions
- Read and write files in the workspace
- Help with npm packages and dependencies

## Style

- Use ES modules (`import`/`export`)
- Follow modern JavaScript best practices
- Prefer `const` over `let`, avoid `var`
- Write clear, commented code

## Limitations

- You work in a sandboxed Docker container
- File access is limited to your workspace
- Network access depends on container configuration
```

### Soul File Best Practices

The `soul.md` file defines your bot's personality and behavior:

1. **Clear Identity**: Start with who the bot is
2. **Core Values**: Define principles and approach
3. **Capabilities**: List what the bot can do
4. **Style Guidelines**: Specify format preferences
5. **Limitations**: Set appropriate boundaries

## Step 6: Validate Configuration

Validate your bot configuration:

```bash
npx ai-army validate
```

You should see:

```
✅ Configuration is valid
✅ Bot 'helper' loaded successfully
✅ All tools are available
✅ Database connection OK
```

If you see errors, check:
- JSON syntax in config files
- File paths are correct
- Bot `id` matches directory name

## Step 7: Start AI Army

Start the system:

```bash
npx ai-army start
```

You should see:

```
🚀 AI Army starting...
📦 Database connected
🤖 Loading bot: helper
✅ Bot 'helper' started
🌐 API server listening on http://localhost:3000
✨ AI Army ready!
```

## Step 8: Interact with Your Bot

### Using REST API

Send a message via cURL:

```bash
curl -X POST http://localhost:3000/api/bots/helper/message \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-token" \
  -d '{
    "message": "Hello! Can you help me create a simple Node.js HTTP server?",
    "sessionId": "user-123"
  }'
```

### Using the CLI

Alternatively, use the CLI interface:

```bash
npx ai-army dev
```

This starts an interactive session where you can chat directly with your bot.

### Response Format

You'll receive a JSON response:

```json
{
  "botId": "helper",
  "sessionId": "user-123",
  "response": "I'd be happy to help you create a Node.js HTTP server! Here's a simple example:\n\n```javascript\nimport { createServer } from 'node:http';\n\nconst server = createServer((req, res) => {\n  res.writeHead(200, { 'Content-Type': 'text/plain' });\n  res.end('Hello World!');\n});\n\nserver.listen(3000, () => {\n  console.log('Server running at http://localhost:3000/');\n});\n```\n\nThis creates a basic HTTP server that responds with 'Hello World!' to all requests. Would you like me to add more features?",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

## Step 9: Test Bot Capabilities

Let's test the bot's tool usage:

```bash
curl -X POST http://localhost:3000/api/bots/helper/message \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-token" \
  -d '{
    "message": "Create a file called hello.js with a simple console.log",
    "sessionId": "user-123"
  }'
```

The bot will:
1. Use the `writeFile` tool to create the file
2. Confirm the file was created
3. Return a response with details

## Step 10: View Bot Status

Check your bot's status:

```bash
npx ai-army status
```

Or via API:

```bash
curl http://localhost:3000/api/bots/helper/status \
  -H "Authorization: Bearer your-api-token"
```

## Next Steps

Now that you have a working bot, explore more features:

### Add More Tools

Edit `bots/helper/config.json`:

```json
{
  "id": "helper",
  "soul": "./soul.md",
  "provider": "anthropic",
  "model": "claude-sonnet-4-5",
  "tools": [
    "bash",
    "readFile",
    "writeFile",
    "listDirectory"
  ],
  "mcpServers": ["filesystem", "github"]
}
```

### Connect to Channels

Add Slack or Discord integration:

```json
{
  "channels": {
    "slack": {
      "type": "slack",
      "token": "${SLACK_BOT_TOKEN}",
      "signingSecret": "${SLACK_SIGNING_SECRET}",
      "bots": ["helper"]
    }
  }
}
```

See [Configuration Guide](configuration.md) for details.

### Create Multiple Bots

Create specialized bots for different tasks:

```bash
# Create a code reviewer bot
mkdir -p bots/reviewer
# ... configure reviewer bot

# Create a documentation bot
mkdir -p bots/docs-writer
# ... configure docs bot
```

### Add Custom Tools

Create custom tools for your bot:

```javascript
// tools/custom-tool.js
export const myCustomTool = {
  name: 'myCustomTool',
  description: 'Does something custom',
  parameters: {
    type: 'object',
    properties: {
      input: { type: 'string' }
    }
  },
  execute: async (params) => {
    // Your tool logic here
    return { result: 'done' };
  }
};
```

Register in your bot config:

```json
{
  "tools": ["bash", "readFile", "./tools/custom-tool.js"]
}
```

## Common Issues

### Bot Won't Start

**Problem:** Bot fails to start with "Container creation failed"

**Solution:**
- Verify Docker is running: `docker ps`
- Check if image exists: `docker images | grep node`
- Pull image manually: `docker pull node:22-slim`

### Tool Execution Fails

**Problem:** Bot tries to use a tool but gets an error

**Solution:**
- Verify tool is listed in `tools` array
- Check tool permissions in sandbox
- Review bot logs: `npx ai-army logs helper`

### Session Not Persisting

**Problem:** Bot doesn't remember previous conversation

**Solution:**
- Ensure you're using the same `sessionId` across requests
- Check database connection: `npx ai-army status`
- Verify sessions table exists: `npx ai-army migrate`

## Example Bots

Check out example bots in the repository:

- **Code Assistant** - Helps with programming tasks
- **DevOps Helper** - Manages deployments and infrastructure
- **Support Bot** - Answers product questions
- **Data Analyst** - Processes and analyzes data

## Further Reading

- [Configuration Reference](configuration.md) - Complete config options
- [API Documentation](../api/rest-api.md) - Full REST API reference
- [Bot Manager API](../api/bot-manager.md) - Programmatic bot control
- [Deployment Guide](../deployment.md) - Production deployment

## Community Examples

Share your bot configurations:

- 💬 [GitHub Discussions](https://github.com/developerz-ai/ai-army/discussions)
- 📦 [Example Bots Repository](https://github.com/developerz-ai/ai-army-examples)

Happy bot building! 🤖
