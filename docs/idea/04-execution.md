# Execution - Docker Sandbox Model

## Overview

Each bot runs tool calls inside its own **Docker container** with:
- Persistent workspace mounted at `/home/agent`
- Isolated filesystem and network
- Resource limits (CPU, memory)
- Real bash execution (git, python, node, etc.)

## Why Docker (Not Simulated Bash)

| Feature | Simulated (just-bash) | Docker |
|---------|----------------------|--------|
| Real binaries | No | Yes |
| git, python, node | No | Yes |
| Network access | No | Yes (controlled) |
| Persistence | No | Yes |
| Security isolation | Partial | Full |
| Resource limits | No | Yes |

**We use Docker** because bots need to be "like a real PC user" - able to run scripts, install packages, and work with real tools.

## Container Configuration

### Basic Sandbox Config

```json
{
  "sandbox": {
    "type": "docker",
    "image": "node:22-slim",
    "packages": ["git", "python3", "ripgrep"],
    "network": {
      "allowedDomains": ["github.com", "npmjs.org"]
    },
    "maxMemory": "2g",
    "maxCpu": 2
  }
}
```

### Full Sandbox Config

```json
{
  "sandbox": {
    "type": "docker",

    "dockerfile": "./Dockerfile",
    "image": "ai-army/work:latest",
    "buildArgs": {
      "NODE_VERSION": "22"
    },

    "packages": ["git", "python3", "ripgrep", "jq", "curl"],
    "pipPackages": ["requests", "pandas"],
    "npmPackages": ["typescript", "eslint"],

    "network": {
      "mode": "filtered",
      "allowedDomains": [
        "github.com",
        "api.github.com",
        "*.githubusercontent.com",
        "npmjs.org",
        "registry.npmjs.org",
        "pypi.org"
      ],
      "deniedDomains": [],
      "allowedPorts": [80, 443],
      "dnsServers": ["8.8.8.8", "8.8.4.4"]
    },

    "resources": {
      "maxMemory": "2g",
      "maxCpu": 2,
      "maxPids": 100,
      "maxDiskUsage": "10g"
    },

    "security": {
      "privileged": false,
      "readOnlyRootfs": false,
      "noNewPrivileges": true,
      "dropCapabilities": ["ALL"],
      "addCapabilities": ["CHOWN", "SETUID", "SETGID"]
    },

    "env": {
      "LANG": "en_US.UTF-8",
      "TERM": "xterm-256color",
      "NODE_ENV": "production"
    },

    "timeout": {
      "commandDefault": 30000,
      "commandMax": 300000,
      "containerIdle": 3600000
    }
  }
}
```

## Container Manager Implementation

