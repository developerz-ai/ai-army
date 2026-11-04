/**
 * MCPClient - wrapper around @modelcontextprotocol/sdk Client
 *
 * Provides a simplified interface for connecting to MCP servers via
 * stdio transport, discovering available tools, calling tools, and
 * disconnecting cleanly. Handles connection timeouts, protocol errors,
 * and graceful cleanup.
 *
 * @module mcp/mcp-client
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/**
 * Connection lifecycle states
 */
const CONNECTION_STATES = Object.freeze({
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  DISCONNECTING: 'disconnecting',
  ERROR: 'error',
});

/**
 * Default configuration values
 */
const CLIENT_DEFAULTS = Object.freeze({
  CLIENT_NAME: 'ai-army',
  CLIENT_VERSION: '0.1.0',
  CONNECT_TIMEOUT_MS: 30000,
  CALL_TIMEOUT_MS: 30000,
});

/**
 * Custom error for MCP client failures
 *
 * @example
 * throw new MCPClientError('Connection timed out', {
 *   operation: 'connect',
 *   cause: originalError,
 * });
 */
export class MCPClientError extends Error {
  /**
   * Create an MCPClientError
   *
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - The operation that failed
   * @param {string} [options.toolName] - Name of the tool involved, if applicable
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'MCPClientError';
    this.operation = options.operation;
    this.toolName = options.toolName;
  }
}

/**
 * MCPClient - wraps @modelcontextprotocol/sdk Client for MCP server communication
 *
 * Manages a single connection to an MCP server. Provides methods for
 * connecting via a transport, listing available tools, calling tools
 * with parameters, and disconnecting.
 *
 * @example
 * const client = new MCPClient({ logger: console.log });
 * await client.connect({
 *   command: 'npx',
 *   args: ['-y', '@modelcontextprotocol/server-filesystem'],
 *   env: { ALLOWED_PATHS: '/workspace' },
 * });
 * const tools = await client.listTools();
 * const result = await client.callTool('readFile', { path: '/workspace/README.md' });
 * await client.disconnect();
 */
export class MCPClient {
  /**
   * Create an MCPClient instance
   *
   * @param {Object} [options={}] - Configuration options
   * @param {Function|null} [options.logger=null] - Logger function for status messages
   * @param {string} [options.clientName='ai-army'] - Client name for MCP handshake
   * @param {string} [options.clientVersion='0.1.0'] - Client version for MCP handshake
   * @param {number} [options.connectTimeoutMs=30000] - Timeout for connection in ms
   * @param {number} [options.callTimeoutMs=30000] - Timeout for tool calls in ms
   */
  constructor(options = {}) {
    /** @type {Function|null} Logger function */
    this.logger = options.logger || null;

    /** @type {string} Client name for MCP protocol handshake */
    this.clientName = options.clientName ?? CLIENT_DEFAULTS.CLIENT_NAME;

    /** @type {string} Client version for MCP protocol handshake */
    this.clientVersion = options.clientVersion ?? CLIENT_DEFAULTS.CLIENT_VERSION;

    /** @type {number} Connection timeout in ms */
    this.connectTimeoutMs = options.connectTimeoutMs ?? CLIENT_DEFAULTS.CONNECT_TIMEOUT_MS;

    /** @type {number} Tool call timeout in ms */
    this.callTimeoutMs = options.callTimeoutMs ?? CLIENT_DEFAULTS.CALL_TIMEOUT_MS;

    /** @type {Client|null} Internal MCP SDK client instance */
    this._client = null;

    /** @type {StdioClientTransport|null} Transport instance */
    this._transport = null;

    /** @type {string} Current connection state */
    this._state = CONNECTION_STATES.DISCONNECTED;

    /** @type {Object|null} Server capabilities from handshake */
    this._serverCapabilities = null;

    /** @type {Object|null} Server version info from handshake */
    this._serverVersion = null;
  }

  /**
   * Get the current connection state
   *
   * @returns {string} One of CONNECTION_STATES values
   */
  get state() {
    return this._state;
  }

  /**
   * Check if the client is currently connected
   *
   * @returns {boolean} True if in CONNECTED state
   */
  get isConnected() {
    return this._state === CONNECTION_STATES.CONNECTED;
  }

  /**
   * Get server capabilities (available after connect)
   *
   * @returns {Object|null} Server capabilities or null if not connected
   */
  get serverCapabilities() {
    return this._serverCapabilities;
  }

