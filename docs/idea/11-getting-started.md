# Getting Started - Quick Start Guide

## The Core Idea

**AI Assistants Army** is a system for running multiple AI assistants, each with:
- Their own **personality** (soul.md file)
- Their own **workspace** (like a real person's home directory)
- Their own **tools and capabilities**
- Their own **channel** (Slack, Discord, REST API)

You configure everything in JSON. No UI needed. Edit config, restart, done.

## Start Simple

### Phase 1: Single Server, Single Bot

Start with just one server and one bot:

```
my-assistant/
├── config.json           # Main config
├── data/
│   └── assistant/        # Bot's persistent workspace
│       ├── memory/
│       └── scratch/
└── bots/
    └── assistant/
        ├── config.json   # Bot config
        ├── soul.md       # Personality
        └── Dockerfile    # Custom container (optional)
```

Minimal `config.json`:
```json
{
  "providers": {
    "anthropic": {
      "type": "anthropic",
      "apiKey": "${ANTHROPIC_API_KEY}"
    }
  },
  "bots": {
    "assistant": {
      "soul": "./bots/assistant/soul.md",
      "provider": "anthropic",
      "model": "claude-sonnet-4-5",
      "channel": {
        "type": "slack",
        "botToken": "${SLACK_BOT_TOKEN}",
        "appToken": "${SLACK_APP_TOKEN}"
      }
    }
  }
}
```

### Phase 2: Add More Bots

Same server, more bots. Each bot is independent:

```
my-assistant/
├── config.json
├── data/
│   ├── work-assistant/
│   ├── family-bot/
│   └── devops-bot/
└── bots/
    ├── work-assistant/
    ├── family-bot/
    └── devops-bot/
```

### Phase 3: Add Worker Servers

When you need more capacity, add remote workers:

```json
{
  "workers": [
    { "id": "local", "type": "local" },
    { "id": "gpu-box", "type": "remote", "host": "192.168.1.100", "user": "deploy" }
  ]
}
```

Bots can be assigned to workers. The master server handles orchestration, workers run the Docker containers.

### Phase 4: Production

Full setup with:
- Multiple workers (local + remote)
- Bitwarden for secrets
- Multiple channels per bot type
- MCP servers for integrations
- REST API for automation

## Each Assistant is Like a Person

Think of each bot as an employee with their own:

**Identity (soul.md)**
- Name and personality
- Communication style
- Values and boundaries
- Knowledge about their role

**Workspace (data/{bot}/)**
- Their own "home directory"
- Files they create persist
- Memory of past conversations
- Projects they're working on

**Tools**
- What they can do (bash, file ops, web search)
- What services they can access (GitHub, Notion, etc.)
- What restrictions they have

**Channel**
- Where they listen (Slack, Discord, REST)
- Who they talk to (user/channel restrictions)

## Directory Structure Explained

Each bot has their own directory with everything they need:

```
bots/{bot-name}/
├── config.json       # How this bot is configured
│                     # - Which model to use
│                     # - What channel to connect to
│                     # - What tools are allowed
│                     # - Resource limits
│
├── soul.md           # Who this bot is
│                     # - Personality and tone
│                     # - Instructions and guidelines
│                     # - Context about their role
│
└── Dockerfile        # Their environment (optional)
                      # - What software is installed
                      # - What packages are available
                      # - Custom setup
```

Their workspace is separate, in `data/{bot-name}/`:

```
data/{bot-name}/
├── memory/           # Long-term memory
│   ├── 2026-02-01.md # Daily notes (auto-generated)
│   └── 2026-02-05.md
│
├── sessions/         # Conversation histories
│   ├── slack:U123.jsonl
│   └── rest:user-abc.jsonl
│
├── scratch/          # Working directory
│   └── (files the bot creates)
│
├── projects/         # Longer-term work
│   └── (cloned repos, created projects)
│
└── state.json        # Bot metadata
```

## Configuration Hierarchy

1. **Global defaults** (config.json `defaults` section)
2. **Bot-specific config** (bots/{name}/config.json)
3. **Environment overrides** (env vars)

Bot config inherits from defaults, then overrides what's different.

## Secrets

Never put secrets in config files. Use:

1. **Environment variables** (simple):
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   SLACK_BOT_TOKEN=xoxb-...
   ```

2. **Bitwarden** (production):
   - Store secrets in Bitwarden Secrets Manager
   - Reference by name in config
   - Resolved at runtime

Reference secrets in config with `${VAR_NAME}` syntax.

## Channels

**Slack**: Bot responds to @mentions and DMs
**Discord**: Bot responds to @mentions and DMs
**REST API**: HTTP endpoint for programmatic access

One bot = one primary channel. For the same personality on multiple platforms, create multiple bots sharing the same soul.md.

## MCP Servers

Define MCP servers globally, attach to bots by name:

```json
{
  "mcpServers": {
    "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] }
  },
  "bots": {
    "work": { "mcpServers": ["github"] }
  }
}
```

This gives the bot access to GitHub tools (list repos, get PRs, etc.).

## Skills

Skills are reusable capabilities defined in folders with SKILL.md files. Attach to bots by path:

```json
{
  "skills": ["./skills/code-review", "./skills/deploy"]
}
```

Skills can be:
- Local (in your project)
- Shared (from npm or skills.sh)

## User Restrictions

Control who can talk to each bot:

```json
{
  "restrictions": {
    "allowedUsers": ["alice", "bob", "U12345"],
    "deniedUsers": ["spammer"],
    "allowedChannels": ["#engineering"],
    "dmAllowed": true
  }
}
```

## Scaling Path

1. **Single server, single bot**: Just getting started
2. **Single server, multiple bots**: Each bot in its own container
3. **Multiple servers**: Master + workers, remote via SSH
4. **High availability**: Multiple masters, load balancing, shared session storage

The config stays the same shape throughout. You just add more entries.

## Summary

- **One config file** defines your entire system
- **Each bot is independent** with their own personality, workspace, and tools
- **Start simple**, scale when needed
- **No UI** - edit JSON, restart, done
- **Persistent workspaces** - bots remember and maintain their work
