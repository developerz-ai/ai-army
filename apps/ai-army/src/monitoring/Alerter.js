/**
 * Alerter - Threshold-based alerting with Slack webhook support
 *
 * Monitors health check results and triggers alerts when components
 * transition to unhealthy or degraded states. Supports multiple alert
 * channels (currently Slack webhooks) and implements cooldown logic
 * to prevent alert flooding.
 *
 * Features:
 * - Threshold-based alerting (configurable consecutive failure count)
 * - Slack webhook integration for alert delivery
 * - Cooldown period to avoid duplicate alerts
 * - Recovery notifications when components return to healthy
 * - Alert history tracking
 *
 * @module monitoring/Alerter
 */

import { HEALTH_STATUSES } from './HealthMonitor.js';

/**
 * Default cooldown period in milliseconds (5 minutes)
 * @type {number}
 */
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Default consecutive failure threshold before alerting
 * @type {number}
 */
const DEFAULT_THRESHOLD = 2;

/**
 * Alert severity levels
 * @type {Readonly<{WARNING: string, CRITICAL: string, RECOVERY: string}>}
 */
export const ALERT_SEVERITIES = Object.freeze({
  WARNING: 'warning',
  CRITICAL: 'critical',
  RECOVERY: 'recovery',
});

/**
 * Custom error for alerter failures
 */
export class AlerterError extends Error {
  /**
   * Create an AlerterError
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - The operation that failed
   * @param {string} [options.checkName] - Name of the health check involved
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'AlerterError';
    this.operation = options.operation;
    this.checkName = options.checkName;
  }
}

/**
 * Alerter - monitors health check results and sends alerts
 *
 * @example
 * const alerter = new Alerter({
 *   logger: console.log,
 *   slack: { webhook: 'https://hooks.slack.com/services/...' },
 *   threshold: 2,
 *   cooldownMs: 300000,
 * });
 * await alerter.evaluate({ database: { status: 'unhealthy', error: 'Connection refused' } });
 */
export class Alerter {
  /**
   * Create an Alerter instance
   *
   * @param {Object} [options={}] - Configuration options
   * @param {Function|null} [options.logger=null] - Logger function for events
   * @param {Object} [options.slack] - Slack webhook configuration
   * @param {string} [options.slack.webhook] - Slack incoming webhook URL
   * @param {string} [options.slack.channel] - Override channel (optional)
   * @param {string} [options.slack.username] - Override username (optional)
   * @param {number} [options.threshold=2] - Consecutive failures before alerting
   * @param {number} [options.cooldownMs=300000] - Cooldown between repeated alerts in ms
   * @param {Function} [options.fetch] - Custom fetch function (for testing)
   */
  constructor(options = {}) {
    /** @type {Function|null} Logger function */
    this.logger = options.logger || null;

    /** @type {Object|null} Slack configuration */
    this.slack = options.slack || null;

    /** @type {number} Consecutive failure threshold */
    this.threshold = options.threshold ?? DEFAULT_THRESHOLD;

    /** @type {number} Cooldown period in ms */
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;

    /** @type {Function} Fetch implementation */
    this._fetch = options.fetch || globalThis.fetch;

    /**
     * Tracks consecutive failure counts per check
     * @type {Map<string, number>}
     */
    this._failureCounts = new Map();

    /**
     * Tracks the last alert time per check for cooldown
     * @type {Map<string, number>}
     */
    this._lastAlertTime = new Map();

    /**
     * Tracks previous status per check for recovery detection
     * @type {Map<string, string>}
     */
    this._previousStatus = new Map();

    /**
     * Alert history (most recent first, capped at 100)
     * @type {Array<Object>}
     */
    this.alertHistory = [];

    if (typeof this.threshold !== 'number' || this.threshold < 1) {
      throw new AlerterError('Threshold must be a positive integer', {
        operation: 'constructor',
      });
    }

    if (typeof this.cooldownMs !== 'number' || this.cooldownMs < 0) {
      throw new AlerterError('Cooldown must be a non-negative number', {
        operation: 'constructor',
      });
    }
  }

