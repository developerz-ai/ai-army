/**
 * PostgresStorage - PostgreSQL storage adapter with connection pooling
 *
 * Central nervous system for orchestration, messaging, and state.
 * Provides:
 * - Connection pooling for performance
 * - Parameterized queries (SQL injection prevention)
 * - UPSERT methods for bots and sessions
 * - JSONB array handling for message storage
 *
 * @module PostgresStorage
 */

import pg from 'pg';

const { Pool } = pg;

/**
 * Custom error for storage-related failures
 */
export class StorageError extends Error {
  /**
   * Create a StorageError
   * @param {string} message - Error message
   * @param {Object} [options] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - The operation that failed
   * @param {string} [options.entityId] - ID of the entity involved
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'StorageError';
    this.operation = options.operation;
    this.entityId = options.entityId;
  }
}

/**
 * Default pool configuration
 */
const DEFAULT_POOL_CONFIG = {
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
};

/**
 * PostgreSQL storage adapter class
 */
export class PostgresStorage {
  /**
   * Create a PostgresStorage instance
   * @param {string|Object} config - Connection string or pool configuration object
   */
  constructor(config) {
    if (typeof config === 'string') {
      this.poolConfig = {
        connectionString: config,
        ...DEFAULT_POOL_CONFIG,
      };
    } else {
      this.poolConfig = {
        ...DEFAULT_POOL_CONFIG,
        ...config,
      };
    }

    this.pool = null;
    this.connected = false;
  }

  /**
   * Connect to the database and create connection pool
   * @returns {Promise<void>}
   * @throws {StorageError} If connection fails
   */
  async connect() {
    if (this.connected) {
      return;
    }

    try {
      this.pool = new Pool(this.poolConfig);

      // Set up error handler for idle clients
      this.pool.on('error', err => {
        console.error('Unexpected error on idle PostgreSQL client:', err);
      });

      // Test connection
      await this.pool.query('SELECT NOW()');
      this.connected = true;
    } catch (err) {
      throw new StorageError('Failed to connect to PostgreSQL', {
        cause: err,
        operation: 'connect',
      });
    }
  }

  /**
   * Disconnect from the database and close connection pool
   * @returns {Promise<void>}
   */
  async disconnect() {
    if (!this.pool) {
      return;
    }

    try {
      await this.pool.end();
      this.pool = null;
      this.connected = false;
    } catch (err) {
      throw new StorageError('Failed to disconnect from PostgreSQL', {
        cause: err,
        operation: 'disconnect',
      });
    }
  }

  /**
   * Execute a parameterized query
   * @param {string} sql - SQL query with $1, $2 placeholders
   * @param {Array} [params=[]] - Query parameters
   * @returns {Promise<{rows: Array, rowCount: number}>} Query result
   * @throws {StorageError} If query fails
   */
  async query(sql, params = []) {
    if (!this.pool) {
      throw new StorageError('Database not connected. Call connect() first.', {
        operation: 'query',
      });
    }

    try {
      return await this.pool.query(sql, params);
    } catch (err) {
      throw new StorageError(`Query failed: ${err.message}`, {
        cause: err,
        operation: 'query',
      });
    }
  }

  /**
   * Execute multiple queries in a transaction
   * @param {Function} callback - Async function receiving transaction client
   * @returns {Promise<*>} Result from callback
   * @throws {StorageError} If transaction fails
   */
  async transaction(callback) {
    if (!this.pool) {
      throw new StorageError('Database not connected. Call connect() first.', {
        operation: 'transaction',
      });
    }

    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw new StorageError(`Transaction failed: ${err.message}`, {
        cause: err,
        operation: 'transaction',
      });
    } finally {
      client.release();
    }
  }

  // ============================================================================
  // Bot Management
  // ============================================================================

  /**
   * Save or update a bot configuration (UPSERT)
   * @param {string} botId - Unique bot identifier
   * @param {Object} config - Bot configuration object
   * @param {Object} [options={}] - Additional options
   * @param {string} [options.name] - Bot display name
   * @param {string} [options.description] - Bot description
   * @param {string} [options.soulContent] - Contents of soul.md
   * @param {string} [options.status='stopped'] - Initial status
   * @returns {Promise<void>}
   * @throws {StorageError} If save fails
   */
  async saveBotConfig(botId, config, options = {}) {
    const { name, description, soulContent, status = 'stopped' } = options;

    try {
      await this.query(
        `INSERT INTO bots (id, name, description, config, soul_content, status)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET
           name = COALESCE($2, bots.name),
           description = COALESCE($3, bots.description),
           config = $4,
           soul_content = COALESCE($5, bots.soul_content),
           updated_at = NOW()`,
        [botId, name || botId, description, JSON.stringify(config), soulContent, status]
      );
    } catch (err) {
      throw new StorageError(`Failed to save bot config: ${err.message}`, {
        cause: err,
        operation: 'saveBotConfig',
        entityId: botId,
      });
    }
  }

