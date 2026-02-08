/**
 * SSHTunnelManager - SSH tunnel management for remote Docker access
 *
 * Creates and manages SSH tunnels to remote worker nodes, forwarding
 * a local TCP port to the remote Docker socket (`/var/run/docker.sock`).
 * This enables the master node to control Docker containers on remote
 * workers as if they were local.
 *
 * Features:
 * - Create SSH tunnels with local port forwarding to remote Docker sockets
 * - Health check tunnels via TCP connectivity verification
 * - Automatic reconnection with configurable retry policy
 * - Keep-alive for long-running tunnel connections
 * - Graceful tunnel teardown and resource cleanup
 *
 * Dependencies:
 * - ssh2: SSH client library for tunnel creation
 *
 * @module worker/ssh-tunnel
 */

import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { Client } from 'ssh2';

/**
 * Valid tunnel state values
 * @type {Readonly<Object>}
 */
export const TUNNEL_STATES = Object.freeze({
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting',
  CLOSED: 'closed',
  FAILED: 'failed',
});

/**
 * Default configuration values
 * @type {number}
 */
const DEFAULT_SSH_PORT = 22;
const DEFAULT_KEEPALIVE_INTERVAL_MS = 10_000;
const DEFAULT_KEEPALIVE_COUNT_MAX = 3;
const DEFAULT_RECONNECT_DELAY_MS = 2_000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 5;
const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_DOCKER_SOCKET_PATH = '/var/run/docker.sock';

/**
 * Custom error class for SSH tunnel failures
 */
export class SSHTunnelError extends Error {
  /**
   * Create an SSHTunnelError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - The operation that failed
   * @param {string} [options.workerId] - ID of the worker involved
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'SSHTunnelError';
    this.operation = options.operation;
    this.workerId = options.workerId;
  }
}

/**
 * SSHTunnelManager - manages SSH tunnels to remote Docker daemons
 *
 * @example
 * const manager = new SSHTunnelManager();
 *
 * // Create a tunnel to a remote worker
 * const tunnel = await manager.createTunnel({
 *   workerId: 'gpu-server',
 *   host: '192.168.1.100',
 *   port: 22,
 *   username: 'deploy',
 *   privateKeyPath: '~/.ssh/id_rsa',
 * });
 * // tunnel.dockerHost => 'tcp://127.0.0.1:54321'
 *
 * // Check tunnel health
 * const healthy = await manager.healthCheck('gpu-server');
 *
 * // Close tunnel when done
 * await manager.closeTunnel('gpu-server');
 */
export class SSHTunnelManager {
  /**
   * Create a new SSHTunnelManager instance
   *
   * @param {Object} [options={}] - Configuration options
   * @param {number} [options.keepAliveIntervalMs=10000] - SSH keep-alive interval in ms
   * @param {number} [options.keepAliveCountMax=3] - Max missed keep-alive before disconnect
   * @param {number} [options.reconnectDelayMs=2000] - Delay between reconnection attempts in ms
   * @param {number} [options.maxReconnectAttempts=5] - Maximum reconnection attempts before giving up
   * @param {number} [options.connectTimeoutMs=15000] - SSH connection timeout in ms
   * @param {Object} [options.logger=console] - Logger instance
   */
  constructor(options = {}) {
    /** @type {number} SSH keep-alive interval in ms */
    this.keepAliveIntervalMs = options.keepAliveIntervalMs || DEFAULT_KEEPALIVE_INTERVAL_MS;

    /** @type {number} Max missed keep-alive responses before considering connection dead */
    this.keepAliveCountMax = options.keepAliveCountMax || DEFAULT_KEEPALIVE_COUNT_MAX;

    /** @type {number} Delay between reconnection attempts in ms */
    this.reconnectDelayMs = options.reconnectDelayMs || DEFAULT_RECONNECT_DELAY_MS;

    /** @type {number} Maximum number of reconnection attempts */
    this.maxReconnectAttempts = options.maxReconnectAttempts || DEFAULT_MAX_RECONNECT_ATTEMPTS;

    /** @type {number} SSH connection timeout in ms */
    this.connectTimeoutMs = options.connectTimeoutMs || DEFAULT_CONNECT_TIMEOUT_MS;

    /** @type {Object} Logger instance */
    this.logger = options.logger || console;

    /** @type {Map<string, Object>} Map of workerId -> tunnel state */
    this.tunnels = new Map();
  }

  // ============================================================================
  // Tunnel Lifecycle
  // ============================================================================