  /**
   * Get server version info (available after connect)
   *
   * @returns {Object|null} Server version info or null if not connected
   */
  get serverVersion() {
    return this._serverVersion;
  }

  /**
   * Connect to an MCP server using stdio transport
   *
   * Creates a StdioClientTransport from the provided server parameters,
   * initializes an MCP SDK Client, and performs the protocol handshake.
   * Applies a configurable connection timeout.
   *
   * @param {Object} serverParams - Server connection parameters
   * @param {string} serverParams.command - Command to spawn the server process
   * @param {string[]} [serverParams.args=[]] - Arguments for the command
   * @param {Object} [serverParams.env={}] - Environment variables for the process
   * @param {string} [serverParams.cwd] - Working directory for the process
   * @returns {Promise<void>}
   * @throws {MCPClientError} If already connected, params are invalid, or connection fails
   */
  async connect(serverParams) {
    if (this._state === CONNECTION_STATES.CONNECTED) {
      throw new MCPClientError('Client is already connected; call disconnect() first', {
        operation: 'connect',
      });
    }

    if (this._state === CONNECTION_STATES.CONNECTING) {
      throw new MCPClientError('Connection is already in progress', {
        operation: 'connect',
      });
    }

    this._validateServerParams(serverParams);

    this._state = CONNECTION_STATES.CONNECTING;

    try {
      // Create stdio transport
      const transport = new StdioClientTransport({
        command: serverParams.command,
        args: serverParams.args || [],
        env: { ...process.env, ...(serverParams.env || {}) },
        stderr: 'pipe',
        cwd: serverParams.cwd,
      });

      // Create MCP client
      const client = new Client(
        { name: this.clientName, version: this.clientVersion },
        { capabilities: {} }
      );

      // Connect with timeout
      await this._connectWithTimeout(client, transport);

      // Store references
      this._client = client;
      this._transport = transport;

      // Capture server info
      this._serverCapabilities = client.getServerCapabilities() || null;
      this._serverVersion = client.getServerVersion() || null;

      // Set up transport close handler
      this._setupCloseHandler(transport);

      this._state = CONNECTION_STATES.CONNECTED;
      this._log('Connected to MCP server');
    } catch (err) {
      this._state = CONNECTION_STATES.ERROR;
      this._cleanup();

      if (err instanceof MCPClientError) {
        throw err;
      }

      throw new MCPClientError(`Failed to connect: ${err.message}`, {
        cause: err,
        operation: 'connect',
      });
    }
  }

  /**
   * List all tools available on the connected MCP server
   *
   * @returns {Promise<Array<Object>>} Array of MCP tool definitions
   * @throws {MCPClientError} If not connected or listing fails
   */
  async listTools() {
    this._assertConnected('listTools');

    try {
      const result = await this._client.listTools();
      return result.tools || [];
    } catch (err) {
      if (err instanceof MCPClientError) {
        throw err;
      }

      throw new MCPClientError(`Failed to list tools: ${err.message}`, {
        cause: err,
        operation: 'listTools',
      });
    }
  }

  /**
   * Call a tool on the connected MCP server
   *
   * @param {string} name - Name of the tool to call
   * @param {Object} [params={}] - Parameters to pass to the tool
   * @returns {Promise<Object>} Tool call result from the server
   * @throws {MCPClientError} If not connected, name is invalid, or call fails
   */
  async callTool(name, params = {}) {
    this._assertConnected('callTool');

    if (!name || typeof name !== 'string') {
      throw new MCPClientError('Tool name must be a non-empty string', {
        operation: 'callTool',
      });
    }

    try {
      const result = await this._client.callTool({ name, arguments: params }, undefined, {
        timeout: this.callTimeoutMs,
      });

      // Check for server-side error in result
      if (result.isError) {
        const errorText = this._extractTextContent(result.content);
        throw new MCPClientError(`Tool '${name}' returned an error: ${errorText}`, {
          operation: 'callTool',
          toolName: name,
        });
      }

      return result;
    } catch (err) {
      if (err instanceof MCPClientError) {
        throw err;
      }

      throw new MCPClientError(`Failed to call tool '${name}': ${err.message}`, {
        cause: err,
        operation: 'callTool',
        toolName: name,
      });
    }
  }

