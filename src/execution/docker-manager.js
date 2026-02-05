/**
 * DockerManager - Docker container management using dockerode
 *
 * Creates, starts, stops, and monitors bot execution containers.
 * Provides real bash execution in isolated Docker containers with
 * resource limits, volume mounts, and package installation.
 *
 * @module execution/docker-manager
 */

import Docker from 'dockerode';
import stream from 'stream';
import { setTimeout, clearTimeout } from 'timers';

/**
 * Custom error class for Docker-related errors
 */
export class DockerError extends Error {
  /**
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {string} [options.operation] - The operation that failed
   * @param {string} [options.containerId] - Container ID if applicable
   * @param {string} [options.botId] - Bot ID if applicable
   * @param {Error} [options.cause] - Original error that caused this
   */
  constructor(message, options = {}) {
    super(message);
    this.name = 'DockerError';
    this.operation = options.operation;
    this.containerId = options.containerId;
    this.botId = options.botId;
    this.cause = options.cause;
  }
}

/**
 * Manages Docker containers for bot execution
 *
 * @example
 * const manager = new DockerManager();
 * const container = await manager.createContainer(botConfig, workspace);
 * await manager.startContainer(container);
 * const result = await manager.exec(container, 'echo "hello"');
 * await manager.stopContainer(container);
 */
export class DockerManager {
  /**
   * Create a new DockerManager instance
   *
   * @param {Object|string} [dockerHost] - Docker connection options
   *   If string: Unix socket path (e.g., '/var/run/docker.sock')
   *   If object: Docker connection options { host, port, socketPath, etc. }
   *   If undefined: Uses default Unix socket
   */
  constructor(dockerHost) {
    if (typeof dockerHost === 'string') {
      this.docker = new Docker({ socketPath: dockerHost });
    } else if (dockerHost && typeof dockerHost === 'object') {
      this.docker = new Docker(dockerHost);
    } else {
      this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
    }
  }

