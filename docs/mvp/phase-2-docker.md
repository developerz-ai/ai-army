# Phase 2: Docker Execution

**Goal**: Real bash execution in isolated Docker containers
**Dependencies**: Phase 1 (ConfigLoader)
**Deliverables**: 3 files, 3 integration tests

---

## 📚 Library References

**Before implementing, review this helper file**:

- **[Docker Management](./helpers/03-docker-management.md)** - dockerode, container lifecycle, security patterns

**Key Library for Phase 2**:
- `dockerode` - Official Docker API client (2M+ weekly downloads, only viable option)

**Important**: Review the security patterns for dangerous command detection in the helper file!

---

## Files to Implement

### 1. Docker Manager
**File**: `src/execution/DockerManager.js`
**Test**: `test/integration/execution/DockerManager.test.js`

**Class**: `DockerManager(dockerHost?: string)`

**Methods**:
- `async createContainer(botConfig, workspace)` → `Container`
  Create with mounts, resource limits, network config

- `async startContainer(container)` → `void`
  Start and wait for healthy

- `async stopContainer(container)` → `void`
  Graceful stop (SIGTERM then SIGKILL)

- `async exec(container, command, options)` → `{stdout, stderr, exitCode}`
  Execute bash command, capture output

- `async healthCheck(container)` → `boolean`
  Check if running and responsive

- `buildMounts(workspace)` → `Array<string>`
  Build volume mount config: `["/host/path:/container/path:rw"]`

- `async installPackages(container, packages)` → `void`
  Run apt-get install for packages array

**Container Config**:
```javascript
{
  Image: 'node:22-slim',
  name: `ai-army-${botId}`,
  Cmd: ['tail', '-f', '/dev/null'],  // Keep alive
  HostConfig: {
    Binds: ['./data/bot:/home/agent:rw'],
    Memory: parseMemory('2g'),  // 2GB
    NanoCPUs: 2 * 1e9,          // 2 cores
    NetworkMode: 'bridge'
  },
  WorkingDir: '/home/agent'
}
```

**Tests**:
- ✓ Creates container with correct image
- ✓ Mounts workspace at /home/agent
- ✓ Executes `echo hello` → stdout: "hello"
- ✓ Executes `exit 1` → exitCode: 1
- ✓ Installs packages: `['git', 'python3']`
- ✓ Health check detects stopped containers

### 2. Container Pool
**File**: `src/execution/ContainerPool.js`
**Test**: `test/integration/execution/ContainerPool.test.js`

**Class**: `ContainerPool(dockerManager: DockerManager)`

**Methods**:
- `async getContainer(botId)` → `Container`
  Get existing or create new, store in Map

- `async recycleContainer(botId)` → `void`
  Stop, remove, delete from Map

- `async healthCheckAll()` → `void`
  Check all containers, recycle unhealthy

- `async cleanup()` → `void`
  Stop and remove all containers

**Tests**:
- ✓ First call creates container
- ✓ Second call reuses same container
- ✓ `recycleContainer()` removes and recreates
- ✓ `healthCheckAll()` identifies unhealthy containers
- ✓ `cleanup()` removes all containers

### 3. Tool Executor
**File**: `src/execution/ToolExecutor.js`
**Test**: `test/integration/execution/ToolExecutor.test.js`

**Class**: `ToolExecutor(containerPool: ContainerPool)`

**Methods**:
- `async executeTool(toolName, params, botId)` → `Object`
  Route to correct tool handler

- `async bash(command, botId)` → `{success, stdout, stderr, exitCode}`
  Execute bash, security check first

- `async readFile(path, botId)` → `{success, content}`
  Read file from container

- `async writeFile(path, content, botId)` → `{success}`
  Write file to container

- `isDangerousCommand(command)` → `boolean`
  Check against patterns: `rm -rf /`, fork bombs, etc

**Security Patterns** (block these):
```javascript
const DANGEROUS = [
  /rm\s+-rf\s+\/(?!\s)/,      // rm -rf /
  />\s*\/dev\/sd/,             // Write to disk device
  /:(){ :|:& };:/,             // Fork bomb
  /chmod\s+-R\s+777\s+\//      // chmod 777 /
];
```

**Tests**:
- ✓ `bash('echo hello')` works
- ✓ `readFile('/home/agent/test.txt')` works
- ✓ `writeFile('/home/agent/new.txt', 'content')` works
- ✓ `bash('rm -rf /')` throws `DangerousCommandError`
- ✓ Command timeout after 30s

---

## Integration Test Pattern

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
  if (container) await manager.stopContainer(container);
});

test('DockerManager.exec() executes bash commands', async () => {
  const config = { id: 'test-bot', sandbox: { image: 'node:22-slim' } };
  const workspace = { root: './test-data' };

  container = await manager.createContainer(config, workspace);
  await manager.startContainer(container);

  const result = await manager.exec(container, 'echo "hello world"');

  assert.strictEqual(result.exitCode, 0);
  assert.strictEqual(result.stdout.trim(), 'hello world');
});
```

---

## Success Criteria

- ✅ Containers create with persistent mounts
- ✅ Bash commands execute and return output
- ✅ Package installation works
- ✅ Security checks block dangerous commands
- ✅ Container pool reuses containers
- ✅ All 3 integration tests pass
