/**
 * EnvAdapter - Environment variable secret management
 */

export class EnvAdapter {
  async initialize(config) {
    console.log('🔐 Initializing Environment adapter');
    // TODO: Implementation
  }

  async getSecret(key) {
    console.log(`🔑 Fetching secret from env: ${key}`);
    return process.env[key] || null;
  }
}