  /**
   * Create a new Docker container for a bot
   *
   * @param {Object} botConfig - Bot configuration
   * @param {string} botConfig.id - Unique bot identifier
   * @param {Object} [botConfig.sandbox] - Sandbox configuration
   * @param {string} [botConfig.sandbox.image='node:22-slim'] - Docker image
   * @param {string} [botConfig.sandbox.memory='2g'] - Memory limit
   * @param {number} [botConfig.sandbox.cpus=2] - CPU cores
   * @param {string} [botConfig.sandbox.network='bridge'] - Network mode
   * @param {Object} workspace - Workspace configuration
   * @param {string} workspace.root - Root path for workspace mount
   * @returns {Promise<Object>} Docker container object
   * @throws {DockerError} When container creation fails
   */
  async createContainer(botConfig, workspace) {
    if (!botConfig || !botConfig.id) {
      throw new DockerError('Bot configuration with id is required', {
        operation: 'createContainer',
      });
    }

    const image = botConfig.sandbox?.image || 'node:22-slim';

    try {
      // Pull image if not present
      await this._ensureImage(image);

      // Create container with configuration
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
          AutoRemove: false,
        },
        Labels: {
          'ai-army.bot-id': botConfig.id,
          'ai-army.managed': 'true',
        },
      });

      return container;
    } catch (err) {
      throw new DockerError(`Failed to create container for bot ${botConfig.id}: ${err.message}`, {
        operation: 'createContainer',
        botId: botConfig.id,
        cause: err,
      });
    }
  }

  /**
   * Build volume mount configurations
   *
   * @param {Object} workspace - Workspace configuration
   * @param {string} [workspace.root='./data'] - Root path for workspace
   * @returns {Array<string>} Array of mount strings like ["/host/path:/container/path:rw"]
   */
  buildMounts(workspace) {
    const workspaceRoot = workspace?.root || './data';
    // Resolve to absolute path
    const hostPath = workspaceRoot.startsWith('/')
      ? workspaceRoot
      : `${process.cwd()}/${workspaceRoot}`;

    return [`${hostPath}:/home/agent:rw`];
  }

  /**
   * Parse memory string to bytes
   *
   * @param {string} memStr - Memory string (e.g., '512m', '2g')
   * @returns {number} Memory in bytes
   * @throws {DockerError} When format is invalid
   */
  parseMemory(memStr) {
    if (typeof memStr === 'number') {
      return memStr;
    }

    const match = String(memStr).match(/^(\d+)([kmg])$/i);
    if (!match) {
      throw new DockerError(`Invalid memory format: ${memStr}. Use format like '512m' or '2g'`, {
        operation: 'parseMemory',
      });
    }

    const [, num, unit] = match;
    const multipliers = {
      k: 1024,
      m: 1024 ** 2,
      g: 1024 ** 3,
    };

    return parseInt(num, 10) * multipliers[unit.toLowerCase()];
  }

  /**
   * Start a container and wait for it to be healthy
   *
   * @param {Object} container - Docker container object
   * @param {number} [timeout=10000] - Timeout in milliseconds
   * @returns {Promise<void>}
   * @throws {DockerError} When container fails to start
   */
  async startContainer(container, timeout = 10000) {
    if (!container) {
      throw new DockerError('Container is required', {
        operation: 'startContainer',
      });
    }

    try {
      await container.start();
      await this._waitForHealthy(container, timeout);
    } catch (err) {
      // Ignore "already started" errors
      if (err.statusCode === 304) {
        return;
      }

      const containerId = container.id || 'unknown';
      throw new DockerError(`Failed to start container: ${err.message}`, {
        operation: 'startContainer',
        containerId,
        cause: err,
      });
    }
  }

  /**
   * Stop and remove a container gracefully
   *
   * @param {Object} container - Docker container object
   * @param {number} [timeout=10] - Grace period in seconds before SIGKILL
   * @returns {Promise<void>}
   * @throws {DockerError} When container fails to stop
   */
  async stopContainer(container, timeout = 10) {
    if (!container) {
      throw new DockerError('Container is required', {
        operation: 'stopContainer',
      });
    }

    const containerId = container.id || 'unknown';

    try {
      // Try to stop gracefully
      try {
        await container.stop({ t: timeout });
      } catch (err) {
        // Ignore "not running" errors (304 = not modified/already stopped)
        if (err.statusCode !== 304 && !err.message?.includes('is not running')) {
          throw err;
        }
      }

      // Remove the container
      await container.remove({ force: true });
    } catch (err) {
      // Ignore "no such container" errors
      if (err.statusCode === 404 || err.message?.includes('No such container')) {
        return;
      }

      throw new DockerError(`Failed to stop container: ${err.message}`, {
        operation: 'stopContainer',
        containerId,
        cause: err,
      });
    }
  }

  /**
   * Execute a command in a running container
   *
   * @param {Object} container - Docker container object
   * @param {string} command - Bash command to execute
   * @param {Object} [options={}] - Execution options
   * @param {number} [options.timeout=30000] - Command timeout in milliseconds
   * @param {string} [options.user] - User to run command as
   * @param {string} [options.workingDir='/home/agent'] - Working directory
   * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
   * @throws {DockerError} When execution fails
   */
  async exec(container, command, options = {}) {
    if (!container) {
      throw new DockerError('Container is required', {
        operation: 'exec',
      });
    }

    if (typeof command !== 'string' || !command.trim()) {
      throw new DockerError('Command must be a non-empty string', {
        operation: 'exec',
      });
    }

    const containerId = container.id || 'unknown';
    const timeout = options.timeout || 30000;

    try {
      // Create exec instance
      const execConfig = {
        Cmd: ['sh', '-c', command],
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
      };

      if (options.user) {
        execConfig.User = options.user;
      }

      if (options.workingDir) {
        execConfig.WorkingDir = options.workingDir;
      }

      const exec = await container.exec(execConfig);

      // Start exec and capture output
      const execStream = await exec.start({ hijack: true, stdin: false });

      // Capture stdout and stderr using demuxStream
      let stdout = '';
      let stderr = '';

      const stdoutStream = new stream.Writable({
        write(chunk, _encoding, callback) {
          stdout += chunk.toString();
          callback();
        },
      });

      const stderrStream = new stream.Writable({
        write(chunk, _encoding, callback) {
          stderr += chunk.toString();
          callback();
        },
      });

      // Demux the stream to separate stdout and stderr
      container.modem.demuxStream(execStream, stdoutStream, stderrStream);

      // Wait for completion with timeout
      await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          execStream.destroy();
          reject(
            new DockerError(`Command timed out after ${timeout}ms`, {
              operation: 'exec',
              containerId,
            })
          );
        }, timeout);

        execStream.on('end', () => {
          clearTimeout(timeoutId);
          resolve();
        });

        execStream.on('error', err => {
          clearTimeout(timeoutId);
          reject(err);
        });
      });

      // Get exit code
      const inspectResult = await exec.inspect();

      return {
        exitCode: inspectResult.ExitCode,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      };
    } catch (err) {
      if (err instanceof DockerError) {
        throw err;
      }

      throw new DockerError(`Failed to execute command: ${err.message}`, {
        operation: 'exec',
        containerId,
        cause: err,
      });
    }
  }

  /**
   * Check if a container is running and responsive
   *
   * @param {Object} container - Docker container object
   * @returns {Promise<boolean>} True if container is healthy
   */
  async healthCheck(container) {
    if (!container) {
      return false;
    }

    try {
      const info = await container.inspect();
      return info.State.Running === true;
    } catch (_err) {
      return false;
    }
  }

  /**
   * Install packages in a running container using apt-get
   *
   * @param {Object} container - Docker container object
   * @param {Array<string>} packages - Package names to install
   * @param {Object} [options={}] - Installation options
   * @param {number} [options.timeout=120000] - Timeout for package installation
   * @returns {Promise<void>}
   * @throws {DockerError} When package installation fails
   */
  async installPackages(container, packages, options = {}) {
    if (!container) {
      throw new DockerError('Container is required', {
        operation: 'installPackages',
      });
    }

    if (!packages || !Array.isArray(packages) || packages.length === 0) {
      return;
    }

    const timeout = options.timeout || 120000;
    const containerId = container.id || 'unknown';

    try {
      // Update package lists
      const updateResult = await this.exec(container, 'apt-get update -qq', {
        timeout,
        user: 'root',
      });

      if (updateResult.exitCode !== 0) {
        throw new DockerError(`apt-get update failed: ${updateResult.stderr}`, {
          operation: 'installPackages',
          containerId,
        });
      }

      // Install packages
      const packageList = packages.join(' ');
      const installResult = await this.exec(
        container,
        `apt-get install -y --no-install-recommends ${packageList}`,
        { timeout, user: 'root' }
      );

      if (installResult.exitCode !== 0) {
        throw new DockerError(`Package installation failed: ${installResult.stderr}`, {
          operation: 'installPackages',
          containerId,
        });
      }
    } catch (err) {
      if (err instanceof DockerError) {
        throw err;
      }

      throw new DockerError(`Failed to install packages: ${err.message}`, {
        operation: 'installPackages',
        containerId,
        cause: err,
      });
    }
  }

  /**
   * Ensure a Docker image is available, pulling if necessary
   *
   * @param {string} imageName - Docker image name with tag
   * @returns {Promise<void>}
   * @private
   */
  async _ensureImage(imageName) {
    try {
      // Check if image exists
      await this.docker.getImage(imageName).inspect();
    } catch (_err) {
      // Image not found, need to pull
      await this._pullImage(imageName);
    }
  }

  /**
   * Pull a Docker image
   *
   * @param {string} imageName - Docker image name with tag
   * @returns {Promise<void>}
   * @private
   */
  async _pullImage(imageName) {
    return new Promise((resolve, reject) => {
      this.docker.pull(imageName, (err, pullStream) => {
        if (err) {
          return reject(
            new DockerError(`Failed to pull image ${imageName}: ${err.message}`, {
              operation: 'pullImage',
              cause: err,
            })
          );
        }

        // Follow the pull progress
        this.docker.modem.followProgress(pullStream, (progressErr, _output) => {
          if (progressErr) {
            return reject(
              new DockerError(`Failed to pull image ${imageName}: ${progressErr.message}`, {
                operation: 'pullImage',
                cause: progressErr,
              })
            );
          }
          resolve();
        });
      });
    });
  }

  /**
   * Wait for a container to become healthy (running)
   *
   * @param {Object} container - Docker container object
   * @param {number} timeout - Timeout in milliseconds
   * @returns {Promise<boolean>}
   * @private
   */
  async _waitForHealthy(container, timeout) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const info = await container.inspect();

      if (info.State.Running) {
        return true;
      }

      // Wait 500ms before checking again
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    throw new DockerError('Container failed to start within timeout', {
      operation: 'waitForHealthy',
      containerId: container.id,
    });
  }

  /**
   * Get Docker daemon info (useful for connection testing)
   *
   * @returns {Promise<Object>} Docker daemon info
   * @throws {DockerError} When connection fails
   */
  async getInfo() {
    try {
      return await this.docker.info();
    } catch (err) {
      throw new DockerError(`Failed to connect to Docker daemon: ${err.message}`, {
        operation: 'getInfo',
        cause: err,
      });
    }
  }

  /**
   * List all containers managed by ai-army
   *
   * @param {Object} [options={}] - List options
   * @param {boolean} [options.all=true] - Include stopped containers
   * @returns {Promise<Array>} List of container info objects
   */
  async listManagedContainers(options = {}) {
    const { all = true } = options;

    try {
      const containers = await this.docker.listContainers({
        all,
        filters: {
          label: ['ai-army.managed=true'],
        },
      });

      return containers;
    } catch (err) {
      throw new DockerError(`Failed to list containers: ${err.message}`, {
        operation: 'listManagedContainers',
        cause: err,
      });
    }
  }

  /**
   * Get a container by bot ID
   *
   * @param {string} botId - Bot identifier
   * @returns {Promise<Object|null>} Docker container object or null if not found
   */
  async getContainerByBotId(botId) {
    try {
      const containers = await this.docker.listContainers({
        all: true,
        filters: {
          label: [`ai-army.bot-id=${botId}`],
        },
      });

      if (containers.length === 0) {
        return null;
      }

      return this.docker.getContainer(containers[0].Id);
    } catch (_err) {
      return null;
    }
  }

  /**
   * Remove a container by name (with force)
   *
   * @param {string} containerName - Name of the container
   * @returns {Promise<boolean>} True if removed, false if not found
   */
  async removeContainerByName(containerName) {
    try {
      const container = this.docker.getContainer(containerName);
      await container.remove({ force: true });
      return true;
    } catch (err) {
      if (err.statusCode === 404) {
        return false;
      }
      throw new DockerError(`Failed to remove container ${containerName}: ${err.message}`, {
        operation: 'removeContainerByName',
        cause: err,
      });
    }
  }
}
