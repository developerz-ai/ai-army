/**
 * IncusBackend - Container backend adapter for Incus (LXC)
 *
 * Implements the ContainerBackend interface using the IncusClient
 * low-level REST API client. Each bot gets its own LXC container
 * that behaves like a full Linux machine — with systemd, persistent
 * filesystem, and resource limits.
 *
 * Unlike Docker containers (single-process), LXC containers provide
 * full OS-level isolation. Bots can install packages, run services,
 * and even run Docker inside their LXC container (nesting).
 *
 * @module execution/incus-backend
 */

import path from 'node:path';
import { ContainerBackend, ContainerBackendError, BACKEND_TYPES } from './container-backend.js';
import { IncusClient, IncusClientError } from './incus-client.js';

/** Default Incus image for bot containers */
const DEFAULT_IMAGE = 'images:ubuntu/24.04/cloud';

/** Container name prefix for ai-army managed instances */
const CONTAINER_PREFIX = 'ai-army-';

/**
 * Incus (LXC) implementation of the ContainerBackend interface
 *
 * @extends ContainerBackend
 * @example
 * const backend = new IncusBackend();
 * const container = await backend.createContainer(botConfig, workspace);
 * await backend.startContainer(container);
 * const result = await backend.exec(container, 'echo "hello"');
 * await backend.stopContainer(container);
 */
export class IncusBackend extends ContainerBackend {
  /**
   * Create a new IncusBackend instance
   *
   * @param {Object} [options={}] - Backend configuration
   * @param {string} [options.socketPath] - Path to Incus Unix socket
   * @param {number} [options.operationTimeout] - Timeout for async operations (ms)
   * @param {number} [options.requestTimeout] - Timeout for HTTP requests (ms)
   */
  constructor(options = {}) {
    super(BACKEND_TYPES.INCUS);
    this.client = new IncusClient(options);
  }

  /**
   * Create a new LXC container for a bot
   *
   * Creates an Incus instance with the bot's name, image, resource limits,
   * and workspace mount. The container is created but not started.
   *
   * @param {Object} botConfig - Bot configuration
   * @param {string} botConfig.id - Unique bot identifier
   * @param {Object} [botConfig.sandbox] - Sandbox configuration
   * @param {string} [botConfig.sandbox.incusImage] - Incus image alias
   * @param {string} [botConfig.sandbox.memory='2GB'] - Memory limit (e.g., '2GB', '512MB')
   * @param {number} [botConfig.sandbox.cpus=2] - CPU core limit
   * @param {boolean} [botConfig.sandbox.nesting=false] - Enable Docker-in-LXC nesting
   * @param {Object} workspace - Workspace configuration
   * @param {string} workspace.root - Root path for workspace mount
   * @returns {Promise<{name: string, id: string}>} Container handle
   * @throws {ContainerBackendError} When container creation fails
   */
  async createContainer(botConfig, workspace) {
    if (!botConfig || !botConfig.id) {
      throw new ContainerBackendError('Bot configuration with id is required', {
        operation: 'createContainer',
        backend: this.type,
      });
    }

    const name = `${CONTAINER_PREFIX}${botConfig.id}`;
    const image = botConfig.sandbox?.incusImage || DEFAULT_IMAGE;
    const memory = botConfig.sandbox?.memory || '2GB';
    const cpus = String(botConfig.sandbox?.cpus || 2);

    // Resolve workspace path to absolute
    const workspaceRoot = workspace?.root || './data';
    const hostPath = workspaceRoot.startsWith('/')
      ? workspaceRoot
      : path.resolve(process.cwd(), workspaceRoot);

    // Build Incus instance configuration
    const config = {
      'limits.cpu': cpus,
      'limits.memory': memory,
      'user.ai-army.bot-id': botConfig.id,
      'user.ai-army.managed': 'true',
    };

    // Enable nesting for Docker-in-LXC support
    if (botConfig.sandbox?.nesting) {
      config['security.nesting'] = 'true';
    }

    // Build device configuration — mount workspace as disk device
    const devices = {
      workspace: {
        type: 'disk',
        source: hostPath,
        path: '/home/agent',
      },
    };

    // Parse image into source configuration
    // Format: "images:ubuntu/24.04/cloud" → server "images", alias "ubuntu/24.04/cloud"
    const source = this._parseImageSource(image);

    try {
      await this.client.createInstance(name, {
        source,
        config,
        devices,
      });

      return { name, id: name };
    } catch (err) {
      throw this._wrapError(
        `Failed to create container for bot ${botConfig.id}: ${err.message}`,
        'createContainer',
        name,
        botConfig.id,
        err
      );
    }
  }

