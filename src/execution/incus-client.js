/**
 * IncusClient - Low-level REST API client for the Incus container daemon
 *
 * Communicates with the Incus daemon via Unix socket using the Node.js
 * built-in `http` module. No external dependencies required.
 *
 * Incus exposes a REST API on `/var/lib/incus/unix.socket` (by default).
 * Many operations are asynchronous — Incus returns HTTP 202 with an
 * operation ID, which must be polled via `/1.0/operations/{id}/wait`.
 *
 * @module execution/incus-client
 * @see https://linuxcontainers.org/incus/docs/main/rest-api/
 *
 * @example
 * const client = new IncusClient();
 * await client.createInstance('my-container', {
 *   source: { type: 'image', alias: 'ubuntu/24.04' },
 * });
 * await client.startInstance('my-container');
 * const result = await client.execCommand('my-container', ['echo', 'hello']);
 * await client.stopInstance('my-container');
 * await client.deleteInstance('my-container');
 */

import http from 'node:http';

/** Default Incus Unix socket path */
const DEFAULT_SOCKET_PATH = '/var/lib/incus/unix.socket';

/** Default timeout for waiting on async operations (ms) */
const DEFAULT_OPERATION_TIMEOUT = 60_000;

/** Default timeout for individual HTTP requests (ms) */
const DEFAULT_REQUEST_TIMEOUT = 30_000;

/**
 * Custom error class for IncusClient-related errors
 */
export class IncusClientError extends Error {
  /**
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {string} [options.operation] - The API operation that failed
   * @param {string} [options.instanceName] - Instance name if applicable
   * @param {number} [options.statusCode] - HTTP status code from Incus
   * @param {string} [options.incusError] - Error message from Incus daemon
   * @param {Error} [options.cause] - Original error that caused this
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'IncusClientError';
    this.operation = options.operation;
    this.instanceName = options.instanceName;
    this.statusCode = options.statusCode;
    this.incusError = options.incusError;
  }
}

/**
 * Low-level REST API client for the Incus container daemon
 *
 * All methods communicate with Incus via HTTP over a Unix socket.
 * Async Incus operations (those returning HTTP 202) are automatically
 * awaited by polling the operation endpoint.
 *
 * @example
 * // Default socket path
 * const client = new IncusClient();
 *
 * // Custom socket path
 * const client = new IncusClient({ socketPath: '/custom/incus.socket' });
 *
 * // With custom timeouts
 * const client = new IncusClient({
 *   operationTimeout: 120_000,
 *   requestTimeout: 60_000,
 * });
 */
export class IncusClient {
  /**
   * Create a new IncusClient instance
   *
   * @param {Object} [options={}] - Client configuration
   * @param {string} [options.socketPath='/var/lib/incus/unix.socket'] - Path to Incus Unix socket
   * @param {number} [options.operationTimeout=60000] - Timeout for async operation wait (ms)
   * @param {number} [options.requestTimeout=30000] - Timeout for individual HTTP requests (ms)
   */
  constructor(options = {}) {
    /** @type {string} */
    this.socketPath = options.socketPath || DEFAULT_SOCKET_PATH;

    /** @type {number} */
    this.operationTimeout = options.operationTimeout || DEFAULT_OPERATION_TIMEOUT;

    /** @type {number} */
    this.requestTimeout = options.requestTimeout || DEFAULT_REQUEST_TIMEOUT;
  }

  // ---------------------------------------------------------------------------
  // Instance lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Create a new Incus instance (container)
   *
   * Sends POST `/1.0/instances` and waits for the async operation to complete.
   *
   * @param {string} name - Instance name (e.g., 'ai-army-code-bot')
   * @param {Object} config - Instance configuration
   * @param {Object} config.source - Image source (e.g., `{ type: 'image', alias: 'ubuntu/24.04' }`)
   * @param {Object} [config.config] - Instance config keys (e.g., `{ 'limits.memory': '2GB' }`)
   * @param {Object} [config.devices] - Device overrides
   * @param {Array<string>} [config.profiles] - Profile names (default: ['default'])
   * @returns {Promise<Object>} Operation result
   * @throws {IncusClientError} When instance creation fails
   */
  async createInstance(name, config) {
    const body = {
      name,
      ...config,
    };

    const response = await this._request('POST', '/1.0/instances', body);
    return this._handleAsyncResponse(response, 'createInstance', name);
  }

