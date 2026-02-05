/**
 * RESTAdapter - REST API channel for HTTP-based interactions
 */

export class RESTAdapter {
  async initialize(_config) {
    console.log('🌐 Initializing REST adapter');
    // TODO: Implementation
  }

  async sendMessage(sessionId, _text) {
    console.log(`📤 Sending message via REST: ${sessionId}`);
    // TODO: Implementation
  }

  async handleRequest(_req, _res) {
    console.log('📨 Handling REST request');
    // TODO: Implementation
  }
}