  /**
   * Start a container and wait for it to be ready
   *
   * @param {Object} container - Container handle from createContainer
   * @param {string} container.name - Instance name
   * @param {number} [timeout=10000] - Timeout in milliseconds
   * @returns {Promise<void>}
   * @throws {ContainerBackendError} When container fails to start
   */
  async startContainer(container, timeout = 10000) {
    if (!container || !container.name) {
      throw new ContainerBackendError('Container handle with name is required', {
        operation: 'startContainer',
        backend: this.type,
      });
    }

    try {
      await this.client.startInstance(container.name);
      await this._waitForRunning(container.name, timeout);
    } catch (err) {
      if (err instanceof ContainerBackendError) {
        throw err;
      }
      throw this._wrapError(
        `Failed to start container: ${err.message}`,
        'startContainer',
        container.name,
        null,
        err
      );
    }
  }

  /**
   * Stop and remove a container gracefully
   *
   * Stops the instance, then deletes it. Ignores "already stopped"
   * and "not found" errors for idempotent cleanup.
   *
   * @param {Object} container - Container handle
   * @param {string} container.name - Instance name
   * @param {number} [timeout=10] - Grace period in seconds before force stop
   * @returns {Promise<void>}
   * @throws {ContainerBackendError} When container fails to stop
   */
  async stopContainer(container, timeout = 10) {
    if (!container || !container.name) {
      throw new ContainerBackendError('Container handle with name is required', {
        operation: 'stopContainer',
        backend: this.type,
      });
    }

    try {
      // Stop the instance (ignore if already stopped)
      try {
        await this.client.stopInstance(container.name, timeout);
      } catch (err) {
        // Ignore "already stopped" — Incus returns 400 if instance is not running
        if (!this._isAlreadyStoppedError(err)) {
          throw err;
        }
      }

      // Delete the instance
      await this.client.deleteInstance(container.name);
    } catch (err) {
      // Ignore "not found" errors for idempotent cleanup
      if (this._isNotFoundError(err)) {
        return;
      }

      if (err instanceof ContainerBackendError) {
        throw err;
      }

      throw this._wrapError(
        `Failed to stop container: ${err.message}`,
        'stopContainer',
        container.name,
        null,
        err
      );
    }
  }

  /**
   * Execute a command in a running container
   *
   * @param {Object} container - Container handle
   * @param {string} container.name - Instance name
   * @param {string} command - Bash command to execute
   * @param {Object} [options={}] - Execution options
   * @param {number} [options.timeout=30000] - Command timeout in milliseconds
   * @param {string} [options.user] - User to run command as (UID)
   * @param {string} [options.workingDir='/home/agent'] - Working directory
   * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
   * @throws {ContainerBackendError} When execution fails
   */
  async exec(container, command, options = {}) {
    if (!container || !container.name) {
      throw new ContainerBackendError('Container handle with name is required', {
        operation: 'exec',
        backend: this.type,
      });
    }

    if (typeof command !== 'string' || !command.trim()) {
      throw new ContainerBackendError('Command must be a non-empty string', {
        operation: 'exec',
        backend: this.type,
      });
    }

    try {
      const execOptions = {};

      if (options.workingDir) {
        execOptions.cwd = options.workingDir;
      }

      if (options.user !== undefined) {
        // Incus expects numeric UID; if given 'root', map to 0
        execOptions.user = options.user === 'root' ? 0 : Number(options.user) || 0;
      }

      const result = await this.client.execCommand(
        container.name,
        ['sh', '-c', command],
        execOptions
      );

      return {
        exitCode: result.exitCode,
        stdout: (result.stdout || '').trim(),
        stderr: (result.stderr || '').trim(),
      };
    } catch (err) {
      if (err instanceof ContainerBackendError) {
        throw err;
      }

      throw this._wrapError(
        `Failed to execute command: ${err.message}`,
        'exec',
        container.name,
        null,
        err
      );
    }
  }