  /**
   * Start an Incus instance
   *
   * @param {string} name - Instance name
   * @returns {Promise<Object>} Operation result
   * @throws {IncusClientError} When start fails
   */
  async startInstance(name) {
    const body = { action: 'start', timeout: 30, force: false };
    const response = await this._request(
      'PUT',
      `/1.0/instances/${encodeURIComponent(name)}/state`,
      body
    );
    return this._handleAsyncResponse(response, 'startInstance', name);
  }

  /**
   * Stop an Incus instance
   *
   * @param {string} name - Instance name
   * @param {number} [timeout=30] - Seconds to wait before force stop
   * @returns {Promise<Object>} Operation result
   * @throws {IncusClientError} When stop fails
   */
  async stopInstance(name, timeout = 30) {
    const body = { action: 'stop', timeout, force: false };
    const response = await this._request(
      'PUT',
      `/1.0/instances/${encodeURIComponent(name)}/state`,
      body
    );
    return this._handleAsyncResponse(response, 'stopInstance', name);
  }

  /**
   * Delete an Incus instance
   *
   * The instance must be stopped before deletion.
   *
   * @param {string} name - Instance name
   * @returns {Promise<Object>} Operation result
   * @throws {IncusClientError} When deletion fails
   */
  async deleteInstance(name) {
    const response = await this._request('DELETE', `/1.0/instances/${encodeURIComponent(name)}`);
    return this._handleAsyncResponse(response, 'deleteInstance', name);
  }

  /**
   * Get the state of an Incus instance
   *
   * Returns status, CPU/memory usage, network info, etc.
   *
   * @param {string} name - Instance name
   * @returns {Promise<Object>} Instance state object
   * @throws {IncusClientError} When query fails
   */
  async getInstanceState(name) {
    const response = await this._request('GET', `/1.0/instances/${encodeURIComponent(name)}/state`);
    return response.metadata;
  }

  /**
   * List all instances
   *
   * Uses `?recursion=1` to get full instance objects instead of just URLs.
   *
   * @returns {Promise<Array<Object>>} Array of instance objects
   * @throws {IncusClientError} When listing fails
   */
  async listInstances() {
    const response = await this._request('GET', '/1.0/instances?recursion=1');
    return response.metadata;
  }

  // ---------------------------------------------------------------------------
  // Server info
  // ---------------------------------------------------------------------------

  /**
   * Get Incus server information
   *
   * Returns the server environment, API version, and configuration.
   *
   * @returns {Promise<Object>} Server info metadata
   * @throws {IncusClientError} When query fails
   */
  async getServerInfo() {
    const response = await this._request('GET', '/1.0');
    return response;
  }

  // ---------------------------------------------------------------------------
  // Command execution
  // ---------------------------------------------------------------------------

