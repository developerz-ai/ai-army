# Phase 8: Demo Project

**Goal**: Rails-style ./demo for developers to explore
**Dependencies**: All previous phases
**Deliverables**: Complete working demo with 3 bots

---

## Demo Structure

```
demo/
├── package.json              # Depends on ai-army
├── .env.example              # Required env vars
├── .gitignore
├── docker-compose.yml        # PostgreSQL 18 + ai-army
├── config.json               # Main config
├── CLAUDE.md                 # Claude Code instructions
├── AGENT.md                  # Generic AI agent instructions
├── README.md                 # How to run
│
├── bots/                     # 3 example bots
│   ├── echo-bot/
│   │   ├── config.json
│   │   └── soul.md
│   ├── calculator-bot/
│   │   ├── config.json
│   │   └── soul.md
│   └── file-assistant/
│       ├── config.json
│       └── soul.md
│
├── scripts/
│   ├── setup.sh              # One-command setup
│   ├── test.sh               # Send test messages
│   └── cleanup.sh            # Remove containers/data
│
└── data/                     # Created at runtime
```

---

## Demo Bots

### 1. Echo Bot
**Purpose**: Simplest bot - proves message routing works

**File**: `demo/bots/echo-bot/config.json`
```json
{
  "id": "echo-bot",
  "soul": "./soul.md",
  "provider": "anthropic",
  "model": "claude-haiku-4-5",
  "tools": []
}
```

**File**: `demo/bots/echo-bot/soul.md`
```markdown
# Echo Bot

You simply repeat what the user says. Be friendly and add "Echo:" prefix.

Example:
User: "Hello"
You: "Echo: Hello"
```

### 2. Calculator Bot
**Purpose**: Demonstrates bash tool usage

**File**: `demo/bots/calculator-bot/config.json`
```json
{
  "id": "calculator-bot",
  "soul": "./soul.md",
  "provider": "anthropic",
  "model": "claude-sonnet-4-5",
  "tools": ["bash"],
  "sandbox": {
    "packages": ["bc"]
  }
}
```

**File**: `demo/bots/calculator-bot/soul.md`
```markdown
# Calculator Bot

You are a calculator. When asked to compute something, use the bash tool:
- `echo $((123 + 456))` for integer math
- `echo "123.45 * 67.89" | bc -l` for decimals

Always show your calculation and the result.
```

### 3. File Assistant
**Purpose**: Demonstrates file operations

**File**: `demo/bots/file-assistant/config.json`
```json
{
  "id": "file-assistant",
  "soul": "./soul.md",
  "provider": "anthropic",
  "model": "claude-sonnet-4-5",
  "tools": ["bash", "readFile", "writeFile", "glob"],
  "workspace": {
    "root": "./data/file-assistant"
  }
}
```

**File**: `demo/bots/file-assistant/soul.md`
```markdown
# File Assistant

You help manage files in your workspace at /home/agent.

Capabilities:
- Create files (writeFile tool)
- Read files (readFile tool)
- List files (glob tool)
- Search files (bash with grep)

Be helpful and confirm actions: "I've created test.txt with your content."
```

---

## Demo Scripts

### File: `demo/scripts/setup.sh`
```bash
#!/bin/bash
set -e

echo "🚀 Setting up AI Army Demo"

# Install dependencies
npm install

# Start PostgreSQL 18
echo "📦 Starting PostgreSQL 18..."
docker run -d --name demo-postgres \
  -e POSTGRES_DB=ai_army_demo \
  -e POSTGRES_USER=demo \
  -e POSTGRES_PASSWORD=demo \
  -p 5432:5432 \
  postgres:18-alpine

# Wait for DB
echo "⏳ Waiting for database..."
sleep 5

# Run migrations
echo "🔄 Running migrations..."
DATABASE_URL=postgresql://demo:demo@localhost:5432/ai_army_demo \
  npx ai-army migrate

echo "✅ Demo ready!"
echo ""
echo "Next steps:"
echo "1. Copy .env.example to .env and add your ANTHROPIC_API_KEY"
echo "2. Run: npm start"
echo "3. Test: ./scripts/test.sh"
```