  /**
   * Create an SSH tunnel to a remote worker's Docker socket
   *
   * Establishes an SSH connection to the remote host and creates a local
   * TCP server that forwards connections through the SSH tunnel to the
   * remote Docker socket. The resulting `dockerHost` URL can be used
   * with Dockerode to manage remote containers.
   *
   * @param {Object} config - Tunnel configuration
   * @param {string} config.workerId - Unique identifier for this worker tunnel
   * @param {string} config.host - Remote SSH host address
   * @param {number} [config.port=22] - Remote SSH port
   * @param {string} config.username - SSH username
   * @param {string} [config.privateKeyPath] - Path to SSH private key file
   * @param {string|Buffer} [config.privateKey] - SSH private key content directly
   * @param {string} [config.passphrase] - Passphrase for the private key
   * @param {string} [config.dockerSocketPath=/var/run/docker.sock] - Remote Docker socket path
   * @returns {Promise<Object>} Tunnel info with { workerId, dockerHost, localPort, state }
   * @throws {SSHTunnelError} If config validation fails or connection cannot be established
   */
  async createTunnel(config) {
    this._validateConfig(config);

    const { workerId } = config;

    // Check if tunnel already exists
    if (this.tunnels.has(workerId)) {
      const existing = this.tunnels.get(workerId);
      if (existing.state === TUNNEL_STATES.CONNECTED) {
        throw new SSHTunnelError(
          `Tunnel for worker '${workerId}' already exists and is connected`,
          {
            operation: 'createTunnel',
            workerId,
          }
        );
      }
      // Clean up stale tunnel entry before reconnecting
      await this._cleanupTunnel(workerId);
    }

    const tunnelEntry = {
      workerId,
      config: { ...config },
      state: TUNNEL_STATES.CONNECTING,
      connection: null,
      server: null,
      localPort: null,
      dockerHost: null,
      reconnectAttempts: 0,
      createdAt: new Date(),
    };

    this.tunnels.set(workerId, tunnelEntry);

    try {
      await this._establishTunnel(tunnelEntry);

      return {
        workerId: tunnelEntry.workerId,
        dockerHost: tunnelEntry.dockerHost,
        localPort: tunnelEntry.localPort,
        state: tunnelEntry.state,
      };
    } catch (err) {
      tunnelEntry.state = TUNNEL_STATES.FAILED;
      await this._cleanupTunnel(workerId);

      if (err instanceof SSHTunnelError) {
        throw err;
      }

      throw new SSHTunnelError(`Failed to create tunnel for worker '${workerId}': ${err.message}`, {
        cause: err,
        operation: 'createTunnel',
        workerId,
      });
    }
  }

  /**
   * Close an existing SSH tunnel for a worker
   *
   * Gracefully shuts down the local TCP server and SSH connection
   * associated with the specified worker, freeing all resources.
   *
   * @param {string} workerId - Worker identifier
   * @returns {Promise<boolean>} True if tunnel was closed, false if no tunnel found
   * @throws {SSHTunnelError} If workerId is invalid or cleanup fails
   */
  async closeTunnel(workerId) {
    if (!workerId || typeof workerId !== 'string') {
      throw new SSHTunnelError('Worker ID must be a non-empty string', {
        operation: 'closeTunnel',
      });
    }

    const tunnel = this.tunnels.get(workerId);
    if (!tunnel) {
      return false;
    }

    try {
      await this._cleanupTunnel(workerId);
      this.logger.info(`[SSHTunnelManager] Tunnel closed for worker '${workerId}'`);
      return true;
    } catch (err) {
      throw new SSHTunnelError(`Failed to close tunnel for worker '${workerId}': ${err.message}`, {
        cause: err,
        operation: 'closeTunnel',
        workerId,
      });
    }
  }

  /**
   * Close all open tunnels
   *
   * Gracefully shuts down all active SSH tunnels. Used during
   * application shutdown to clean up resources.
   *
   * @returns {Promise<Array<string>>} Array of worker IDs whose tunnels were closed
   */
  async closeAll() {
    const workerIds = [...this.tunnels.keys()];
    const closed = [];

    for (const workerId of workerIds) {
      try {
        await this.closeTunnel(workerId);
        closed.push(workerId);
      } catch (err) {
        this.logger.error(
          `[SSHTunnelManager] Error closing tunnel for worker '${workerId}': ${err.message}`
        );
      }
    }

    return closed;
  }

  // ============================================================================
  // Health Check
  // ============================================================================