  /**
   * Execute a command in a running instance
   *
   * Sends POST `/1.0/instances/{name}/exec` with `wait-for-websocket: false`
   * and `record-output: true`, then waits for the operation to complete and
   * retrieves stdout/stderr from the recorded output.
   *
   * @param {string} name - Instance name
   * @param {Array<string>} command - Command and arguments (e.g., `['bash', '-c', 'echo hello']`)
   * @param {Object} [options={}] - Execution options
   * @param {Object} [options.environment] - Environment variables
   * @param {string} [options.cwd] - Working directory
   * @param {number} [options.user] - UID to run as
   * @param {number} [options.group] - GID to run as
   * @param {number} [options.timeout] - Command timeout in milliseconds (overrides requestTimeout)
   * @returns {Promise<Object>} Execution result with `{ exitCode, stdout, stderr }`
   * @throws {IncusClientError} When execution fails
   */
  async execCommand(name, command, options = {}) {
    const body = {
      command,
      'wait-for-websocket': false,
      'record-output': true,
      interactive: false,
    };

    if (options.environment) {
      body.environment = options.environment;
    }
    if (options.cwd) {
      body.cwd = options.cwd;
    }
    if (options.user !== undefined) {
      body.user = options.user;
    }
    if (options.group !== undefined) {
      body.group = options.group;
    }

    // Build request options — forward caller timeout to the HTTP request
    const requestOptions = {};
    if (options.timeout) {
      requestOptions.timeout = options.timeout;
    }

    const response = await this._request(
      'POST',
      `/1.0/instances/${encodeURIComponent(name)}/exec`,
      body,
      requestOptions
    );

    // Wait for the exec operation to complete
    const operationResult = await this._handleAsyncResponse(response, 'execCommand', name);

    // Extract exit code and output log references from the operation
    const exitCode = operationResult?.metadata?.return ?? -1;
    const outputLog = operationResult?.metadata?.output ?? {};

    // Read stdout and stderr from the log endpoints
    let stdout = '';
    let stderr = '';

    if (outputLog['1']) {
      try {
        stdout = await this._getRawRequest(
          `/1.0/instances/${encodeURIComponent(name)}/logs/${outputLog['1'].split('/').pop()}`
        );
      } catch (_err) {
        // Output may not be available; fallback to empty
      }
    }
    if (outputLog['2']) {
      try {
        stderr = await this._getRawRequest(
          `/1.0/instances/${encodeURIComponent(name)}/logs/${outputLog['2'].split('/').pop()}`
        );
      } catch (_err) {
        // Output may not be available; fallback to empty
      }
    }

    return { exitCode, stdout, stderr };
  }

  // ---------------------------------------------------------------------------
  // File operations
  // ---------------------------------------------------------------------------

  /**
   * Push a file into an instance
   *
   * @param {string} name - Instance name
   * @param {string} filePath - Absolute path inside the instance
   * @param {string|Buffer} content - File content
   * @param {Object} [options={}] - File options
   * @param {number} [options.uid] - Owner UID
   * @param {number} [options.gid] - Owner GID
   * @param {string} [options.mode] - File mode (e.g., '0644')
   * @returns {Promise<void>}
   * @throws {IncusClientError} When push fails
   */
  async pushFile(name, filePath, content, options = {}) {
    const queryPath = `/1.0/instances/${encodeURIComponent(name)}/files?path=${encodeURIComponent(filePath)}`;
    const headers = {
      'Content-Type': 'application/octet-stream',
    };
    if (options.uid !== undefined) {
      headers['X-Incus-uid'] = String(options.uid);
    }
    if (options.gid !== undefined) {
      headers['X-Incus-gid'] = String(options.gid);
    }
    if (options.mode) {
      headers['X-Incus-mode'] = options.mode;
    }

    await this._rawRequest('POST', queryPath, content, headers);
  }

  /**
   * Pull (read) a file from an instance
   *
   * @param {string} name - Instance name
   * @param {string} filePath - Absolute path inside the instance
   * @returns {Promise<string>} File content as string
   * @throws {IncusClientError} When pull fails
   */
  async pullFile(name, filePath) {
    const queryPath = `/1.0/instances/${encodeURIComponent(name)}/files?path=${encodeURIComponent(filePath)}`;
    return this._getRawRequest(queryPath);
  }

  // ---------------------------------------------------------------------------
  // Operations
  // ---------------------------------------------------------------------------

