# Docker Management Libraries

**Problem Areas**:
- Creating and managing Docker containers
- Executing commands in containers
- Container health checks
- Resource limits (CPU, memory)
- Volume mounts

---

## Docker Client

### ✅ Recommended: dockerode
**Install**: `npm install dockerode`

**Why**: Most popular, actively maintained, comprehensive API coverage, 2M+ weekly downloads

**Basic Setup**:
```javascript
import Docker from 'dockerode';

const docker = new Docker({
  socketPath: '/var/run/docker.sock' // Default on Linux
  // Or for remote: { host: '192.168.1.10', port: 2375 }
});

// Test connection
const info = await docker.info();
console.log(`Docker version: ${info.ServerVersion}`);
```

**Sources**:
- [dockerode - npm](https://www.npmjs.com/package/dockerode)
- [GitHub - apocas/dockerode](https://github.com/apocas/dockerode)
- [dockerode vs node-docker-api - npm trends](https://npmtrends.com/dockerode-vs-harbor-master-vs-node-docker-api)

**Alternatives**:
- **node-docker-api** (87K weekly downloads) - Alternative API, less popular
- Native Docker CLI via child_process - Too slow for frequent operations

---

## Container Management Implementation

### DockerManager Class

```javascript
// src/execution/DockerManager.js
import Docker from 'dockerode';
import stream from 'stream';

export class DockerManager {
  constructor(dockerHost) {
    this.docker = new Docker(dockerHost || { socketPath: '/var/run/docker.sock' });
  }

  async createContainer(botConfig, workspace) {
    const image = botConfig.sandbox?.image || 'node:22-slim';

    // Pull image if not present
    try {
      await this.docker.getImage(image).inspect();
    } catch (err) {
      console.log(`Pulling image ${image}...`);
      await this.pullImage(image);
    }

    // Create container
    const container = await this.docker.createContainer({
      Image: image,
      name: `ai-army-${botConfig.id}`,
      Cmd: ['tail', '-f', '/dev/null'], // Keep alive
      WorkingDir: '/home/agent',
      HostConfig: {
        Binds: this.buildMounts(workspace),
        Memory: this.parseMemory(botConfig.sandbox?.memory || '2g'),
        NanoCPUs: (botConfig.sandbox?.cpus || 2) * 1e9,
        NetworkMode: botConfig.sandbox?.network || 'bridge',
        AutoRemove: false, // We manage lifecycle
      },
      Labels: {
        'ai-army.bot-id': botConfig.id,
        'ai-army.managed': 'true'
      }
    });

    return container;
  }

  buildMounts(workspace) {
    const workspaceRoot = workspace.root || './data';
    return [`${process.cwd()}/${workspaceRoot}:/home/agent:rw`];
  }

  parseMemory(memStr) {
    const match = memStr.match(/^(\d+)([kmg])$/i);
    if (!match) throw new Error(`Invalid memory format: ${memStr}`);

    const [, num, unit] = match;
    const multipliers = { k: 1024, m: 1024 ** 2, g: 1024 ** 3 };
    return parseInt(num) * multipliers[unit.toLowerCase()];
  }

  async startContainer(container) {
    await container.start();

    // Wait for container to be ready
    await this.waitForHealthy(container);
  }

  async waitForHealthy(container, timeout = 10000) {
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const info = await container.inspect();

      if (info.State.Running) {
        return true;
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    throw new Error('Container failed to start within timeout');
  }

  async stopContainer(container) {
    try {
      await container.stop({ t: 10 }); // 10 second grace period
    } catch (err) {
      // Already stopped
      if (!err.message.includes('304')) throw err;
    }

    await container.remove();
  }

  async exec(container, command, options = {}) {
    const exec = await container.exec({
      Cmd: ['sh', '-c', command],
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });

    const execStream = await exec.start({ hijack: true, stdin: false });

    // Capture output
    let stdout = '';
    let stderr = '';

    const stdoutStream = new stream.Writable({
      write(chunk, encoding, callback) {
        stdout += chunk.toString();
        callback();
      }
    });

    const stderrStream = new stream.Writable({
      write(chunk, encoding, callback) {
        stderr += chunk.toString();
        callback();
      }
    });

    container.modem.demuxStream(execStream, stdoutStream, stderrStream);

    // Wait for completion with timeout
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Command timeout'));
      }, options.timeout || 30000);

      execStream.on('end', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    const inspectResult = await exec.inspect();

    return {
      exitCode: inspectResult.ExitCode,
      stdout: stdout.trim(),
      stderr: stderr.trim()
    };
  }

  async healthCheck(container) {
    try {
      const info = await container.inspect();
      return info.State.Running;
    } catch (err) {
      return false;
    }
  }

  async installPackages(container, packages) {
    if (!packages || packages.length === 0) return;

    console.log(`Installing packages: ${packages.join(', ')}`);

    // Update apt cache
    await this.exec(container, 'apt-get update -qq');

    // Install packages
    const result = await this.exec(
      container,
      `apt-get install -y ${packages.join(' ')}`,
      { timeout: 120000 } // 2 minute timeout for installations
    );

    if (result.exitCode !== 0) {
      throw new Error(`Package installation failed: ${result.stderr}`);
    }
  }

  async pullImage(imageName) {
    return new Promise((resolve, reject) => {
      this.docker.pull(imageName, (err, stream) => {
        if (err) return reject(err);

        this.docker.modem.followProgress(stream, (err, output) => {
          if (err) return reject(err);
          resolve(output);
        });
      });
    });
  }
}
```

---

## Container Pool Implementation

```javascript
// src/execution/ContainerPool.js
export class ContainerPool {
  constructor(dockerManager) {
    this.dockerManager = dockerManager;
    this.containers = new Map(); // botId -> container
  }

  async getContainer(botId) {
    // Return existing if available
    if (this.containers.has(botId)) {
      const container = this.containers.get(botId);

      // Verify still healthy
      const isHealthy = await this.dockerManager.healthCheck(container);
      if (isHealthy) {
        return container;
      }

      // Unhealthy, remove and recreate
      await this.recycleContainer(botId);
    }

    // Create new container
    throw new Error(`Container not initialized for bot ${botId}`);
  }

  async initializeContainer(botId, botConfig, workspace) {
    const container = await this.dockerManager.createContainer(botConfig, workspace);
    await this.dockerManager.startContainer(container);

    // Install packages if specified
    if (botConfig.sandbox?.packages) {
      await this.dockerManager.installPackages(container, botConfig.sandbox.packages);
    }

    this.containers.set(botId, container);
    return container;
  }

  async recycleContainer(botId) {
    const container = this.containers.get(botId);
    if (container) {
      await this.dockerManager.stopContainer(container);
      this.containers.delete(botId);
    }
  }

  async healthCheckAll() {
    for (const [botId, container] of this.containers.entries()) {
      const isHealthy = await this.dockerManager.healthCheck(container);
      if (!isHealthy) {
        console.warn(`Container for ${botId} is unhealthy, recycling...`);
        await this.recycleContainer(botId);
      }
    }
  }

  async cleanup() {
    for (const [botId, container] of this.containers.entries()) {
      await this.dockerManager.stopContainer(container);
    }
    this.containers.clear();
  }
}
```

---

## Security: Dangerous Command Detection

```javascript
// src/execution/ToolExecutor.js
export class ToolExecutor {
  constructor(containerPool) {
    this.containerPool = containerPool;
  }

  isDangerousCommand(command) {
    const DANGEROUS_PATTERNS = [
      /rm\s+-rf\s+\/(?!\s)/,           // rm -rf /
      />\s*\/dev\/sd/,                  // Write to disk device
      /:(){ :|:& };:/,                  // Fork bomb
      /chmod\s+-R\s+777\s+\//,         // chmod 777 /
      /dd\s+if=/,                       // dd operations
      /mkfs\./,                         // Format filesystem
      /:\(\)\{/,                        // Another fork bomb variant
    ];

    return DANGEROUS_PATTERNS.some(pattern => pattern.test(command));
  }

  async bash(command, botId) {
    if (this.isDangerousCommand(command)) {
      throw new Error(`Dangerous command blocked: ${command}`);
    }

    const container = await this.containerPool.getContainer(botId);
    return await this.dockerManager.exec(container, command);
  }
}
```

---

## Testing

```javascript
// test/integration/execution/DockerManager.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { DockerManager } from '../../../src/execution/DockerManager.js';

let manager;
let container;

before(async () => {
  manager = new DockerManager();
});

after(async () => {
  if (container) {
    await manager.stopContainer(container);
  }
});

test('creates and starts container', async () => {
  const config = {
    id: 'test-bot',
    sandbox: { image: 'node:22-slim', memory: '1g', cpus: 1 }
  };
  const workspace = { root: './test-data' };

  container = await manager.createContainer(config, workspace);
  await manager.startContainer(container);

  const info = await container.inspect();
  assert.strictEqual(info.State.Running, true);
});

test('executes bash commands', async () => {
  const result = await manager.exec(container, 'echo "hello world"');

  assert.strictEqual(result.exitCode, 0);
  assert.strictEqual(result.stdout, 'hello world');
});

test('installs packages', async () => {
  await manager.installPackages(container, ['curl', 'git']);

  const result = await manager.exec(container, 'which curl');
  assert.strictEqual(result.exitCode, 0);
  assert.ok(result.stdout.includes('/usr/bin/curl'));
});
```

---

## Performance Tips

1. **Reuse containers**: Don't recreate per message (slow!)
2. **Image caching**: Pull images during setup, not runtime
3. **Package pre-installation**: Install packages once at container creation
4. **Health check interval**: Every 30s is sufficient
5. **Resource limits**: Set appropriate CPU/memory to prevent one bot consuming all resources

---

## Summary

| Need | Library | Why |
|------|---------|-----|
| Docker API | dockerode | Most popular, comprehensive, actively maintained |
| Container pooling | Custom implementation | Full control over lifecycle |
| Security | Custom patterns | Bot-specific dangerous command detection |

**Total Dependencies**: 1 (dockerode)