  /**
   * Get a bot configuration by ID
   * @param {string} botId - Bot identifier
   * @returns {Promise<Object|null>} Bot record or null if not found
   * @throws {StorageError} If query fails
   */
  async getBotConfig(botId) {
    try {
      const { rows } = await this.query('SELECT * FROM bots WHERE id = $1', [botId]);
      return rows[0] || null;
    } catch (err) {
      throw new StorageError(`Failed to get bot config: ${err.message}`, {
        cause: err,
        operation: 'getBotConfig',
        entityId: botId,
      });
    }
  }

  /**
   * Update bot status
   * @param {string} botId - Bot identifier
   * @param {string} status - New status ('starting' | 'running' | 'stopped' | 'error')
   * @param {Object} [options={}] - Additional fields to update
   * @param {string} [options.workerId] - Worker ID running the bot
   * @param {string} [options.containerId] - Docker container ID
   * @returns {Promise<boolean>} True if bot was found and updated
   * @throws {StorageError} If update fails
   */
  async updateBotStatus(botId, status, options = {}) {
    const { workerId, containerId } = options;

    try {
      const { rowCount } = await this.query(
        `UPDATE bots
         SET status = $2,
             worker_id = COALESCE($3, worker_id),
             container_id = COALESCE($4, container_id),
             last_active_at = NOW()
         WHERE id = $1`,
        [botId, status, workerId, containerId]
      );
      return rowCount > 0;
    } catch (err) {
      throw new StorageError(`Failed to update bot status: ${err.message}`, {
        cause: err,
        operation: 'updateBotStatus',
        entityId: botId,
      });
    }
  }

  /**
   * List all bots, optionally filtered by status
   * @param {Object} [filter={}] - Filter options
   * @param {string} [filter.status] - Filter by status
   * @param {string} [filter.workerId] - Filter by worker ID
   * @returns {Promise<Array>} Array of bot records
   * @throws {StorageError} If query fails
   */
  async listBots(filter = {}) {
    try {
      let sql = 'SELECT * FROM bots';
      const params = [];
      const conditions = [];

      if (filter.status) {
        conditions.push(`status = $${params.length + 1}`);
        params.push(filter.status);
      }

      if (filter.workerId) {
        conditions.push(`worker_id = $${params.length + 1}`);
        params.push(filter.workerId);
      }

      if (conditions.length > 0) {
        sql += ` WHERE ${conditions.join(' AND ')}`;
      }

      sql += ' ORDER BY created_at DESC';

      const { rows } = await this.query(sql, params);
      return rows;
    } catch (err) {
      throw new StorageError(`Failed to list bots: ${err.message}`, {
        cause: err,
        operation: 'listBots',
      });
    }
  }

  /**
   * Delete a bot by ID
   * @param {string} botId - Bot identifier
   * @returns {Promise<boolean>} True if bot was deleted
   * @throws {StorageError} If delete fails
   */
  async deleteBot(botId) {
    try {
      const { rowCount } = await this.query('DELETE FROM bots WHERE id = $1', [botId]);
      return rowCount > 0;
    } catch (err) {
      throw new StorageError(`Failed to delete bot: ${err.message}`, {
        cause: err,
        operation: 'deleteBot',
        entityId: botId,
      });
    }
  }

  // ============================================================================
  // Session Management
  // ============================================================================