  /**
   * Check the health of a tunnel for a specific worker
   *
   * Verifies that the SSH connection is still active and the local TCP
   * server is listening. Returns a health status object with details.
   *
   * @param {string} workerId - Worker identifier
   * @returns {Promise<Object>} Health status { workerId, healthy, state, dockerHost, localPort, uptime }
   * @throws {SSHTunnelError} If workerId is invalid
   */
  async healthCheck(workerId) {
    if (!workerId || typeof workerId !== 'string') {
      throw new SSHTunnelError('Worker ID must be a non-empty string', {
        operation: 'healthCheck',
      });
    }

    const tunnel = this.tunnels.get(workerId);
    if (!tunnel) {
      return {
        workerId,
        healthy: false,
        state: TUNNEL_STATES.CLOSED,
        dockerHost: null,
        localPort: null,
        uptime: null,
        error: 'No tunnel found',
      };
    }

    const isConnected = tunnel.state === TUNNEL_STATES.CONNECTED;
    const hasActiveConnection = tunnel.connection !== null;
    const hasActiveServer = tunnel.server !== null && tunnel.server.listening;
    const healthy = isConnected && hasActiveConnection && hasActiveServer;

    const uptime = tunnel.createdAt ? Date.now() - tunnel.createdAt.getTime() : null;

    return {
      workerId,
      healthy,
      state: tunnel.state,
      dockerHost: tunnel.dockerHost,
      localPort: tunnel.localPort,
      uptime,
    };
  }

  /**
   * Get the Docker host URL for a worker's tunnel
   *
   * @param {string} workerId - Worker identifier
   * @returns {string|null} Docker host URL (e.g., 'tcp://127.0.0.1:54321') or null
   */
  getDockerHost(workerId) {
    const tunnel = this.tunnels.get(workerId);
    if (!tunnel || tunnel.state !== TUNNEL_STATES.CONNECTED) {
      return null;
    }
    return tunnel.dockerHost;
  }

  /**
   * List all active tunnels with their status
   *
   * @returns {Array<Object>} Array of tunnel status objects
   */
  listTunnels() {
    const tunnels = [];
    for (const [workerId, tunnel] of this.tunnels) {
      tunnels.push({
        workerId,
        state: tunnel.state,
        dockerHost: tunnel.dockerHost,
        localPort: tunnel.localPort,
        host: tunnel.config.host,
        reconnectAttempts: tunnel.reconnectAttempts,
        createdAt: tunnel.createdAt,
      });
    }
    return tunnels;
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Validate tunnel configuration
   *
   * @param {Object} config - Tunnel configuration to validate
   * @throws {SSHTunnelError} If configuration is invalid
   * @private
   */
  _validateConfig(config) {
    if (!config || typeof config !== 'object') {
      throw new SSHTunnelError('Tunnel config must be a non-null object', {
        operation: 'createTunnel',
      });
    }

    const { workerId, host, username } = config;

    if (!workerId || typeof workerId !== 'string') {
      throw new SSHTunnelError('Worker ID must be a non-empty string', {
        operation: 'createTunnel',
      });
    }

    if (!host || typeof host !== 'string') {
      throw new SSHTunnelError('Host must be a non-empty string', {
        operation: 'createTunnel',
        workerId,
      });
    }

    if (!username || typeof username !== 'string') {
      throw new SSHTunnelError('Username must be a non-empty string', {
        operation: 'createTunnel',
        workerId,
      });
    }

    if (!config.privateKeyPath && !config.privateKey) {
      throw new SSHTunnelError('Either privateKeyPath or privateKey must be provided', {
        operation: 'createTunnel',
        workerId,
      });
    }
  }

  /**
   * Read the SSH private key from config
   *
   * Supports both direct key content and file path.
   * Redacts key content from error messages.
   *
   * @param {Object} config - Tunnel configuration
   * @returns {string|Buffer} Private key content
   * @throws {SSHTunnelError} If key cannot be read
   * @private
   */
  _readPrivateKey(config) {
    if (config.privateKey) {
      return config.privateKey;
    }

    try {
      return readFileSync(config.privateKeyPath);
    } catch (err) {
      throw new SSHTunnelError(
        `Failed to read SSH private key from '${config.privateKeyPath}': ${err.message}`,
        {
          cause: err,
          operation: 'createTunnel',
          workerId: config.workerId,
        }
      );
    }
  }

  /**
   * Establish the SSH tunnel and local TCP forwarding server
   *
   * Creates an SSH connection, then starts a local TCP server that
   * forwards incoming connections through the SSH channel to the
   * remote Docker socket.
   *
   * @param {Object} tunnelEntry - Internal tunnel state object
   * @returns {Promise<void>}
   * @private
   */
  async _establishTunnel(tunnelEntry) {
    const { config } = tunnelEntry;
    const privateKey = this._readPrivateKey(config);
    const dockerSocketPath = config.dockerSocketPath || DEFAULT_DOCKER_SOCKET_PATH;
    const port = config.port || DEFAULT_SSH_PORT;

    const connection = await this._createSSHConnection({
      host: config.host,
      port,
      username: config.username,
      privateKey,
      passphrase: config.passphrase,
    });

    tunnelEntry.connection = connection;

    // Create local TCP server that forwards to remote Docker socket
    const localPort = await this._createForwardingServer(tunnelEntry, dockerSocketPath);

    tunnelEntry.localPort = localPort;
    tunnelEntry.dockerHost = `tcp://127.0.0.1:${localPort}`;
    tunnelEntry.state = TUNNEL_STATES.CONNECTED;

    // Set up connection event handlers for reconnection
    this._setupConnectionHandlers(tunnelEntry);

    this.logger.info(
      `[SSHTunnelManager] Tunnel established for worker '${config.workerId}': ` +
        `${config.host}:${port} -> 127.0.0.1:${localPort} ` +
        `(forwarding to ${dockerSocketPath})`
    );
  }

  /**
   * Create an SSH connection to the remote host
   *
   * @param {Object} sshConfig - SSH connection configuration
   * @returns {Promise<Client>} Connected SSH client
   * @private
   */
  _createSSHConnection(sshConfig) {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      let settled = false;

      const timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true;
          conn.end();
          reject(
            new SSHTunnelError(
              `SSH connection to ${sshConfig.host}:${sshConfig.port} timed out after ${this.connectTimeoutMs}ms`,
              { operation: 'createTunnel' }
            )
          );
        }
      }, this.connectTimeoutMs);