```javascript
// src/execution/container-manager.ts
import Docker from 'dockerode';

export class ContainerManager {
  private docker: Docker;
  private containers = new Map();

  constructor(dockerHost?: string) {
    this.docker = new Docker(dockerHost ? { host: dockerHost } : {});
  }

  async createContainer(botConfig) {
    const { id, workspace, sandbox } = botConfig;

    // Build image if Dockerfile specified
    if (sandbox.dockerfile) {
      await this.buildImage(botConfig);
    }

    const containerConfig = {
      Image: sandbox.image || 'node:22-slim',
      name: `ai-army-${id}`,
      Hostname: id,
      User: 'agent',
      WorkingDir: '/home/agent',
      Cmd: ['tail', '-f', '/dev/null'],

      Env: Object.entries(sandbox.env || {}).map(
        ([k, v]) => `${k}=${v}`
      ),

      HostConfig: {
        Binds: this.buildMounts(workspace),
        Memory: this.parseMemory(sandbox.resources?.maxMemory || '1g'),
        NanoCPUs: (sandbox.resources?.maxCpu || 1) * 1e9,
        PidsLimit: sandbox.resources?.maxPids || 100,

        NetworkMode: this.getNetworkMode(sandbox),
        CapDrop: sandbox.security?.dropCapabilities || ['ALL'],
        CapAdd: sandbox.security?.addCapabilities || [],
        SecurityOpt: sandbox.security?.noNewPrivileges
          ? ['no-new-privileges:true']
          : [],
        ReadonlyRootfs: sandbox.security?.readOnlyRootfs || false,
        Privileged: sandbox.security?.privileged || false
      }
    };

    const container = await this.docker.createContainer(containerConfig);
    await container.start();

    // Install packages
    await this.installPackages(container, sandbox);

    this.containers.set(id, container);
    return container;
  }

  buildMounts(workspace) {
    const mounts = [
      `${path.resolve(workspace.root)}:/home/agent:rw`
    ];

    for (const [mountPath, config] of Object.entries(workspace.mounts || {})) {
      const mode = config.readOnly ? 'ro' : 'rw';
      mounts.push(`${path.resolve(config.path)}:${mountPath}:${mode}`);
    }

    return mounts;
  }

  async installPackages(container, sandbox) {
    const commands = [];

    if (sandbox.packages?.length) {
      commands.push(
        `apt-get update && apt-get install -y ${sandbox.packages.join(' ')}`
      );
    }

    if (sandbox.pipPackages?.length) {
      commands.push(
        `pip3 install --no-cache-dir ${sandbox.pipPackages.join(' ')}`
      );
    }

    if (sandbox.npmPackages?.length) {
      commands.push(
        `npm install -g ${sandbox.npmPackages.join(' ')}`
      );
    }

    for (const cmd of commands) {
      await this.exec(container, cmd, { user: 'root' });
    }
  }

  async exec(container, command, options = {}) {
    const exec = await container.exec({
      Cmd: ['bash', '-c', command],
      AttachStdout: true,
      AttachStderr: true,
      WorkingDir: options.workingDir || '/home/agent',
      User: options.user || 'agent',
      Env: options.env
    });

    return new Promise((resolve, reject) => {
      exec.start({ hijack: true, stdin: false }, (err, stream) => {
        if (err) return reject(err);

        let stdout = '';
        let stderr = '';

        container.modem.demuxStream(stream, {
          write: (chunk) => { stdout += chunk.toString(); }
        }, {
          write: (chunk) => { stderr += chunk.toString(); }
        });

        stream.on('end', () => {
          exec.inspect((err, data) => {
            resolve({
              exitCode: data?.ExitCode ?? -1,
              stdout,
              stderr
            });
          });
        });

        // Timeout
        if (options.timeout) {
          setTimeout(() => {
            stream.destroy();
            reject(new Error(`Command timed out after ${options.timeout}ms`));
          }, options.timeout);
        }
      });
    });
  }
}
```

## Network Filtering

Use iptables rules or a proxy to control network access:

```javascript
// src/execution/network-filter.ts
export async function setupNetworkFiltering(container, allowedDomains) {
  if (allowedDomains.includes('*')) {
    return; // Full access
  }

  if (allowedDomains.length === 0) {
    // No network access - use 'none' network mode
    return;
  }

  // Use a filtering proxy (squid or mitmproxy)
  // Or iptables rules inside the container
  const rules = allowedDomains.map(domain => {
    if (domain.startsWith('*.')) {
      // Wildcard subdomain
      return `-A OUTPUT -d ${domain.slice(2)} -j ACCEPT`;
    }
    return `-A OUTPUT -d ${domain} -j ACCEPT`;
  });

  // Apply via init script
  await execInContainer(container, `
    iptables -P OUTPUT DROP
    iptables -A OUTPUT -o lo -j ACCEPT
    iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
    ${rules.join('\n')}
  `, { user: 'root' });
}
```

## Bash Tool Implementation

The bash tool sends commands to the container:

