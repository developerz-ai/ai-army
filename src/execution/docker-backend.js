/**
 * DockerBackend - Container backend adapter for Docker
 *
 * Thin adapter that wraps the existing DockerManager to implement
 * the ContainerBackend interface. Delegates all operations to
 * DockerManager without changing any behavior.
 *
 * @module execution/docker-backend
 */

import { ContainerBackend, BACKEND_TYPES } from './container-backend.js';
import { DockerManager } from './docker-manager.js';

/**
 * Docker implementation of the ContainerBackend interface
 *
 * @extends ContainerBackend
 * @example
 * const backend = new DockerBackend();
 * const container = await backend.createContainer(botConfig, workspace);
 * await backend.startContainer(container);
 * const result = await backend.exec(container, 'echo "hello"');
 * await backend.stopContainer(container);
 */
export class DockerBackend extends ContainerBackend {
  /**
   * Create a new DockerBackend instance
   *
   * @param {Object|string} [dockerHost] - Docker connection options
   *   If string: Unix socket path (e.g., '/var/run/docker.sock')
   *   If object: Docker connection options { host, port, socketPath, etc. }
   *   If undefined: Uses default Unix socket
   */
  constructor(dockerHost) {
    super(BACKEND_TYPES.DOCKER);
    this.manager = new DockerManager(dockerHost);
  }

  /**
   * Create a new container for a bot
   *
   * @param {Object} botConfig - Bot configuration
   * @param {string} botConfig.id - Unique bot identifier
   * @param {Object} [botConfig.sandbox] - Sandbox configuration
   * @param {Object} workspace - Workspace configuration
   * @param {string} workspace.root - Root path for workspace mount
   * @returns {Promise<Object>} Docker container object
   * @throws {DockerError} When container creation fails (preserved from DockerManager)
   */
  async createContainer(botConfig, workspace) {
    return this.manager.createContainer(botConfig, workspace);
  }

  /**
   * Start a container and wait for it to be ready
   *
   * @param {Object} container - Docker container object
   * @param {number} [timeout=10000] - Timeout in milliseconds
   * @returns {Promise<void>}
   * @throws {DockerError} When container fails to start
   */
  async startContainer(container, timeout) {
    return this.manager.startContainer(container, timeout);
  }

  /**
   * Stop and remove a container gracefully
   *
   * @param {Object} container - Docker container object
   * @param {number} [timeout=10] - Grace period in seconds before force kill
   * @returns {Promise<void>}
   * @throws {DockerError} When container fails to stop
   */
  async stopContainer(container, timeout) {
    return this.manager.stopContainer(container, timeout);
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
  async exec(container, command, options) {
    return this.manager.exec(container, command, options);
  }

  /**
   * Check if a container is running and responsive
   *
   * @param {Object} container - Docker container object
   * @returns {Promise<boolean>} True if container is healthy
   */
  async healthCheck(container) {
    return this.manager.healthCheck(container);
  }

  /**
   * Install packages in a running container
   *
   * @param {Object} container - Docker container object
   * @param {Array<string>} packages - Package names to install
   * @param {Object} [options={}] - Installation options
   * @param {number} [options.timeout=120000] - Timeout for package installation
   * @returns {Promise<void>}
   * @throws {DockerError} When package installation fails
   */
  async installPackages(container, packages, options) {
    return this.manager.installPackages(container, packages, options);
  }

  /**
   * Remove a container by name (with force)
   *
   * @param {string} name - Name of the container
   * @returns {Promise<boolean>} True if removed, false if not found
   * @throws {DockerError} When removal fails
   */
  async removeContainerByName(name) {
    return this.manager.removeContainerByName(name);
  }

  /**
   * List all containers managed by ai-army
   *
   * @param {Object} [options={}] - List options
   * @param {boolean} [options.all=true] - Include stopped containers
   * @returns {Promise<Array>} List of container info objects
   * @throws {DockerError} When listing fails
   */
  async listManagedContainers(options) {
    return this.manager.listManagedContainers(options);
  }

  /**
   * Get a container by bot ID
   *
   * @param {string} botId - Bot identifier
   * @returns {Promise<Object|null>} Docker container object or null if not found
   */
  async getContainerByBotId(botId) {
    return this.manager.getContainerByBotId(botId);
  }

  /**
   * Get Docker daemon info
   *
   * @returns {Promise<Object>} Docker daemon info
   * @throws {DockerError} When connection fails
   */
  async getInfo() {
    return this.manager.getInfo();
  }
}
