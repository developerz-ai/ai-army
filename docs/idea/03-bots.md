# Bots - Configuration and Soul Files

## Overview

Each bot is a fully independent AI assistant with:
- Its own **persistent workspace** (like a real PC user's home directory)
- Its own **personality** (soul.md)
- Its own **channel binding** (Slack workspace, Discord guild)
- Its own **execution environment** (Docker container)
- Its own **tool access** and **MCP servers**

## Bot Directory Structure

```
config/bots/{bot-name}/
├── config.json      # Bot configuration
├── soul.md          # Personality, values, instructions
├── Dockerfile       # Custom container image (optional)
└── skills/          # Bot-specific skills (optional)
    └── custom-skill/
        ├── SKILL.md
        └── index.js

data/{bot-name}/     # Persistent workspace (survives restarts)
├── memory/          # Long-term memory files
│   ├── 2026-02-03.md
│   ├── 2026-02-04.md
│   └── 2026-02-05.md
├── sessions/        # Per-user session transcripts
│   ├── slack:U12345.jsonl
│   └── slack:U67890.jsonl
├── scratch/         # Working directory (files bot creates)
│   ├── draft.py
│   └── output.csv
├── downloads/       # Downloaded files
├── projects/        # Cloned repos, created projects
└── state.json       # Bot metadata
```

## Persistent Workspace

**Each bot's workspace is its own "home directory"** that persists across:
- Restarts
- Container recreation
- Model changes
- Configuration updates

The workspace is mounted into the Docker container at `/home/agent`:

```
Host: ./data/work/           →  Container: /home/agent/
Host: ./data/work/scratch/   →  Container: /home/agent/scratch/
Host: ./data/work/memory/    →  Container: /home/agent/memory/
```

### Workspace Configuration

```json
{
  "workspace": {
    "root": "./data/work",
    "mounts": {
      "/repos": {
        "path": "/home/me/repos",
        "readOnly": true,
        "description": "Read-only access to local git repos"
      },
      "/shared": {
        "path": "./data/shared",
        "readOnly": false,
        "description": "Shared files between bots"
      },
      "/logs": {
        "path": "/var/log/apps",
        "readOnly": true
      }
    },
    "gitConfig": {
      "user.name": "Aria Bot",
      "user.email": "aria@example.com"
    }
  }
}
```

### Workspace Initialization

On first boot, the workspace is initialized:

```javascript
// src/workspace/init.ts
export async function initializeWorkspace(botConfig) {
  const root = path.resolve(botConfig.workspace.root);

  // Create directory structure
  await fs.mkdir(path.join(root, 'memory'), { recursive: true });
  await fs.mkdir(path.join(root, 'sessions'), { recursive: true });
  await fs.mkdir(path.join(root, 'scratch'), { recursive: true });
  await fs.mkdir(path.join(root, 'downloads'), { recursive: true });
  await fs.mkdir(path.join(root, 'projects'), { recursive: true });

  // Initialize state
  const statePath = path.join(root, 'state.json');
  if (!await fs.pathExists(statePath)) {
    await fs.writeJSON(statePath, {
      botId: botConfig.id,
      created: new Date().toISOString(),
      sessions: {},
      stats: {
        messagesProcessed: 0,
        toolCalls: 0,
        compactions: 0
      }
    });
  }

  // Copy soul.md to workspace (for reference inside container)
  await fs.copy(botConfig.soul, path.join(root, 'SOUL.md'));

  // Setup git config if specified
  if (botConfig.workspace.gitConfig) {
    for (const [key, value] of Object.entries(botConfig.workspace.gitConfig)) {
      await execInWorkspace(root, `git config --global ${key} "${value}"`);
    }
  }
}
```

## Soul Files (soul.md)

The soul file defines the bot's personality, values, and instructions. It's injected as the system prompt.

### Example: Work Assistant (config/bots/work/soul.md)

```markdown
# Aria - Engineering Team Assistant

You are Aria, an engineering team assistant at Acme Corp.

## Core Values

- **Accuracy over speed**: Take time to verify information before responding
- **Security-conscious**: Never expose secrets, credentials, or sensitive data
- **Helpful but boundaried**: Assist with work tasks, redirect personal requests

## Capabilities

You have access to:
- The team's GitHub repositories (read-only)
- Notion workspace for documentation
- Bash execution in your workspace
- Web search for research

## Communication Style

- Professional but friendly
- Concise responses, avoid fluff
- Use code blocks for code
- Ask clarifying questions when requirements are ambiguous

## Restrictions

- Do NOT access or discuss personal conversations
- Do NOT make commits without explicit approval
- Do NOT access production databases
- If asked about salary, HR policies, or confidential info, politely decline

## Context

You're deployed in the #engineering Slack channel. The team includes:
- Alice (Tech Lead)
- Bob (Backend Engineer)
- Carol (Frontend Engineer)
- Dave (DevOps)

When addressing team members, use their names.
```

### Example: Family Bot (config/bots/family/soul.md)

```markdown
# Buddy - Family Group Helper

You are Buddy, a friendly assistant for the Smith family Discord server.

## Personality

- Warm and approachable
- Patient, especially with children
- Knows when to be serious vs playful

## What You Help With

- Homework questions (explain, don't just give answers)
- Recipe suggestions
- Planning family events
- General knowledge questions
- Light entertainment (jokes, trivia)

## Boundaries

- No mature content
- No scary stories or content
- Encourage healthy habits
- Defer medical/legal questions to professionals

## Family Members

- Mom (Sarah) - loves cooking
- Dad (Mike) - into sports
- Emma (12) - interested in science
- Jake (8) - loves dinosaurs
```

## Bot Configuration (config.json)

### Complete Example

```json
{
  "id": "work",
  "enabled": true,
  "name": "Aria",
  "description": "Engineering team assistant",

  "soul": "./soul.md",

  "provider": "anthropic",
  "model": "claude-sonnet-4-5",
  "fallbacks": ["claude-haiku-4-5"],
  "modelConfig": {
    "temperature": 0.7,
    "maxTokens": 4096
  },

  "channel": "slack-main",
  "sessionPer": "user",

  "restrictions": {
    "allowedUsers": ["U12345", "U67890", "alice", "bob"],
    "deniedUsers": ["U99999"],
    "allowedChannels": ["C12345", "#engineering", "#dev"],
    "deniedChannels": ["#random", "#off-topic", "C00000"],
    "allowedGuilds": [],
    "dmAllowed": true
  },

  "workspace": {
    "root": "./data/work",
    "mounts": {
      "/repos": { "path": "/home/me/repos", "readOnly": true }
    }
  },

  "sandbox": {
    "type": "docker",
    "dockerfile": "./Dockerfile",
    "image": "ai-army/work:latest",
    "packages": ["git", "python3", "ripgrep", "jq"],
    "network": {
      "allowedDomains": ["github.com", "api.github.com", "npmjs.org", "pypi.org"]
    },
    "maxMemory": "2g",
    "maxCpu": 2,
    "privileged": false
  },

  "tools": ["bash", "readFile", "writeFile", "glob", "grep", "webSearch", "webFetch"],
  "maxSteps": 50,

  "mcpServers": ["github", "notion"],

  "skills": [
    "./skills/code-review",
    "../../skills/shared/jira-triage"
  ],

  "memory": {
    "dir": "memory",
    "compaction": {
      "enabled": true,
      "threshold": 100000,
      "flushBeforeCompact": true,
      "summaryModel": "claude-haiku-4-5"
    }
  },

  "hooks": {
    "onMessage": "./hooks/log-message.js",
    "onToolCall": "./hooks/audit-tool.js",
    "onError": "./hooks/notify-error.js"
  }
}
```

## User/Channel Restrictions

Control who can interact with each bot:

```json
{
  "restrictions": {
    "allowedUsers": ["U12345", "U67890", "alice", "bob@company.com"],
    "deniedUsers": ["U99999", "spam-user"],
    "allowedChannels": ["C12345", "#engineering", "#support"],
    "deniedChannels": ["#random", "#off-topic"],
    "allowedGuilds": ["guild-123"],
    "dmAllowed": true
  }
}
```

### Resolution Logic

```javascript
// src/restrictions/check.ts
export function canInteract(botConfig, message) {
  const { restrictions } = botConfig;
  const { userId, channelId, guildId, isDM } = message;

  // Check DM permission
  if (isDM && restrictions.dmAllowed === false) {
    return { allowed: false, reason: 'DMs not allowed' };
  }

  // Check user whitelist (if specified, only these users allowed)
  if (restrictions.allowedUsers?.length > 0) {
    if (!matchesAny(userId, restrictions.allowedUsers)) {
      return { allowed: false, reason: 'User not in allowlist' };
    }
  }

  // Check user blacklist
  if (restrictions.deniedUsers?.length > 0) {
    if (matchesAny(userId, restrictions.deniedUsers)) {
      return { allowed: false, reason: 'User in denylist' };
    }
  }

  // Check channel whitelist
  if (restrictions.allowedChannels?.length > 0 && !isDM) {
    if (!matchesAny(channelId, restrictions.allowedChannels)) {
      return { allowed: false, reason: 'Channel not in allowlist' };
    }
  }

  // Check channel blacklist
  if (restrictions.deniedChannels?.length > 0) {
    if (matchesAny(channelId, restrictions.deniedChannels)) {
      return { allowed: false, reason: 'Channel in denylist' };
    }
  }

  return { allowed: true };
}

function matchesAny(value, patterns) {
  return patterns.some(pattern => {
    // Support ID, username, email, or channel name patterns
    if (pattern.startsWith('#')) {
      return value === pattern || value === pattern.slice(1);
    }
    return value === pattern || value.toLowerCase() === pattern.toLowerCase();
  });
}
```

## Custom Dockerfile

For bots that need specialized environments:

### config/bots/work/Dockerfile

```dockerfile
FROM node:22-slim

# System packages
RUN apt-get update && apt-get install -y \
    git \
    python3 \
    python3-pip \
    ripgrep \
    jq \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Python packages
RUN pip3 install --no-cache-dir \
    requests \
    pandas \
    numpy

# Node.js global tools
RUN npm install -g \
    typescript \
    eslint \
    prettier

# Create agent user
RUN useradd -m -s /bin/bash agent
USER agent
WORKDIR /home/agent

# Git config
RUN git config --global init.defaultBranch main

# Keep container alive
CMD ["tail", "-f", "/dev/null"]
```

### config/bots/devops/Dockerfile

```dockerfile
FROM ubuntu:24.04

RUN apt-get update && apt-get install -y \
    curl \
    git \
    jq \
    python3 \
    python3-pip \
    docker.io \
    kubectl \
    terraform \
    ansible \
    && rm -rf /var/lib/apt/lists/*

# Install AWS CLI
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" \
    && unzip awscliv2.zip \
    && ./aws/install \
    && rm -rf aws awscliv2.zip

# Install gcloud
RUN curl -sSL https://sdk.cloud.google.com | bash

RUN useradd -m -s /bin/bash agent
USER agent
WORKDIR /home/agent

CMD ["tail", "-f", "/dev/null"]
```

## Bot Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│                    Bot Lifecycle                             │
└─────────────────────────────────────────────────────────────┘

1. LOAD CONFIG
   ├── Read config/bots/{name}/config.json
   ├── Merge with defaults
   ├── Validate schema
   └── Resolve ${ENV_VARS}

2. INITIALIZE WORKSPACE
   ├── Create directory structure
   ├── Load existing state.json
   └── Setup git config

3. BUILD/PULL CONTAINER
   ├── If Dockerfile exists: docker build
   ├── Else: docker pull {image}
   └── Install packages

4. START CONTAINER
   ├── Mount workspace at /home/agent
   ├── Mount additional paths
   ├── Apply resource limits
   └── Configure network

5. CONNECT CHANNEL
   ├── Initialize Slack/Discord client
   ├── Authenticate with tokens
   └── Register message handlers

6. SPAWN MCP SERVERS
   ├── Start each configured MCP server
   └── Connect to bot's tool registry

7. READY
   └── Bot now listening for messages

8. ON MESSAGE
   ├── Check restrictions
   ├── Load/create session
   ├── Call AI with tools
   ├── Execute tool calls in container
   ├── Stream response to channel
   └── Save session

9. SHUTDOWN (graceful)
   ├── Save all sessions
   ├── Stop MCP servers
   ├── Stop container
   └── Disconnect channel
```