```javascript
// src/tools/bash.ts
import { tool } from 'ai';
import { z } from 'zod';

export function createBashTool(containerManager, botId) {
  return tool({
    description: 'Execute a bash command in the workspace',
    parameters: z.object({
      command: z.string().describe('The bash command to execute'),
      workingDir: z.string().optional().describe('Working directory (default: /home/agent)'),
      timeout: z.number().optional().describe('Timeout in ms (default: 30000)')
    }),

    execute: async ({ command, workingDir, timeout }) => {
      const container = await containerManager.getContainer(botId);

      // Security check
      if (isDangerousCommand(command)) {
        return {
          success: false,
          error: 'Command blocked by security policy'
        };
      }

      try {
        const result = await containerManager.exec(container, command, {
          workingDir: workingDir || '/home/agent',
          timeout: timeout || 30000
        });

        return {
          success: result.exitCode === 0,
          exitCode: result.exitCode,
          stdout: truncate(result.stdout, 50000),
          stderr: truncate(result.stderr, 10000)
        };
      } catch (err) {
        return {
          success: false,
          error: err.message
        };
      }
    }
  });
}

function isDangerousCommand(command) {
  const dangerous = [
    /rm\s+-rf\s+\/(?!\s)/,           // rm -rf /
    />\s*\/dev\/sd/,                  // Write to disk device
    /mkfs\./,                          // Format filesystem
    /dd\s+.*of=\/dev/,                // dd to device
    /:(){ :|:& };:/,                   // Fork bomb
    /chmod\s+-R\s+777\s+\//,          // chmod 777 /
  ];

  return dangerous.some(pattern => pattern.test(command));
}
```

## File Tools Implementation

```javascript
// src/tools/files.ts
import { tool } from 'ai';
import { z } from 'zod';

export function createReadFileTool(containerManager, botId) {
  return tool({
    description: 'Read contents of a file',
    parameters: z.object({
      path: z.string().describe('Path to the file'),
      encoding: z.enum(['utf8', 'base64']).optional()
    }),

    execute: async ({ path: filePath, encoding = 'utf8' }) => {
      const container = await containerManager.getContainer(botId);
      const cmd = encoding === 'base64'
        ? `base64 "${filePath}"`
        : `cat "${filePath}"`;

      const result = await containerManager.exec(container, cmd);

      if (result.exitCode !== 0) {
        return { success: false, error: result.stderr };
      }

      return {
        success: true,
        content: truncate(result.stdout, 100000)
      };
    }
  });
}

export function createWriteFileTool(containerManager, botId) {
  return tool({
    description: 'Write content to a file',
    parameters: z.object({
      path: z.string().describe('Path to the file'),
      content: z.string().describe('Content to write'),
      append: z.boolean().optional().describe('Append instead of overwrite')
    }),

    execute: async ({ path: filePath, content, append }) => {
      const container = await containerManager.getContainer(botId);

      // Escape content for shell
      const escaped = content.replace(/'/g, "'\\''");
      const operator = append ? '>>' : '>';
      const cmd = `echo '${escaped}' ${operator} "${filePath}"`;

      const result = await containerManager.exec(container, cmd);

      return {
        success: result.exitCode === 0,
        error: result.exitCode !== 0 ? result.stderr : undefined
      };
    }
  });
}

export function createGlobTool(containerManager, botId) {
  return tool({
    description: 'Find files matching a glob pattern',
    parameters: z.object({
      pattern: z.string().describe('Glob pattern (e.g., "**/*.js")'),
      cwd: z.string().optional().describe('Directory to search in')
    }),

    execute: async ({ pattern, cwd }) => {
      const container = await containerManager.getContainer(botId);
      const dir = cwd || '/home/agent';

      // Use find with shell glob
      const cmd = `find ${dir} -path "${pattern}" -type f 2>/dev/null | head -100`;
      const result = await containerManager.exec(container, cmd);

      return {
        success: true,
        files: result.stdout.trim().split('\n').filter(Boolean)
      };
    }
  });
}

export function createGrepTool(containerManager, botId) {
  return tool({
    description: 'Search for text in files',
    parameters: z.object({
      pattern: z.string().describe('Regex pattern to search for'),
      path: z.string().optional().describe('File or directory to search'),
      options: z.object({
        ignoreCase: z.boolean().optional(),
        maxMatches: z.number().optional()
      }).optional()
    }),

    execute: async ({ pattern, path = '.', options = {} }) => {
      const container = await containerManager.getContainer(botId);

      let cmd = 'rg';
      if (options.ignoreCase) cmd += ' -i';
      if (options.maxMatches) cmd += ` -m ${options.maxMatches}`;
      cmd += ` --json "${pattern}" "${path}" 2>/dev/null | head -500`;

      const result = await containerManager.exec(container, cmd);

      // Parse ripgrep JSON output
      const matches = result.stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line))
        .filter(item => item.type === 'match');

      return {
        success: true,
        matches: matches.map(m => ({
          file: m.data.path.text,
          line: m.data.line_number,
          text: m.data.lines.text
        }))
      };
    }
  });
}
```