  /**
   * Wait for an async operation to complete
   *
   * Incus async operations return an operation ID. This method polls
   * `/1.0/operations/{id}/wait` until the operation finishes or times out.
   *
   * @param {string} operationId - Operation UUID
   * @param {number} [timeout] - Timeout in seconds (defaults to operationTimeout / 1000)
   * @returns {Promise<Object>} Completed operation result
   * @throws {IncusClientError} When operation fails or times out
   */
  async getOperationResult(operationId, timeout) {
    const timeoutSecs = timeout ?? Math.floor(this.operationTimeout / 1000);
    const response = await this._request(
      'GET',
      `/1.0/operations/${encodeURIComponent(operationId)}/wait?timeout=${timeoutSecs}`,
      null,
      { timeout: this.operationTimeout + 5000 } // HTTP timeout slightly exceeds Incus timeout
    );
    return response.metadata;
  }

  // ---------------------------------------------------------------------------
  // Internal HTTP helpers
  // ---------------------------------------------------------------------------

  /**
   * Make an HTTP request to the Incus daemon via Unix socket
   *
   * @param {string} method - HTTP method (GET, POST, PUT, DELETE)
   * @param {string} path - API path (e.g., '/1.0/instances')
   * @param {Object|null} [body=null] - Request body (will be JSON-stringified)
   * @param {Object} [options={}] - Request options
   * @param {number} [options.timeout] - Request timeout override (ms)
   * @returns {Promise<Object>} Parsed JSON response
   * @throws {IncusClientError} On connection or API errors
   * @private
   */
  async _request(method, path, body = null, options = {}) {
    const timeout = options.timeout || this.requestTimeout;

    return new Promise((resolve, reject) => {
      const reqOptions = {
        socketPath: this.socketPath,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
        },
      };

      const req = http.request(reqOptions, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');

          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch (err) {
            return reject(
              new IncusClientError(`Invalid JSON response from Incus: ${raw.slice(0, 200)}`, {
                operation: `${method} ${path}`,
                statusCode: res.statusCode,
                cause: err,
              })
            );
          }

          // Check for Incus-level errors (status_code >= 400 or error type)
          if (parsed.type === 'error' || (parsed.error_code && parsed.error_code >= 400)) {
            return reject(
              new IncusClientError(parsed.error || `Incus API error: ${parsed.status}`, {
                operation: `${method} ${path}`,
                statusCode: parsed.error_code || res.statusCode,
                incusError: parsed.error,
              })
            );
          }

          resolve(parsed);
        });
      });

      req.on('error', err => {
        const message =
          err.code === 'ENOENT'
            ? `Incus socket not found at ${this.socketPath}. Is the Incus daemon running?`
            : err.code === 'ECONNREFUSED'
              ? `Connection refused to Incus daemon at ${this.socketPath}`
              : `Failed to connect to Incus daemon: ${err.message}`;

        reject(
          new IncusClientError(message, {
            operation: `${method} ${path}`,
            cause: err,
          })
        );
      });

      // Set request timeout
      req.setTimeout(timeout, () => {
        req.destroy(
          new IncusClientError(`Request timed out after ${timeout}ms`, {
            operation: `${method} ${path}`,
          })
        );
      });

      if (body !== null) {
        req.write(JSON.stringify(body));
      }

