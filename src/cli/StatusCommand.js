/**
 * StatusCommand - Display system status for the AI Army framework
 *
 * Shows the current state of:
 * - Bots: name, status, active session counts
 * - Database: connection status, total sessions, messages processed
 * - Channels: name, connection status
 * - Workers: distributed worker nodes, load, health status
 *
 * Accepts dependency injection for all managers and an output stream,
 * making it fully testable without real infrastructure.
 *
 * @module cli/StatusCommand
 */

/**
 * Custom error for status command failures
 */
export class StatusCommandError extends Error {
  /**
   * Create a StatusCommandError
   * @param {string} message - Error message
   * @param {Object} [options] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.section] - Which section failed (bots, database, channels)
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'StatusCommandError';
    this.section = options.section;
  }
}

/**
 * Status icons for display
 * @private
 */
const ICONS = {
  running: '\u2705',
  started: '\u2705',
  ready: '\u2705',
  loaded: '\u2705',
  healthy: '\u2705',
  stopped: '\u23F8\uFE0F ',
  degraded: '\u26A0\uFE0F ',
  offline: '\u274C',
  error: '\u274C',
  initializing: '\u23F3',
  loading: '\u23F3',
  starting: '\u23F3',
  stopping: '\u23F3',
};

/**
 * Get the display icon for a given status
 *
 * @param {string} status - Status string
 * @returns {string} Emoji icon for the status
 * @private
 */
function getStatusIcon(status) {
  return ICONS[status] || '\u2753';
}

/**
 * Format a number with locale-aware separators (e.g. 1,234)
 *
 * @param {number} num - Number to format
 * @returns {string} Formatted number string
 * @private
 */
function formatNumber(num) {
  return Number(num).toLocaleString('en-US');
}

/**
 * Pluralize a word based on count
 *
 * @param {number} count - Count to check
 * @param {string} singular - Singular form
 * @param {string} plural - Plural form
 * @returns {string} Appropriate form of the word
 * @private
 */
function pluralize(count, singular, plural) {
  return count === 1 ? singular : plural;
}

/**
 * Collect bot status information from the BotManager
 *
 * @param {Object} botManager - BotManager instance
 * @param {Object} storage - PostgresStorage instance (for session counts)
 * @returns {Promise<Array<Object>>} Array of bot status entries
 * @private
 */
async function collectBotStatus(botManager, storage) {
  const bots = botManager.listBots();
  const entries = [];

  for (const bot of bots) {
    let activeSessions = 0;

    // Try to get session count from storage if connected
    if (storage && storage.isConnected()) {
      try {
        const sessions = await storage.listSessions(bot.id, { limit: 10000 });
        activeSessions = sessions.length;
      } catch {
        // Session count is best-effort; skip on failure
      }
    }

    entries.push({
      id: bot.id,
      status: bot.status,
      activeSessions,
    });
  }

  return entries;
}

/**
 * Collect database status information
 *
 * @param {Object} storage - PostgresStorage instance
 * @returns {Promise<Object>} Database status info
 * @private
 */
async function collectDatabaseStatus(storage) {
  const info = {
    connected: false,
    totalSessions: 0,
    messagesProcessed: 0,
    version: null,
  };

  if (!storage || !storage.isConnected()) {
    return info;
  }

  info.connected = true;

  try {
    // Get PostgreSQL version
    const versionResult = await storage.query('SELECT version()');
    if (versionResult.rows.length > 0) {
      const fullVersion = versionResult.rows[0].version;
      const match = fullVersion.match(/PostgreSQL (\d+(?:\.\d+)?)/);
      info.version = match ? match[1] : fullVersion;
    }
  } catch {
    // Version is best-effort
  }

  try {
    // Get total session count
    const sessionResult = await storage.query('SELECT COUNT(*) AS count FROM sessions');
    info.totalSessions = parseInt(sessionResult.rows[0].count, 10) || 0;
  } catch {
    // Session count is best-effort
  }

  try {
    // Get total messages processed (sum of array lengths)
    const msgResult = await storage.query(
      'SELECT COALESCE(SUM(array_length(messages, 1)), 0) AS count FROM sessions'
    );
    info.messagesProcessed = parseInt(msgResult.rows[0].count, 10) || 0;
  } catch {
    // Message count is best-effort
  }

  return info;
}

/**
 * Collect channel status information
 *
 * @param {Object} channelManager - ChannelManager instance
 * @returns {Array<Object>} Array of channel status entries
 * @private
 */
function collectChannelStatus(channelManager) {
  const channels = channelManager.listChannels();
  return channels.map(ch => ({
    name: ch.name,
    status: ch.status,
    type: ch.config?.type || 'unknown',
  }));
}

/**
 * Map channel status to a human-readable connection state
 *
 * @param {string} status - Channel status
 * @returns {string} Display label
 * @private
 */
function channelStatusLabel(status) {
  const labels = {
    initializing: 'initializing',
    ready: 'ready',
    started: 'connected',
    stopping: 'stopping',
    stopped: 'disconnected',
    error: 'error',
  };
  return labels[status] || status;
}

/**
 * Collect worker status information from the WorkerRegistry
 *
 * @param {Object} workerRegistry - WorkerRegistry instance
 * @returns {Promise<Array<Object>>} Array of worker status entries
 * @private
 */
async function collectWorkerStatus(workerRegistry) {
  const workers = await workerRegistry.listWorkers();
  return workers.map(w => ({
    id: w.id,
    type: w.type,
    status: w.status,
    currentLoad: w.currentLoad,
    maxContainers: w.maxContainers,
    host: w.host,
  }));
}

/**
 * Map worker status to a human-readable label
 *
 * @param {string} status - Worker status
 * @returns {string} Display label
 * @private
 */
function workerStatusLabel(status) {
  const labels = {
    healthy: 'healthy',
    degraded: 'degraded',
    offline: 'offline',
  };
  return labels[status] || status;
}

/**
 * Display the full system status
 *
 * Queries BotManager, PostgresStorage, ChannelManager, and WorkerRegistry
 * for current state and writes a human-readable summary to the output stream.
 *
 * @param {Object} options - Status command options
 * @param {Object} options.storage - PostgresStorage instance
 * @param {Object} options.botManager - BotManager instance
 * @param {Object} options.channelManager - ChannelManager instance
 * @param {Object} [options.workerRegistry] - WorkerRegistry instance (optional)
 * @param {Object} [options.output=process.stdout] - Writable stream for output
 * @returns {Promise<void>}
 * @throws {StatusCommandError} If required dependencies are missing
 */
export async function showStatus({
  storage,
  botManager,
  channelManager,
  workerRegistry,
  output = process.stdout,
} = {}) {
  if (!botManager) {
    throw new StatusCommandError('botManager is required', { section: 'bots' });
  }
  if (!channelManager) {
    throw new StatusCommandError('channelManager is required', { section: 'channels' });
  }

  const write = msg => output.write(msg);

  write('\n\uD83E\uDD16 AI Army Status\n');

  // === Bots Section ===
  write('\nBots:\n');
  try {
    const botEntries = await collectBotStatus(botManager, storage);

    if (botEntries.length === 0) {
      write('  No bots loaded\n');
    } else {
      for (const entry of botEntries) {
        const icon = getStatusIcon(entry.status);
        let line = `  ${icon} ${entry.id} (${entry.status})`;
        if (entry.activeSessions > 0) {
          const label = pluralize(entry.activeSessions, 'active session', 'active sessions');
          line += ` - ${entry.activeSessions} ${label}`;
        }
        write(`${line}\n`);
      }
    }
  } catch (err) {
    write(`  \u274C Error loading bot status: ${err.message}\n`);
  }

  // === Database Section ===
  write('\nDatabase:\n');
  try {
    const dbInfo = await collectDatabaseStatus(storage);

    if (!dbInfo.connected) {
      write('  \u274C Not connected\n');
    } else {
      const versionLabel = dbInfo.version ? `PostgreSQL ${dbInfo.version}` : 'PostgreSQL';
      write(`  \u2705 Connected to ${versionLabel}\n`);
      write(`  \uD83D\uDCCA ${formatNumber(dbInfo.totalSessions)} total sessions\n`);
      write(`  \uD83D\uDCDD ${formatNumber(dbInfo.messagesProcessed)} messages processed\n`);
    }
  } catch (err) {
    write(`  \u274C Error checking database: ${err.message}\n`);
  }

  // === Channels Section ===
  write('\nChannels:\n');
  try {
    const channelEntries = collectChannelStatus(channelManager);

    if (channelEntries.length === 0) {
      write('  No channels configured\n');
    } else {
      for (const entry of channelEntries) {
        const icon = getStatusIcon(entry.status);
        const label = channelStatusLabel(entry.status);
        write(`  ${icon} ${entry.name} (${label})\n`);
      }
    }
  } catch (err) {
    write(`  \u274C Error loading channel status: ${err.message}\n`);
  }

  // === Workers Section ===
  if (workerRegistry) {
    write('\nWorkers:\n');
    try {
      const workerEntries = await collectWorkerStatus(workerRegistry);

      if (workerEntries.length === 0) {
        write('  No workers registered\n');
      } else {
        for (const entry of workerEntries) {
          const icon = getStatusIcon(entry.status);
          const label = workerStatusLabel(entry.status);
          const loadLabel = pluralize(entry.currentLoad, 'container', 'containers');
          write(
            `  ${icon} ${entry.id} (${entry.type}, ${label}) - ` +
              `${entry.currentLoad}/${entry.maxContainers} ${loadLabel}\n`
          );
        }
      }
    } catch (err) {
      write(`  \u274C Error loading worker status: ${err.message}\n`);
    }
  }

  write('\n');
}

/**
 * Run the status command from the CLI
 *
 * CLI-friendly entry point that shows database connection status
 * when only a storage connection is available (no running managers).
 * When botManager/channelManager are provided, delegates to {@link showStatus}
 * for the full system view.
 *
 * @param {Object} options - Status command options
 * @param {Object} [options.storage] - PostgresStorage instance (connected)
 * @param {Object} [options.botManager] - BotManager instance (optional from CLI)
 * @param {Object} [options.channelManager] - ChannelManager instance (optional from CLI)
 * @param {Object} [options.workerRegistry] - WorkerRegistry instance (optional)
 * @param {Object} [options.output=process.stdout] - Writable stream for output
 * @returns {Promise<{ success: boolean }>} Result indicating success
 */
export async function runStatus({
  storage,
  botManager,
  channelManager,
  workerRegistry,
  output = process.stdout,
} = {}) {
  const write = msg => output.write(msg);

  // If full managers are available, delegate to the rich showStatus view
  if (botManager && channelManager) {
    try {
      await showStatus({ storage, botManager, channelManager, workerRegistry, output });
      return { success: true };
    } catch (err) {
      write(`❌ Status error: ${err.message}\n`);
      return { success: false };
    }
  }

  // CLI-only mode: show database status when managers aren't available
  write('\n🤖 AI Army Status\n');

  write('\nDatabase:\n');
  try {
    const dbInfo = await collectDatabaseStatus(storage);

    if (!dbInfo.connected) {
      write('  ❌ Not connected\n');
    } else {
      const versionLabel = dbInfo.version ? `PostgreSQL ${dbInfo.version}` : 'PostgreSQL';
      write(`  ✅ Connected to ${versionLabel}\n`);
      write(`  📊 ${formatNumber(dbInfo.totalSessions)} total sessions\n`);
      write(`  📝 ${formatNumber(dbInfo.messagesProcessed)} messages processed\n`);
    }
  } catch (err) {
    write(`  ❌ Error checking database: ${err.message}\n`);
  }

  write('\nℹ️  Run with a running system (ai-army start) for full bot and channel status.\n');
  write('\n');

  return { success: true };
}

export default showStatus;