  /**
   * Save or update a session (UPSERT)
   * @param {Object} session - Session object
   * @param {string} session.id - Session ID (format: botId:channelType:channelId:userId)
   * @param {string} session.botId - Bot identifier
   * @param {string} session.userId - User identifier
   * @param {string} session.channelId - Channel identifier
   * @param {string} session.channelType - Channel type ('slack' | 'discord' | 'rest')
   * @param {Array} [session.messages=[]] - Array of message objects
   * @param {number} [session.tokenCount=0] - Estimated token count
   * @param {number} [session.compactionCount=0] - Number of compactions
   * @returns {Promise<void>}
   * @throws {StorageError} If save fails
   */
  async saveSession(session) {
    const {
      id,
      botId,
      userId,
      channelId,
      channelType,
      messages = [],
      tokenCount = 0,
      compactionCount = 0,
    } = session;

    try {
      // Convert messages array to PostgreSQL array format
      const messagesArray = messages.map(m => JSON.stringify(m));

      await this.query(
        `INSERT INTO sessions (id, bot_id, user_id, channel_id, channel_type, messages, token_count, compaction_count)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb[], $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           messages = $6::jsonb[],
           token_count = $7,
           compaction_count = $8,
           last_message_at = NOW()`,
        [id, botId, userId, channelId, channelType, messagesArray, tokenCount, compactionCount]
      );
    } catch (err) {
      throw new StorageError(`Failed to save session: ${err.message}`, {
        cause: err,
        operation: 'saveSession',
        entityId: id,
      });
    }
  }

  /**
   * Get a session by ID
   * @param {string} sessionId - Session identifier
   * @returns {Promise<Object|null>} Session record or null if not found
   * @throws {StorageError} If query fails
   */
  async getSession(sessionId) {
    try {
      const { rows } = await this.query('SELECT * FROM sessions WHERE id = $1', [sessionId]);

      if (rows.length === 0) {
        return null;
      }

      const row = rows[0];

      // Transform to camelCase and ensure messages is an array
      return {
        id: row.id,
        botId: row.bot_id,
        userId: row.user_id,
        channelId: row.channel_id,
        channelType: row.channel_type,
        messages: row.messages || [],
        tokenCount: row.token_count,
        compactionCount: row.compaction_count,
        createdAt: row.created_at,
        lastMessageAt: row.last_message_at,
      };
    } catch (err) {
      throw new StorageError(`Failed to get session: ${err.message}`, {
        cause: err,
        operation: 'getSession',
        entityId: sessionId,
      });
    }
  }