  /**
   * Check if a container is running and responsive
   *
   * @param {Object} container - Container handle
   * @param {string} container.name - Instance name
   * @returns {Promise<boolean>} True if container is healthy
   */
  async healthCheck(container) {
    if (!container || !container.name) {
      return false;
    }

    try {
      const state = await this.client.getInstanceState(container.name);
      return state?.status === 'Running';
    } catch (_err) {
      return false;
    }
  }

  /**
   * Install packages in a running container using apt-get
   *
   * @param {Object} container - Container handle
   * @param {string} container.name - Instance name
   * @param {Array<string>} packages - Package names to install
   * @param {Object} [options={}] - Installation options
   * @param {number} [options.timeout=120000] - Timeout for package installation
   * @returns {Promise<void>}
   * @throws {ContainerBackendError} When package installation fails
   */
  async installPackages(container, packages, options = {}) {
    if (!container || !container.name) {
      throw new ContainerBackendError('Container handle with name is required', {
        operation: 'installPackages',
        backend: this.type,
      });
    }

    if (!packages || !Array.isArray(packages) || packages.length === 0) {
      return;
    }

    const timeout = options.timeout || 120000;

    // Validate package names to prevent command injection
    const packageList = packages
      .map(pkg => {
        if (!/^[a-z0-9._+-]+$/i.test(pkg)) {
          throw new ContainerBackendError(`Invalid package name: ${pkg}`, {
            operation: 'installPackages',
            containerId: container.name,
            backend: this.type,
          });
        }
        return pkg;
      })
      .join(' ');

    const installCmd = `apt-get update -qq && apt-get install -y --no-install-recommends ${packageList}`;

    const result = await this.exec(container, installCmd, {
      timeout,
      user: 'root',
    });

    if (result.exitCode !== 0) {
      throw new ContainerBackendError(`Package installation failed: ${result.stderr}`, {
        operation: 'installPackages',
        containerId: container.name,
        backend: this.type,
      });
    }
  }

  /**
   * Remove a container by name (with force)
   *
   * Stops and deletes the instance. Returns false if not found.
   *
   * @param {string} name - Name of the container
   * @returns {Promise<boolean>} True if removed, false if not found
   * @throws {ContainerBackendError} When removal fails
   */
  async removeContainerByName(name) {
    try {
      // Try to stop first (ignore errors if already stopped)
      try {
        await this.client.stopInstance(name, 5);
      } catch (_err) {
        // Ignore stop errors — instance might already be stopped
      }

      await this.client.deleteInstance(name);
      return true;
    } catch (err) {
      if (this._isNotFoundError(err)) {
        return false;
      }

      throw this._wrapError(
        `Failed to remove container ${name}: ${err.message}`,
        'removeContainerByName',
        name,
        null,
        err
      );
    }
  }

  /**
   * List all containers managed by ai-army
   *
   * Filters instances by the `user.ai-army.managed=true` config key.
   *
   * @param {Object} [options={}] - List options
   * @param {boolean} [options.all=true] - Include stopped containers
   * @returns {Promise<Array<Object>>} List of container info objects
   * @throws {ContainerBackendError} When listing fails
   */
  async listManagedContainers(options = {}) {
    const { all = true } = options;

    try {
      const instances = await this.client.listInstances();

      // Filter to ai-army managed instances
      const managed = instances.filter(
        instance => instance.config?.['user.ai-army.managed'] === 'true'
      );

      // Optionally filter to running only
      if (!all) {
        return managed.filter(instance => instance.status === 'Running');
      }

      return managed;
    } catch (err) {
      throw this._wrapError(
        `Failed to list containers: ${err.message}`,
        'listManagedContainers',
        null,
        null,
        err
      );
    }
  }