### File: `demo/scripts/test.sh`
```bash
#!/bin/bash
# Send test messages to all bots

echo "🧪 Testing demo bots..."

# Test echo bot
echo "1️⃣  Testing echo-bot..."
echo '{"message": "Hello!"}' | \
  npx ai-army message echo-bot

# Test calculator
echo "2️⃣  Testing calculator-bot..."
echo '{"message": "What is 15 times 23?"}' | \
  npx ai-army message calculator-bot

# Test file assistant
echo "3️⃣  Testing file-assistant..."
echo '{"message": "Create a file test.txt with content: Hello World"}' | \
  npx ai-army message file-assistant

echo "✅ All bots tested"
```

---

## Demo Documentation

### File: `demo/README.md`
```markdown
# AI Army Demo

Working example of ai-army framework with 3 bots.

## Quick Start

\`\`\`bash
cd demo
./scripts/setup.sh        # Setup PostgreSQL 18 + dependencies
cp .env.example .env
vim .env                  # Add ANTHROPIC_API_KEY
npm start                 # Start all bots
\`\`\`

## Test the Bots

\`\`\`bash
./scripts/test.sh
\`\`\`

## Bots Included

1. **echo-bot** - Repeats your message (simplest)
2. **calculator-bot** - Does math using bash
3. **file-assistant** - Manages files in workspace

## Explore

- Bot configs: `bots/*/config.json`
- Bot personalities: `bots/*/soul.md`
- Persistent workspaces: `data/*/`
- Database: `psql postgresql://demo:demo@localhost/ai_army_demo`

## Modify

Edit any bot's soul.md and run:
\`\`\`bash
npx ai-army reload
\`\`\`

Changes apply immediately without restart.

## Cleanup

\`\`\`bash
./scripts/cleanup.sh
\`\`\`
```

### File: `demo/CLAUDE.md`
```markdown
# Demo AI Army - Claude Code Instructions

Use Claude Code to explore and modify this demo.

## What This Demo Shows

3 bots demonstrating ai-army framework:
- echo-bot: Message routing
- calculator-bot: Bash tool usage
- file-assistant: File operations

## Try These

"Show me how the echo-bot config works"
"Add a new bot that tells jokes"
"Modify calculator-bot to handle fractions"
"Add a test for file-assistant"

## Architecture

- config.json: Main configuration
- bots/*/: Each bot's config + personality
- data/*/: Persistent workspaces
- PostgreSQL 18: Sessions and state

All configs use ai-army framework npm package.
```

### File: `demo/AGENT.md`
```markdown
# Demo Project Guide

This demonstrates the ai-army framework.

## How It Works

1. config.json defines 3 bots
2. Each bot has config.json (settings) + soul.md (personality)
3. Bots run in Docker containers
4. Sessions stored in PostgreSQL 18
5. Tools execute in isolated containers

## File Structure

- bots/echo-bot/ - Simplest bot
- bots/calculator-bot/ - Uses bash tool
- bots/file-assistant/ - Uses file tools
- data/*/ - Persistent workspaces
- scripts/ - Helper scripts

## Testing

Each bot can be tested via:
\`\`\`bash
echo '{"message": "test"}' | npx ai-army message <bot-id>
\`\`\`

## Extending

Add a bot:
1. Create bots/my-bot/ directory
2. Add config.json + soul.md
3. Run: npx ai-army validate
4. Run: npx ai-army reload
```

---

## Docker Compose

### File: `demo/docker-compose.yml`
```yaml
version: '3.8'

services:
  postgres:
    image: postgres:18-alpine
    environment:
      POSTGRES_DB: ai_army_demo
      POSTGRES_USER: demo
      POSTGRES_PASSWORD: demo
    volumes:
      - postgres-data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U demo"]
      interval: 10s

  ai-army:
    build: .
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://demo:demo@postgres:5432/ai_army_demo
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
    volumes:
      - .:/app
      - ./data:/app/data
      - /var/run/docker.sock:/var/run/docker.sock
    restart: unless-stopped

volumes:
  postgres-data:
```

---

## Success Criteria

- ✅ `./demo` directory with 3 working bots
- ✅ `./scripts/setup.sh` runs successfully
- ✅ `./scripts/test.sh` tests all bots
- ✅ CLAUDE.md helps Claude Code users
- ✅ AGENT.md helps any AI agent users
- ✅ docker-compose.yml uses PostgreSQL 18
- ✅ One-command demo deployment