      req.end();
    });
  }

  /**
   * Make a raw HTTP request (non-JSON body, e.g., file upload)
   *
   * @param {string} method - HTTP method
   * @param {string} path - API path
   * @param {string|Buffer} body - Raw body content
   * @param {Object} [headers={}] - Additional headers
   * @returns {Promise<Object>} Parsed JSON response (if applicable)
   * @throws {IncusClientError} On connection or API errors
   * @private
   */
  async _rawRequest(method, path, body, headers = {}) {
    return new Promise((resolve, reject) => {
      const reqOptions = {
        socketPath: this.socketPath,
        path,
        method,
        headers: {
          ...headers,
        },
      };

      const req = http.request(reqOptions, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');

          if (res.statusCode >= 400) {
            let errorMsg = raw.slice(0, 200);
            try {
              const parsed = JSON.parse(raw);
              errorMsg = parsed.error || errorMsg;
            } catch (_e) {
              // raw text error is fine
            }
            return reject(
              new IncusClientError(`Incus file operation failed: ${errorMsg}`, {
                operation: `${method} ${path}`,
                statusCode: res.statusCode,
              })
            );
          }

          // Try to parse as JSON, fallback to raw text
          try {
            resolve(JSON.parse(raw));
          } catch (_e) {
            resolve(raw);
          }
        });
      });

      req.on('error', err => {
        reject(
          new IncusClientError(`Failed to connect to Incus daemon: ${err.message}`, {
            operation: `${method} ${path}`,
            cause: err,
          })
        );
      });

      req.setTimeout(this.requestTimeout, () => {
        req.destroy(
          new IncusClientError(`Request timed out after ${this.requestTimeout}ms`, {
            operation: `${method} ${path}`,
          })
        );
      });

      if (body !== null && body !== undefined) {
        req.write(body);
      }

      req.end();
    });
  }

  /**
   * Make a raw GET request and return the response body as a string
   *
   * Used for reading file content and log output from Incus.
   *
   * @param {string} path - API path
   * @returns {Promise<string>} Response body as string
   * @throws {IncusClientError} On connection or API errors
   * @private
   */
  async _getRawRequest(path) {
    return new Promise((resolve, reject) => {
      const reqOptions = {
        socketPath: this.socketPath,
        path,
        method: 'GET',
      };

      const req = http.request(reqOptions, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');

          if (res.statusCode >= 400) {
            return reject(
              new IncusClientError(`Incus GET failed: ${raw.slice(0, 200)}`, {
                operation: `GET ${path}`,
                statusCode: res.statusCode,
              })
            );
          }

          resolve(raw);
        });
      });

      req.on('error', err => {
        reject(
          new IncusClientError(`Failed to connect to Incus daemon: ${err.message}`, {
            operation: `GET ${path}`,
            cause: err,
          })
        );
      });

      req.setTimeout(this.requestTimeout, () => {
        req.destroy(
          new IncusClientError(`Request timed out after ${this.requestTimeout}ms`, {
            operation: `GET ${path}`,
          })
        );
      });

      req.end();
    });
  }

  /**
   * Handle an async response from Incus
   *
   * Incus returns HTTP 202 for asynchronous operations with an operation
   * reference. This method detects async responses and waits for the
   * operation to complete.
   *
   * @param {Object} response - Parsed Incus API response
   * @param {string} operationName - Name of the calling operation (for errors)
   * @param {string} [instanceName] - Instance name (for errors)
   * @returns {Promise<Object>} Completed operation result or sync response
   * @throws {IncusClientError} When async operation fails
   * @private
   */
  async _handleAsyncResponse(response, operationName, instanceName) {
    // Synchronous success
    if (response.type === 'sync') {
      return response.metadata;
    }

    // Asynchronous operation
    if (response.type === 'async') {
      const operationId = this._extractOperationId(response);
      if (!operationId) {
        throw new IncusClientError(
          `Async operation returned but no operation ID found in response`,
          {
            operation: operationName,
            instanceName,
          }
        );
      }

      const result = await this.getOperationResult(operationId);

      // Check if the operation itself failed
      if (result?.status === 'Failure' || result?.err) {
        throw new IncusClientError(
          result.err || `Operation ${operationName} failed: ${result?.status}`,
          {
            operation: operationName,
            instanceName,
            incusError: result.err,
          }
        );
      }

      return result;
    }

    // Unexpected response type
    throw new IncusClientError(`Unexpected Incus response type: ${response.type}`, {
      operation: operationName,
      instanceName,
    });
  }

  /**
   * Extract the operation UUID from an async Incus response
   *
   * The operation URL is in `response.operation` as a path like
   * `/1.0/operations/<uuid>`. This extracts just the UUID.
   *
   * @param {Object} response - Parsed Incus API response
   * @returns {string|null} Operation UUID or null
   * @private
   */
  _extractOperationId(response) {
    const operationPath = response?.operation;
    if (!operationPath) return null;

    // Operation path format: /1.0/operations/<uuid>
    const parts = operationPath.split('/');
    return parts[parts.length - 1] || null;
  }
}
