/**
 * Built-in health check functions for HealthMonitor
 *
 * Provides reusable health check factories that probe the core components
 * of the system: database, bots, channels, workers, and MCP servers.
 * Each factory returns an async function suitable for registration with
 * HealthMonitor.registerCheck().
 *
 * Check result format:
 *   { status: 'healthy' | 'degraded' | 'unhealthy', ...details }
 *
 * @module monitoring/health-checks
 */

import { HEALTH_STATUSES } from './HealthMonitor.js';

/**
 * Create a database health check function
 *
 * Verifies database connectivity by running a simple SELECT 1 query.
 * Reports latency in milliseconds.
 *
 * @param {Object} storage - Storage instance with a query() method
 * @returns {Function} Async health check function
 */
export function createDatabaseCheck(storage) {
  return async function checkDatabase() {
    if (!storage || typeof storage.query !== 'function') {
      return {
        status: HEALTH_STATUSES.UNHEALTHY,
        error: 'Storage not available',
      };
    }

    const startTime = Date.now();

    try {
      await storage.query('SELECT 1');
      const latency = Date.now() - startTime;

      return {
        status: HEALTH_STATUSES.HEALTHY,
        latency,
      };
    } catch (err) {
      return {
        status: HEALTH_STATUSES.UNHEALTHY,
        error: err.message,
        latency: Date.now() - startTime,
      };
    }
  };
}

/**
 * Create a bot health check function
 *
 * Examines the BotManager to count running vs total bots.
 * - All bots running → healthy
 * - At least one running → degraded
 * - No bots running (when some are loaded) → unhealthy
 * - No bots loaded → healthy (nothing to monitor)
 *
 * @param {Object} botManager - BotManager instance with listBots() method
 * @returns {Function} Async health check function
 */
export function createBotsCheck(botManager) {
  return async function checkBots() {
    if (!botManager || typeof botManager.listBots !== 'function') {
      return {
        status: HEALTH_STATUSES.UNHEALTHY,
        error: 'BotManager not available',
      };
    }

    const bots = botManager.listBots();
    const total = bots.length;
    const running = bots.filter(b => b.status === 'running').length;
    const errored = bots.filter(b => b.status === 'error').length;

    if (total === 0) {
      return {
        status: HEALTH_STATUSES.HEALTHY,
        running: 0,
        total: 0,
        errored: 0,
      };
    }

    let status;
    if (running === total) {
      status = HEALTH_STATUSES.HEALTHY;
    } else if (running > 0) {
      status = HEALTH_STATUSES.DEGRADED;
    } else {
      status = HEALTH_STATUSES.UNHEALTHY;
    }

    return {
      status,
      running,
      total,
      errored,
    };
  };
}

/**
 * Create a channels health check function
 *
 * Examines the ChannelManager to check connected channel status.
 * - All channels connected → healthy
 * - Some channels connected → degraded
 * - No channels connected (when some are configured) → unhealthy
 * - No channels configured → healthy (nothing to monitor)
 *
 * @param {Object} channelManager - ChannelManager instance with listChannels() method
 * @returns {Function} Async health check function
 */
export function createChannelsCheck(channelManager) {
  return async function checkChannels() {
    if (!channelManager || typeof channelManager.listChannels !== 'function') {
      return {
        status: HEALTH_STATUSES.UNHEALTHY,
        error: 'ChannelManager not available',
      };
    }

    const channels = channelManager.listChannels();
    const total = channels.length;

    if (total === 0) {
      return {
        status: HEALTH_STATUSES.HEALTHY,
        connected: 0,
        total: 0,
      };
    }

    let connected = 0;
    for (const channel of channels) {
      const { adapter } = channel;
      if (adapter && typeof adapter.isConnected === 'function') {
        try {
          if (await adapter.isConnected()) {
            connected++;
          }
        } catch (_err) {
          // Connection check failed — count as disconnected
        }
      } else if (
        channel.status === 'ready' ||
        channel.status === 'started' ||
        channel.status === 'running'
      ) {
        // Fallback: assume connected if channel is in a ready state
        connected++;
      }
    }

    let status;
    if (connected === total) {
      status = HEALTH_STATUSES.HEALTHY;
    } else if (connected > 0) {
      status = HEALTH_STATUSES.DEGRADED;
    } else {
      status = HEALTH_STATUSES.UNHEALTHY;
    }

    return {
      status,
      connected,
      total,
    };
  };
}

/**
 * Create a workers health check function
 *
 * Examines the WorkerRegistry to check worker availability.
 * Workers with recent heartbeats are considered available.
 * - All workers available → healthy
 * - Some workers available → degraded
 * - No workers available → unhealthy
 * - No workers registered → healthy (local-only mode)
 *
 * @param {Object} workerRegistry - WorkerRegistry instance with listWorkers() method
 * @returns {Function} Async health check function
 */