  /**
   * Get a container by bot ID
   *
   * Looks up by instance name convention `ai-army-{botId}`.
   *
   * @param {string} botId - Bot identifier
   * @returns {Promise<{name: string, id: string}|null>} Container handle or null
   */
  async getContainerByBotId(botId) {
    const name = `${CONTAINER_PREFIX}${botId}`;

    try {
      const state = await this.client.getInstanceState(name);
      if (state) {
        return { name, id: name };
      }
      return null;
    } catch (_err) {
      return null;
    }
  }

  /**
   * Get Incus daemon info (useful for connection testing)
   *
   * @returns {Promise<Object>} Incus server info
   * @throws {ContainerBackendError} When connection fails
   */
  async getInfo() {
    try {
      return await this.client._request('GET', '/1.0');
    } catch (err) {
      throw this._wrapError(
        `Failed to connect to Incus daemon: ${err.message}`,
        'getInfo',
        null,
        null,
        err
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Parse an image string into an Incus source configuration
   *
   * Supports formats:
   * - `images:ubuntu/24.04/cloud` → remote server "images", alias "ubuntu/24.04/cloud"
   * - `ubuntu/24.04` → local alias "ubuntu/24.04"
   *
   * @param {string} image - Image specification
   * @returns {Object} Incus source config for createInstance
   * @private
   */
  _parseImageSource(image) {
    if (image.includes(':')) {
      const colonIndex = image.indexOf(':');
      const server = image.slice(0, colonIndex);
      const alias = image.slice(colonIndex + 1);
      return {
        type: 'image',
        protocol: 'simplestreams',
        server: `https://images.linuxcontainers.org`,
        alias,
        ...(server !== 'images' ? { server: `https://${server}` } : {}),
      };
    }

    return {
      type: 'image',
      alias: image,
    };
  }

  /**
   * Wait for an instance to reach Running state
   *
   * @param {string} name - Instance name
   * @param {number} timeout - Timeout in milliseconds
   * @returns {Promise<void>}
   * @throws {ContainerBackendError} When timeout is reached
   * @private
   */
  async _waitForRunning(name, timeout) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        const state = await this.client.getInstanceState(name);
        if (state?.status === 'Running') {
          return;
        }
      } catch (_err) {
        // Instance might not be queryable yet, retry
      }

      // Wait 500ms before checking again
      await new Promise(resolve => globalThis.setTimeout(resolve, 500));
    }

    throw new ContainerBackendError('Container failed to start within timeout', {
      operation: 'startContainer',
      containerId: name,
      backend: this.type,
    });
  }

  /**
   * Check if an error indicates the instance was not found
   *
   * @param {Error} err - Error to check
   * @returns {boolean}
   * @private
   */
  _isNotFoundError(err) {
    if (err instanceof IncusClientError) {
      return err.statusCode === 404;
    }
    return err.message?.includes('not found') || err.message?.includes('Not Found');
  }

  /**
   * Check if an error indicates the instance is already stopped
   *
   * @param {Error} err - Error to check
   * @returns {boolean}
   * @private
   */
  _isAlreadyStoppedError(err) {
    if (err instanceof IncusClientError) {
      // Incus returns "The instance is already stopped" with 400 status
      return (
        err.statusCode === 400 &&
        (err.incusError?.includes('already stopped') || err.message?.includes('already stopped'))
      );
    }
    return false;
  }

  /**
   * Wrap an error in a ContainerBackendError
   *
   * @param {string} message - Error message
   * @param {string} operation - Operation name
   * @param {string|null} containerId - Container ID
   * @param {string|null} botId - Bot ID
   * @param {Error} cause - Original error
   * @returns {ContainerBackendError}
   * @private
   */
  _wrapError(message, operation, containerId, botId, cause) {
    return new ContainerBackendError(message, {
      operation,
      containerId,
      botId,
      backend: this.type,
      cause,
    });
  }
}