  /**
   * Append a message to a session's messages array
   * Uses efficient PostgreSQL array append
   * @param {string} sessionId - Session identifier
   * @param {Object} message - Message object with role and content
   * @returns {Promise<boolean>} True if session was found and updated
   * @throws {StorageError} If append fails
   */
  async appendMessage(sessionId, message) {
    try {
      const { rowCount } = await this.query(
        `UPDATE sessions
         SET messages = messages || $1::jsonb,
             last_message_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(message), sessionId]
      );
      return rowCount > 0;
    } catch (err) {
      throw new StorageError(`Failed to append message: ${err.message}`, {
        cause: err,
        operation: 'appendMessage',
        entityId: sessionId,
      });
    }
  }

  /**
   * Update session token count
   * @param {string} sessionId - Session identifier
   * @param {number} tokenCount - New token count
   * @returns {Promise<boolean>} True if session was found and updated
   * @throws {StorageError} If update fails
   */
  async updateSessionTokenCount(sessionId, tokenCount) {
    try {
      const { rowCount } = await this.query('UPDATE sessions SET token_count = $1 WHERE id = $2', [
        tokenCount,
        sessionId,
      ]);
      return rowCount > 0;
    } catch (err) {
      throw new StorageError(`Failed to update session token count: ${err.message}`, {
        cause: err,
        operation: 'updateSessionTokenCount',
        entityId: sessionId,
      });
    }
  }

  /**
   * List sessions for a bot
   * @param {string} botId - Bot identifier
   * @param {Object} [options={}] - Query options
   * @param {number} [options.limit=100] - Maximum sessions to return
   * @param {Date} [options.since] - Only sessions active since this date
   * @returns {Promise<Array>} Array of session records
   * @throws {StorageError} If query fails
   */
  async listSessions(botId, options = {}) {
    const { limit = 100, since } = options;

    try {
      let sql = 'SELECT * FROM sessions WHERE bot_id = $1';
      const params = [botId];

      if (since) {
        sql += ' AND last_message_at > $2';
        params.push(since);
      }

      sql += ` ORDER BY last_message_at DESC LIMIT $${params.length + 1}`;
      params.push(limit);

      const { rows } = await this.query(sql, params);

      // Transform to camelCase
      return rows.map(row => ({
        id: row.id,
        botId: row.bot_id,
        userId: row.user_id,
        channelId: row.channel_id,
        channelType: row.channel_type,
        messages: row.messages || [],
        tokenCount: row.token_count,
        compactionCount: row.compaction_count,
        createdAt: row.created_at,
        lastMessageAt: row.last_message_at,
      }));
    } catch (err) {
      throw new StorageError(`Failed to list sessions: ${err.message}`, {
        cause: err,
        operation: 'listSessions',
        entityId: botId,
      });
    }
  }

  /**
   * Delete a session by ID
   * @param {string} sessionId - Session identifier
   * @returns {Promise<boolean>} True if session was deleted
   * @throws {StorageError} If delete fails
   */
  async deleteSession(sessionId) {
    try {
      const { rowCount } = await this.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
      return rowCount > 0;
    } catch (err) {
      throw new StorageError(`Failed to delete session: ${err.message}`, {
        cause: err,
        operation: 'deleteSession',
        entityId: sessionId,
      });
    }
  }

  // ============================================================================
  // Tool Calls (Audit Log)
  // ============================================================================

  /**
   * Log a tool call for auditing
   * @param {Object} toolCall - Tool call record
   * @param {string} toolCall.botId - Bot that initiated the call
   * @param {string} [toolCall.sessionId] - Session context (null for background tasks)
   * @param {string} toolCall.toolName - Name of the tool
   * @param {Object} [toolCall.parameters] - Tool parameters
   * @param {Object} [toolCall.result] - Tool result
   * @param {boolean} toolCall.success - Whether the call succeeded
   * @param {string} [toolCall.error] - Error message if failed
   * @param {number} [toolCall.durationMs] - Execution duration in milliseconds
   * @returns {Promise<number>} ID of the inserted record
   * @throws {StorageError} If insert fails
   */
  async logToolCall(toolCall) {
    const {
      botId,
      sessionId = null,
      toolName,
      parameters = null,
      result = null,
      success,
      error = null,
      durationMs = null,
    } = toolCall;

    try {
      const { rows } = await this.query(
        `INSERT INTO tool_calls (bot_id, session_id, tool_name, parameters, result, success, error, duration_ms)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          botId,
          sessionId,
          toolName,
          parameters ? JSON.stringify(parameters) : null,
          result ? JSON.stringify(result) : null,
          success,
          error,
          durationMs,
        ]
      );
      return rows[0].id;
    } catch (err) {
      throw new StorageError(`Failed to log tool call: ${err.message}`, {
        cause: err,
        operation: 'logToolCall',
        entityId: botId,
      });
    }
  }

  /**
   * Get tool calls for a bot or session
   * @param {Object} [filter={}] - Filter options
   * @param {string} [filter.botId] - Filter by bot ID
   * @param {string} [filter.sessionId] - Filter by session ID
   * @param {string} [filter.toolName] - Filter by tool name
   * @param {boolean} [filter.success] - Filter by success status
   * @param {number} [filter.limit=100] - Maximum records to return
   * @returns {Promise<Array>} Array of tool call records
   * @throws {StorageError} If query fails
   */
  async getToolCalls(filter = {}) {
    const { botId, sessionId, toolName, success, limit = 100 } = filter;

    try {
      let sql = 'SELECT * FROM tool_calls WHERE 1=1';
      const params = [];

      if (botId) {
        sql += ` AND bot_id = $${params.length + 1}`;
        params.push(botId);
      }

      if (sessionId) {
        sql += ` AND session_id = $${params.length + 1}`;
        params.push(sessionId);
      }

      if (toolName) {
        sql += ` AND tool_name = $${params.length + 1}`;
        params.push(toolName);
      }

      if (success !== undefined) {
        sql += ` AND success = $${params.length + 1}`;
        params.push(success);
      }

      sql += ` ORDER BY executed_at DESC LIMIT $${params.length + 1}`;
      params.push(limit);

      const { rows } = await this.query(sql, params);
      return rows;
    } catch (err) {
      throw new StorageError(`Failed to get tool calls: ${err.message}`, {
        cause: err,
        operation: 'getToolCalls',
      });
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Check if the database is connected
   * @returns {boolean} True if connected
   */
  isConnected() {
    return this.connected && this.pool !== null;
  }

  /**
   * Get pool statistics
   * @returns {Object} Pool stats (totalCount, idleCount, waitingCount)
   */
  getPoolStats() {
    if (!this.pool) {
      return { totalCount: 0, idleCount: 0, waitingCount: 0 };
    }

    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
    };
  }

  /**
   * Health check - verifies database connectivity
   * @returns {Promise<boolean>} True if healthy
   */
  async healthCheck() {
    try {
      await this.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}

export default PostgresStorage;