export function createWorkersCheck(workerRegistry) {
  return async function checkWorkers() {
    if (!workerRegistry || typeof workerRegistry.listWorkers !== 'function') {
      return {
        status: HEALTH_STATUSES.HEALTHY,
        available: 0,
        total: 0,
        note: 'WorkerRegistry not available (local-only mode)',
      };
    }

    try {
      const workers = await workerRegistry.listWorkers();
      const total = workers.length;

      if (total === 0) {
        return {
          status: HEALTH_STATUSES.HEALTHY,
          available: 0,
          total: 0,
        };
      }

      const available = workers.filter(w => w.status === 'healthy' || w.status === 'online').length;

      let status;
      if (available === total) {
        status = HEALTH_STATUSES.HEALTHY;
      } else if (available > 0) {
        status = HEALTH_STATUSES.DEGRADED;
      } else {
        status = HEALTH_STATUSES.UNHEALTHY;
      }

      return {
        status,
        available,
        total,
      };
    } catch (err) {
      return {
        status: HEALTH_STATUSES.UNHEALTHY,
        error: err.message,
      };
    }
  };
}

/**
 * Create an MCP servers health check function
 *
 * Examines the MCPManager to check if MCP servers are running.
 * - All servers running → healthy
 * - Some servers running → degraded
 * - No servers running (when some are configured) → unhealthy
 * - No servers configured → healthy (nothing to monitor)
 *
 * @param {Object} mcpManager - MCPManager instance with listServers()/getServerCount() methods
 * @returns {Function} Async health check function
 */
export function createMCPCheck(mcpManager) {
  return async function checkMCP() {
    if (!mcpManager) {
      return {
        status: HEALTH_STATUSES.HEALTHY,
        running: 0,
        total: 0,
        note: 'MCPManager not available',
      };
    }

    try {
      // Use listServers if available, otherwise fall back to getServerCount
      if (typeof mcpManager.listServers === 'function') {
        const servers = mcpManager.listServers();
        const total = servers.length;

        if (total === 0) {
          return {
            status: HEALTH_STATUSES.HEALTHY,
            running: 0,
            total: 0,
          };
        }

        const running = servers.filter(
          s => s.status === 'running' || s.status === 'connected'
        ).length;

        let status;
        if (running === total) {
          status = HEALTH_STATUSES.HEALTHY;
        } else if (running > 0) {
          status = HEALTH_STATUSES.DEGRADED;
        } else {
          status = HEALTH_STATUSES.UNHEALTHY;
        }

        return {
          status,
          running,
          total,
        };
      }

      // Fallback: use getServerCount if available
      if (typeof mcpManager.getServerCount === 'function') {
        const count = mcpManager.getServerCount();
        return {
          status: count > 0 ? HEALTH_STATUSES.HEALTHY : HEALTH_STATUSES.HEALTHY,
          running: count,
          total: count,
        };
      }

      return {
        status: HEALTH_STATUSES.HEALTHY,
        note: 'MCPManager does not expose server listing',
      };
    } catch (err) {
      return {
        status: HEALTH_STATUSES.UNHEALTHY,
        error: err.message,
      };
    }
  };
}

/**
 * Register all built-in health checks with a HealthMonitor instance
 *
 * Convenience function that registers all available built-in checks
 * based on which components are provided. Components that are null/undefined
 * are skipped.
 *
 * @param {import('./HealthMonitor.js').HealthMonitor} monitor - HealthMonitor instance
 * @param {Object} components - System components to create checks for
 * @param {Object} [components.storage] - Storage instance for database check
 * @param {Object} [components.botManager] - BotManager instance for bots check
 * @param {Object} [components.channelManager] - ChannelManager for channels check
 * @param {Object} [components.workerRegistry] - WorkerRegistry for workers check
 * @param {Object} [components.mcpManager] - MCPManager for MCP check
 * @param {Object} [options={}] - Per-check interval overrides
 * @param {number} [options.databaseInterval=15000] - Database check interval in ms
 * @param {number} [options.botsInterval=30000] - Bots check interval in ms
 * @param {number} [options.channelsInterval=30000] - Channels check interval in ms
 * @param {number} [options.workersInterval=30000] - Workers check interval in ms
 * @param {number} [options.mcpInterval=60000] - MCP check interval in ms
 * @returns {string[]} Names of the checks that were registered
 */
export function registerBuiltInChecks(monitor, components = {}, options = {}) {
  const registered = [];

  if (components.storage) {
    monitor.registerCheck(
      'database',
      createDatabaseCheck(components.storage),
      options.databaseInterval || 15_000
    );
    registered.push('database');
  }

  if (components.botManager) {
    monitor.registerCheck(
      'bots',
      createBotsCheck(components.botManager),
      options.botsInterval || 30_000
    );
    registered.push('bots');
  }

  if (components.channelManager) {
    monitor.registerCheck(
      'channels',
      createChannelsCheck(components.channelManager),
      options.channelsInterval || 30_000
    );
    registered.push('channels');
  }

  if (components.workerRegistry) {
    monitor.registerCheck(
      'workers',
      createWorkersCheck(components.workerRegistry),
      options.workersInterval || 30_000
    );
    registered.push('workers');
  }

  if (components.mcpManager) {
    monitor.registerCheck(
      'mcp',
      createMCPCheck(components.mcpManager),
      options.mcpInterval || 60_000
    );
    registered.push('mcp');
  }

  return registered;
}