      conn.on('ready', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutId);
          resolve(conn);
        }
      });

      conn.on('error', err => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutId);
          reject(
            new SSHTunnelError(
              `SSH connection to ${sshConfig.host}:${sshConfig.port} failed: ${err.message}`,
              { cause: err, operation: 'createTunnel' }
            )
          );
        }
      });

      conn.connect({
        host: sshConfig.host,
        port: sshConfig.port,
        username: sshConfig.username,
        privateKey: sshConfig.privateKey,
        passphrase: sshConfig.passphrase,
        keepaliveInterval: this.keepAliveIntervalMs,
        keepaliveCountMax: this.keepAliveCountMax,
        readyTimeout: this.connectTimeoutMs,
      });
    });
  }

  /**
   * Create a local TCP server that forwards connections through SSH to the remote Docker socket
   *
   * Each incoming TCP connection triggers an SSH forwardOut to the remote
   * Unix socket, creating a bidirectional stream pipe.
   *
   * @param {Object} tunnelEntry - Internal tunnel state object
   * @param {string} dockerSocketPath - Remote Docker socket path
   * @returns {Promise<number>} Local port number the server is listening on
   * @private
   */
  _createForwardingServer(tunnelEntry, dockerSocketPath) {
    return new Promise((resolve, reject) => {
      const server = createServer(clientSocket => {
        if (!tunnelEntry.connection) {
          clientSocket.destroy();
          return;
        }

        tunnelEntry.connection.openssh_forwardOutStreamLocal(dockerSocketPath, (err, stream) => {
          if (err) {
            this.logger.error(
              `[SSHTunnelManager] Forward error for worker '${tunnelEntry.workerId}': ${err.message}`
            );
            clientSocket.destroy();
            return;
          }

          // Pipe data bidirectionally between local client and remote socket
          stream.pipe(clientSocket).pipe(stream);

          stream.on('error', streamErr => {
            this.logger.error(
              `[SSHTunnelManager] Stream error for worker '${tunnelEntry.workerId}': ${streamErr.message}`
            );
            clientSocket.destroy();
          });

          clientSocket.on('error', socketErr => {
            this.logger.error(
              `[SSHTunnelManager] Socket error for worker '${tunnelEntry.workerId}': ${socketErr.message}`
            );
            stream.destroy();
          });

          stream.on('close', () => {
            clientSocket.destroy();
          });

          clientSocket.on('close', () => {
            stream.destroy();
          });
        });
      });

      server.on('error', err => {
        reject(
          new SSHTunnelError(`Failed to create local forwarding server: ${err.message}`, {
            cause: err,
            operation: 'createTunnel',
            workerId: tunnelEntry.workerId,
          })
        );
      });

      // Listen on a random available port on localhost
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address();
        tunnelEntry.server = server;
        resolve(port);
      });
    });
  }

  /**
   * Set up SSH connection event handlers for error detection and reconnection
   *
   * @param {Object} tunnelEntry - Internal tunnel state object
   * @private
   */
  _setupConnectionHandlers(tunnelEntry) {
    const { connection, workerId } = tunnelEntry;

    connection.on('error', err => {
      this.logger.error(
        `[SSHTunnelManager] Connection error for worker '${workerId}': ${err.message}`
      );
      this._handleDisconnect(tunnelEntry);
    });

    connection.on('end', () => {
      this.logger.warn(`[SSHTunnelManager] Connection ended for worker '${workerId}'`);
      this._handleDisconnect(tunnelEntry);
    });

    connection.on('close', () => {
      this.logger.warn(`[SSHTunnelManager] Connection closed for worker '${workerId}'`);
      this._handleDisconnect(tunnelEntry);
    });
  }

  /**
   * Handle an unexpected tunnel disconnection
   *
   * Attempts to reconnect up to maxReconnectAttempts times with
   * exponential backoff. If reconnection fails, marks the tunnel as failed.
   *
   * @param {Object} tunnelEntry - Internal tunnel state object
   * @private
   */
  async _handleDisconnect(tunnelEntry) {
    const { workerId } = tunnelEntry;

    // Avoid double-handling
    if (
      tunnelEntry.state === TUNNEL_STATES.RECONNECTING ||
      tunnelEntry.state === TUNNEL_STATES.CLOSED
    ) {
      return;
    }

    tunnelEntry.state = TUNNEL_STATES.RECONNECTING;

    this.logger.info(
      `[SSHTunnelManager] Attempting to reconnect tunnel for worker '${workerId}'...`
    );

    // Close existing server but keep the tunnel entry
    await this._closeServer(tunnelEntry);
    this._closeConnection(tunnelEntry);

    while (tunnelEntry.reconnectAttempts < this.maxReconnectAttempts) {
      tunnelEntry.reconnectAttempts += 1;
      const attempt = tunnelEntry.reconnectAttempts;

      // Exponential backoff: delay * 2^(attempt-1)
      const delay = this.reconnectDelayMs * Math.pow(2, attempt - 1);

      this.logger.info(
        `[SSHTunnelManager] Reconnect attempt ${attempt}/${this.maxReconnectAttempts} ` +
          `for worker '${workerId}' in ${delay}ms`
      );

      await this._sleep(delay);

      // If tunnel was explicitly closed during reconnection, stop
      if (tunnelEntry.state === TUNNEL_STATES.CLOSED) {
        return;
      }

      try {
        await this._establishTunnel(tunnelEntry);
        tunnelEntry.reconnectAttempts = 0;
        this.logger.info(
          `[SSHTunnelManager] Reconnected tunnel for worker '${workerId}' on attempt ${attempt}`
        );
        return;
      } catch (err) {
        this.logger.error(
          `[SSHTunnelManager] Reconnect attempt ${attempt} failed for worker '${workerId}': ${err.message}`
        );
      }
    }

    // All reconnection attempts exhausted
    tunnelEntry.state = TUNNEL_STATES.FAILED;
    this.logger.error(
      `[SSHTunnelManager] All ${this.maxReconnectAttempts} reconnect attempts exhausted ` +
        `for worker '${workerId}'. Tunnel marked as failed.`
    );
  }

  /**
   * Clean up all resources for a tunnel
   *
   * @param {string} workerId - Worker identifier
   * @private
   */
  async _cleanupTunnel(workerId) {
    const tunnel = this.tunnels.get(workerId);
    if (!tunnel) {
      return;
    }

    tunnel.state = TUNNEL_STATES.CLOSED;

    await this._closeServer(tunnel);
    this._closeConnection(tunnel);

    this.tunnels.delete(workerId);
  }

  /**
   * Close the local TCP forwarding server
   *
   * @param {Object} tunnelEntry - Internal tunnel state object
   * @returns {Promise<void>}
   * @private
   */
  _closeServer(tunnelEntry) {
    return new Promise(resolve => {
      if (!tunnelEntry.server) {
        resolve();
        return;
      }

      tunnelEntry.server.close(() => {
        tunnelEntry.server = null;
        resolve();
      });

      // Force close after 5 seconds
      setTimeout(() => {
        tunnelEntry.server = null;
        resolve();
      }, 5_000);
    });
  }

  /**
   * Close the SSH connection
   *
   * @param {Object} tunnelEntry - Internal tunnel state object
   * @private
   */
  _closeConnection(tunnelEntry) {
    if (tunnelEntry.connection) {
      try {
        tunnelEntry.connection.end();
      } catch (_err) {
        // Ignore errors during cleanup
      }
      tunnelEntry.connection = null;
    }
  }

  /**
   * Utility sleep function for reconnection delays
   *
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   * @private
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