  /**
   * Evaluate health check results and send alerts as needed
   *
   * Examines each check result, tracks consecutive failures, and
   * triggers alerts when the threshold is exceeded. Also detects
   * recovery (transition back to healthy) and sends recovery alerts.
   *
   * @param {Object} checkResults - Map of check name to result from HealthMonitor.runChecks()
   * @returns {Promise<Array<Object>>} Array of alerts that were sent
   */
  async evaluate(checkResults) {
    if (!checkResults || typeof checkResults !== 'object') {
      return [];
    }

    const sentAlerts = [];

    for (const [name, result] of Object.entries(checkResults)) {
      const { status } = result;
      const previousStatus = this._previousStatus.get(name);

      if (status === HEALTH_STATUSES.UNHEALTHY || status === HEALTH_STATUSES.DEGRADED) {
        // Increment failure count
        const count = (this._failureCounts.get(name) || 0) + 1;
        this._failureCounts.set(name, count);

        // Check if we should alert
        if (count >= this.threshold && this._canAlert(name)) {
          const severity =
            status === HEALTH_STATUSES.UNHEALTHY
              ? ALERT_SEVERITIES.CRITICAL
              : ALERT_SEVERITIES.WARNING;

          const alert = await this._sendAlert(name, status, severity, result);
          if (alert) {
            sentAlerts.push(alert);
          }
        }
      } else if (status === HEALTH_STATUSES.HEALTHY) {
        // Check for recovery
        const wasUnhealthy =
          previousStatus === HEALTH_STATUSES.UNHEALTHY ||
          previousStatus === HEALTH_STATUSES.DEGRADED;

        if (wasUnhealthy && this._failureCounts.get(name) > 0) {
          const alert = await this._sendAlert(name, status, ALERT_SEVERITIES.RECOVERY, result);
          if (alert) {
            sentAlerts.push(alert);
          }
        }

        // Reset failure count
        this._failureCounts.set(name, 0);
      }

      this._previousStatus.set(name, status);
    }

    return sentAlerts;
  }

  /**
   * Get the consecutive failure count for a specific check
   *
   * @param {string} name - Check name
   * @returns {number} Failure count (0 if not tracked)
   */
  getFailureCount(name) {
    return this._failureCounts.get(name) || 0;
  }

  /**
   * Get the alert history
   *
   * @param {number} [limit=10] - Maximum number of alerts to return
   * @returns {Array<Object>} Recent alerts (most recent first)
   */
  getAlertHistory(limit = 10) {
    return this.alertHistory.slice(0, limit);
  }