  /**
   * Disconnect from the MCP server
   *
   * Gracefully closes the client connection and transport.
   * Safe to call even if already disconnected.
   *
   * @returns {Promise<void>}
   * @throws {MCPClientError} If disconnect fails catastrophically
   */
  async disconnect() {
    if (
      this._state === CONNECTION_STATES.DISCONNECTED ||
      this._state === CONNECTION_STATES.DISCONNECTING
    ) {
      return;
    }

    this._state = CONNECTION_STATES.DISCONNECTING;

    try {
      // Close client connection
      if (this._client) {
        try {
          await this._client.close();
        } catch (_err) {
          // Client may already be disconnected
        }
      }

      // Close transport (kills child process)
      if (this._transport) {
        try {
          await this._transport.close();
        } catch (_err) {
          // Transport may already be closed
        }
      }

      this._cleanup();
      this._state = CONNECTION_STATES.DISCONNECTED;
      this._log('Disconnected from MCP server');
    } catch (err) {
      this._state = CONNECTION_STATES.ERROR;
      this._cleanup();

      throw new MCPClientError(`Failed to disconnect: ${err.message}`, {
        cause: err,
        operation: 'disconnect',
      });
    }
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  /**
   * Validate server connection parameters
   *
   * @param {Object} params - Server parameters to validate
   * @throws {MCPClientError} If params are invalid
   * @private
   */
  _validateServerParams(params) {
    if (!params || typeof params !== 'object') {
      throw new MCPClientError('Server params must be a non-null object', {
        operation: 'connect',
      });
    }

    if (!params.command || typeof params.command !== 'string') {
      throw new MCPClientError('Server params must include a non-empty string "command"', {
        operation: 'connect',
      });
    }

    if (params.args !== undefined && !Array.isArray(params.args)) {
      throw new MCPClientError('Server params "args" must be an array if provided', {
        operation: 'connect',
      });
    }

    if (params.env !== undefined && (typeof params.env !== 'object' || params.env === null)) {
      throw new MCPClientError('Server params "env" must be an object if provided', {
        operation: 'connect',
      });
    }
  }

  /**
   * Connect client to transport with a timeout
   *
   * @param {Client} client - MCP SDK client
   * @param {StdioClientTransport} transport - Stdio transport
   * @returns {Promise<void>}
   * @throws {MCPClientError} If connection times out
   * @private
   */
  async _connectWithTimeout(client, transport) {
    let timer;
    const timeoutPromise = new Promise((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(
          new MCPClientError(`Connection timed out after ${this.connectTimeoutMs}ms`, {
            operation: 'connect',
          })
        );
      }, this.connectTimeoutMs);
    });

    try {
      await Promise.race([client.connect(transport), timeoutPromise]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Set up handler for unexpected transport close
   *
   * @param {StdioClientTransport} transport - Transport to monitor
   * @private
   */
  _setupCloseHandler(transport) {
    const originalOnClose = transport.onclose;
    transport.onclose = () => {
      if (originalOnClose) {
        originalOnClose();
      }

      // Only mark as error if we were connected (not intentionally disconnecting)
      if (this._state === CONNECTION_STATES.CONNECTED) {
        this._state = CONNECTION_STATES.ERROR;
        this._log('MCP server connection closed unexpectedly');
      }
    };
  }

  /**
   * Assert that the client is in a connected state
   *
   * @param {string} operation - Name of the operation requiring connection
   * @throws {MCPClientError} If not connected
   * @private
   */
  _assertConnected(operation) {
    if (this._state !== CONNECTION_STATES.CONNECTED) {
      throw new MCPClientError(
        `Cannot ${operation}: client is not connected (state: ${this._state})`,
        { operation }
      );
    }

    if (!this._client) {
      throw new MCPClientError(`Cannot ${operation}: internal client is not available`, {
        operation,
      });
    }
  }

  /**
   * Extract text content from MCP result content array
   *
   * @param {Array<Object>} content - MCP content array
   * @returns {string} Combined text content
   * @private
   */
  _extractTextContent(content) {
    if (!Array.isArray(content)) {
      return 'Unknown error';
    }

    return (
      content
        .filter(item => item.type === 'text')
        .map(item => item.text)
        .join('\n') || 'Unknown error'
    );
  }

  /**
   * Clean up internal references
   *
   * @private
   */
  _cleanup() {
    this._client = null;
    this._transport = null;
    this._serverCapabilities = null;
    this._serverVersion = null;
  }

  /**
   * Log a message if logger is available
   *
   * @param {string} message - Message to log
   * @private
   */
  _log(message) {
    if (this.logger) {
      this.logger(message);
    }
  }
}

export { CONNECTION_STATES, CLIENT_DEFAULTS };