## Container Health & Cleanup

```javascript
// src/execution/health.ts
export class ContainerHealthMonitor {
  private containerManager: ContainerManager;
  private idleTimeouts = new Map();

  constructor(containerManager: ContainerManager) {
    this.containerManager = containerManager;

    // Health check every minute
    setInterval(() => this.checkHealth(), 60000);
  }

  async checkHealth() {
    for (const [botId, container] of this.containerManager.containers) {
      try {
        const info = await container.inspect();

        if (!info.State.Running) {
          console.log(`Container ${botId} stopped, recreating...`);
          await this.containerManager.recreateContainer(botId);
        }

        // Check memory usage
        const stats = await container.stats({ stream: false });
        const memUsage = stats.memory_stats.usage;
        const memLimit = stats.memory_stats.limit;

        if (memUsage / memLimit > 0.9) {
          console.warn(`Container ${botId} high memory usage: ${Math.round(memUsage / memLimit * 100)}%`);
        }
      } catch (err) {
        console.error(`Health check failed for ${botId}:`, err);
      }
    }
  }

  recordActivity(botId) {
    // Reset idle timeout
    if (this.idleTimeouts.has(botId)) {
      clearTimeout(this.idleTimeouts.get(botId));
    }

    const timeout = setTimeout(() => {
      console.log(`Container ${botId} idle, stopping...`);
      this.containerManager.stopContainer(botId);
    }, 3600000); // 1 hour idle

    this.idleTimeouts.set(botId, timeout);
  }
}
```

## Dockerfile Examples

### Standard Bot

```dockerfile
FROM node:22-slim

RUN apt-get update && apt-get install -y \
    git \
    python3 \
    python3-pip \
    ripgrep \
    jq \
    curl \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash agent
USER agent
WORKDIR /home/agent

CMD ["tail", "-f", "/dev/null"]
```

### Python/Data Science Bot

```dockerfile
FROM python:3.12-slim

RUN apt-get update && apt-get install -y \
    git \
    ripgrep \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
    pandas \
    numpy \
    matplotlib \
    scikit-learn \
    jupyter \
    requests

RUN useradd -m -s /bin/bash agent
USER agent
WORKDIR /home/agent

CMD ["tail", "-f", "/dev/null"]
```

### DevOps Bot

```dockerfile
FROM ubuntu:24.04

RUN apt-get update && apt-get install -y \
    curl git jq python3 python3-pip \
    docker.io kubectl helm terraform ansible \
    && rm -rf /var/lib/apt/lists/*

# AWS CLI
RUN curl -sSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" \
    && unzip awscliv2.zip && ./aws/install && rm -rf aws awscliv2.zip

# GCP CLI
RUN echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" \
    | tee /etc/apt/sources.list.d/google-cloud-sdk.list \
    && curl https://packages.cloud.google.com/apt/doc/apt-key.gpg \
    | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg \
    && apt-get update && apt-get install -y google-cloud-cli

RUN useradd -m -s /bin/bash agent
USER agent
WORKDIR /home/agent

CMD ["tail", "-f", "/dev/null"]
```