  /**
   * Reset tracking state for all checks
   */
  reset() {
    this._failureCounts.clear();
    this._lastAlertTime.clear();
    this._previousStatus.clear();
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  /**
   * Check if an alert can be sent (respects cooldown period)
   *
   * @param {string} name - Check name
   * @returns {boolean} True if cooldown has elapsed
   * @private
   */
  _canAlert(name) {
    const lastTime = this._lastAlertTime.get(name);
    if (!lastTime) {
      return true;
    }
    return Date.now() - lastTime >= this.cooldownMs;
  }

  /**
   * Send an alert through all configured channels
   *
   * @param {string} checkName - Name of the health check
   * @param {string} status - Current health status
   * @param {string} severity - Alert severity level
   * @param {Object} details - Check result details
   * @returns {Promise<Object|null>} Alert record or null if no channels configured
   * @private
   */
  async _sendAlert(checkName, status, severity, details) {
    const alert = {
      checkName,
      status,
      severity,
      details: { ...details },
      timestamp: new Date().toISOString(),
      delivered: [],
    };

    // Send to Slack if configured
    if (this.slack && this.slack.webhook) {
      try {
        await this._sendSlackAlert(alert);
        alert.delivered.push('slack');
      } catch (err) {
        this._log(`Failed to send Slack alert for '${checkName}': ${err.message}`);
      }
    }

    // Update cooldown tracker
    this._lastAlertTime.set(checkName, Date.now());

    // Add to history (cap at 100)
    this.alertHistory.unshift(alert);
    if (this.alertHistory.length > 100) {
      this.alertHistory.length = 100;
    }

    this._log(
      `Alert [${severity}] ${checkName}: ${status}${
        alert.delivered.length > 0 ? ` (sent to: ${alert.delivered.join(', ')})` : ' (no channels)'
      }`
    );

    return alert;
  }

  /**
   * Send an alert to Slack via incoming webhook
   *
   * @param {Object} alert - Alert record
   * @returns {Promise<void>}
   * @throws {AlerterError} If the webhook request fails
   * @private
   */
  async _sendSlackAlert(alert) {
    const { checkName, status, severity, details, timestamp } = alert;

    const emoji = this._severityEmoji(severity);
    const color = this._severityColor(severity);

    const text =
      severity === ALERT_SEVERITIES.RECOVERY
        ? `${emoji} *Recovery:* \`${checkName}\` is now *${status}*`
        : `${emoji} *Alert:* \`${checkName}\` is *${status}*`;

    const fields = [];

    if (details.error) {
      fields.push({ title: 'Error', value: details.error, short: false });
    }

    if (typeof details.latency === 'number' || typeof details.latencyMs === 'number') {
      const latency = details.latency ?? details.latencyMs;
      fields.push({ title: 'Latency', value: `${latency}ms`, short: true });
    }

    if (typeof details.running === 'number') {
      fields.push({
        title: 'Running',
        value: `${details.running}/${details.total || '?'}`,
        short: true,
      });
    }

    if (typeof details.connected === 'number') {
      fields.push({
        title: 'Connected',
        value: `${details.connected}/${details.total || '?'}`,
        short: true,
      });
    }

    if (typeof details.available === 'number') {
      fields.push({
        title: 'Available',
        value: `${details.available}/${details.total || '?'}`,
        short: true,
      });
    }

    fields.push({ title: 'Severity', value: severity, short: true });
    fields.push({ title: 'Time', value: timestamp, short: true });

    const payload = {
      text,
      attachments: [
        {
          color,
          fields,
          fallback: `${severity}: ${checkName} is ${status}`,
        },
      ],
    };

    if (this.slack.channel) {
      payload.channel = this.slack.channel;
    }

    if (this.slack.username) {
      payload.username = this.slack.username;
    }

    const response = await this._fetch(this.slack.webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new AlerterError(`Slack webhook returned ${response.status}: ${response.statusText}`, {
        operation: 'sendSlackAlert',
        checkName,
      });
    }
  }

  /**
   * Get emoji for alert severity
   *
   * @param {string} severity - Alert severity
   * @returns {string} Emoji character
   * @private
   */
  _severityEmoji(severity) {
    switch (severity) {
      case ALERT_SEVERITIES.CRITICAL:
        return '\u{1F6A8}';
      case ALERT_SEVERITIES.WARNING:
        return '\u26A0\uFE0F';
      case ALERT_SEVERITIES.RECOVERY:
        return '\u2705';
      default:
        return '\u2139\uFE0F';
    }
  }

  /**
   * Get Slack attachment color for alert severity
   *
   * @param {string} severity - Alert severity
   * @returns {string} Hex color code
   * @private
   */
  _severityColor(severity) {
    switch (severity) {
      case ALERT_SEVERITIES.CRITICAL:
        return '#dc3545';
      case ALERT_SEVERITIES.WARNING:
        return '#ffc107';
      case ALERT_SEVERITIES.RECOVERY:
        return '#28a745';
      default:
        return '#6c757d';
    }
  }

  /**
   * Log a message if logger is available
   *
   * @param {string} message - Message to log
   * @private
   */
  _log(message) {
    if (this.logger) {
      this.logger(`[Alerter] ${message}`);
    }
  }
}

export default Alerter;
