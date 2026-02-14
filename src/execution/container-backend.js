/**
 * ContainerBackend - Abstract interface for container backends
 *
 * Defines the contract that all container backends (Docker, Incus, etc.)
 * must implement. Provides a pluggable architecture for container management
 * using the Strategy Pattern.
 *
 * @module execution/container-backend
 */

/**
 * Backend type constants
 * @enum {string}
 */
export const BACKEND_TYPES = {
  DOCKER: 'docker',
  INCUS: 'incus',
  JUST_BASH: 'just-bash',
};

/**
 * Custom error class for container backend errors
 */
export class ContainerBackendError extends Error {
  /**
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {string} [options.operation] - The operation that failed
   * @param {string} [options.containerId] - Container ID if applicable
   * @param {string} [options.botId] - Bot ID if applicable
   * @param {string} [options.backend] - Backend type that produced the error
   * @param {Error} [options.cause] - Original error that caused this
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'ContainerBackendError';
    this.operation = options.operation;
    this.containerId = options.containerId;
    this.botId = options.botId;
    this.backend = options.backend;
  }
}

/**
 * Abstract base class for container backends
 *
 * All container backends must extend this class and implement every method.
 * Calling any unimplemented method throws a `ContainerBackendError`.
 *
 * @abstract
 * @example
 * class MyBackend extends ContainerBackend {
 *   async createContainer(botConfig, workspace) {
 *     // implementation
 *   }
 *   // ... implement all abstract methods
 * }
 */
export class ContainerBackend {
  /**
   * Create a new ContainerBackend instance
   *
   * @param {string} type - Backend type from BACKEND_TYPES
   */
  constructor(type) {
    if (new.target === ContainerBackend) {
      throw new ContainerBackendError(
        'ContainerBackend is abstract and cannot be instantiated directly',
        { operation: 'constructor' }
      );
    }
    this.type = type;
  }

  /**
   * Create a new container for a bot
   *
   * @abstract
   * @param {Object} botConfig - Bot configuration
   * @param {string} botConfig.id - Unique bot identifier
   * @param {Object} [botConfig.sandbox] - Sandbox configuration
   * @param {Object} workspace - Workspace configuration
   * @param {string} workspace.root - Root path for workspace mount
   * @returns {Promise<Object>} Container object (backend-specific)
   * @throws {ContainerBackendError} When container creation fails
   */
  async createContainer(_botConfig, _workspace) {
    throw new ContainerBackendError(
      `createContainer() not implemented by ${this.constructor.name}`,
      { operation: 'createContainer', backend: this.type }
    );
  }

  /**
   * Start a container and wait for it to be ready
   *
   * @abstract
   * @param {Object} container - Container object returned by createContainer
   * @param {number} [timeout=10000] - Timeout in milliseconds
   * @returns {Promise<void>}
   * @throws {ContainerBackendError} When container fails to start
   */
  async startContainer(_container, _timeout) {
    throw new ContainerBackendError(
      `startContainer() not implemented by ${this.constructor.name}`,
      { operation: 'startContainer', backend: this.type }
    );
  }

  /**
   * Stop and remove a container gracefully
   *
   * @abstract
   * @param {Object} container - Container object
   * @param {number} [timeout=10] - Grace period in seconds before force kill
   * @returns {Promise<void>}
   * @throws {ContainerBackendError} When container fails to stop
   */
  async stopContainer(_container, _timeout) {
    throw new ContainerBackendError(`stopContainer() not implemented by ${this.constructor.name}`, {
      operation: 'stopContainer',
      backend: this.type,
    });
  }

  /**
   * Execute a command in a running container
   *
   * @abstract
   * @param {Object} container - Container object
   * @param {string} command - Bash command to execute
   * @param {Object} [options={}] - Execution options
   * @param {number} [options.timeout=30000] - Command timeout in milliseconds
   * @param {string} [options.user] - User to run command as
   * @param {string} [options.workingDir='/home/agent'] - Working directory
   * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
   * @throws {ContainerBackendError} When execution fails
   */
  async exec(_container, _command, _options) {
    throw new ContainerBackendError(`exec() not implemented by ${this.constructor.name}`, {
      operation: 'exec',
      backend: this.type,
    });
  }

  /**
   * Check if a container is running and responsive
   *
   * @abstract
   * @param {Object} container - Container object
   * @returns {Promise<boolean>} True if container is healthy
   */
  async healthCheck(_container) {
    throw new ContainerBackendError(`healthCheck() not implemented by ${this.constructor.name}`, {
      operation: 'healthCheck',
      backend: this.type,
    });
  }

  /**
   * Install packages in a running container
   *
   * @abstract
   * @param {Object} container - Container object
   * @param {Array<string>} packages - Package names to install
   * @param {Object} [options={}] - Installation options
   * @param {number} [options.timeout=120000] - Timeout for package installation
   * @returns {Promise<void>}
   * @throws {ContainerBackendError} When package installation fails
   */
  async installPackages(_container, _packages, _options) {
    throw new ContainerBackendError(
      `installPackages() not implemented by ${this.constructor.name}`,
      { operation: 'installPackages', backend: this.type }
    );
  }

  /**
   * Remove a container by name (with force)
   *
   * @abstract
   * @param {string} name - Name of the container
   * @returns {Promise<boolean>} True if removed, false if not found
   * @throws {ContainerBackendError} When removal fails
   */
  async removeContainerByName(_name) {
    throw new ContainerBackendError(
      `removeContainerByName() not implemented by ${this.constructor.name}`,
      { operation: 'removeContainerByName', backend: this.type }
    );
  }

  /**
   * List all containers managed by ai-army
   *
   * @abstract
   * @param {Object} [options={}] - List options
   * @param {boolean} [options.all=true] - Include stopped containers
   * @returns {Promise<Array>} List of container info objects
   * @throws {ContainerBackendError} When listing fails
   */
  async listManagedContainers(_options) {
    throw new ContainerBackendError(
      `listManagedContainers() not implemented by ${this.constructor.name}`,
      { operation: 'listManagedContainers', backend: this.type }
    );
  }

  /**
   * Get a container by bot ID
   *
   * @abstract
   * @param {string} botId - Bot identifier
   * @returns {Promise<Object|null>} Container object or null if not found
   */
  async getContainerByBotId(_botId) {
    throw new ContainerBackendError(
      `getContainerByBotId() not implemented by ${this.constructor.name}`,
      { operation: 'getContainerByBotId', backend: this.type }
    );
  }

  /**
   * Get backend/daemon info (useful for connection testing)
   *
   * @abstract
   * @returns {Promise<Object>} Backend daemon info
   * @throws {ContainerBackendError} When connection fails
   */
  async getInfo() {
    throw new ContainerBackendError(`getInfo() not implemented by ${this.constructor.name}`, {
      operation: 'getInfo',
      backend: this.type,
    });
  }
}
