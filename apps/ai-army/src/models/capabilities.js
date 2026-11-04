/**
 * Provider Capabilities - Defines capabilities and constraints for each AI provider
 *
 * Contains frozen capability definitions for each supported provider, including
 * streaming support, tool usage, vision capabilities, token limits, and available models.
 *
 * @module models/capabilities
 */

/**
 * Anthropic provider capabilities
 * @type {Readonly<Object>}
 */
const ANTHROPIC_CAPABILITIES = Object.freeze({
  streaming: true,
  tools: true,
  vision: true,
  maxTokens: 200000,
  models: Object.freeze([
    'claude-opus-4-20250514',
    'claude-sonnet-4-20250514',
    'claude-sonnet-4-5-20250514',
    'claude-haiku-4-5-20250414',
    'claude-sonnet-4-5',
    'claude-opus-4',
    'claude-sonnet-4',
    'claude-haiku-4-5',
  ]),
});

/**
 * OpenAI provider capabilities
 * @type {Readonly<Object>}
 */
const OPENAI_CAPABILITIES = Object.freeze({
  streaming: true,
  tools: true,
  vision: true,
  maxTokens: 128000,
  models: Object.freeze([
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'gpt-4',
    'gpt-3.5-turbo',
    'o1',
    'o1-mini',
    'o1-preview',
  ]),
});

/**
 * OpenRouter provider capabilities
 * @type {Readonly<Object>}
 */
const OPENROUTER_CAPABILITIES = Object.freeze({
  streaming: true,
  tools: true,
  vision: true,
  maxTokens: null,
  models: null, // Dynamic - OpenRouter supports many models from various providers
});

/**
 * Ollama provider capabilities
 * @type {Readonly<Object>}
 */
const OLLAMA_CAPABILITIES = Object.freeze({
  streaming: true,
  tools: true,
  vision: false,
  maxTokens: null,
  models: null, // Dynamic - depends on locally installed models
});

/**
 * Google provider capabilities
 * @type {Readonly<Object>}
 */
const GOOGLE_CAPABILITIES = Object.freeze({
  streaming: true,
  tools: true,
  vision: true,
  maxTokens: 1000000,
  models: Object.freeze([
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
  ]),
});

/**
 * Frozen map of provider capabilities keyed by provider type identifier
 *
 * Each provider entry contains:
 * - `streaming` {boolean} - Whether the provider supports streaming responses
 * - `tools` {boolean} - Whether the provider supports tool/function calling
 * - `vision` {boolean} - Whether the provider supports vision/image inputs
 * - `maxTokens` {number|null} - Maximum context window size (null = dynamic/unknown)
 * - `models` {string[]|null} - List of known model identifiers (null = dynamic)
 *
 * @type {Readonly<Object>}
 *
 * @example
 * import { PROVIDER_CAPABILITIES } from './capabilities.js';
 * const caps = PROVIDER_CAPABILITIES.anthropic;
 * console.log(caps.streaming); // true
 * console.log(caps.maxTokens); // 200000
 */
export const PROVIDER_CAPABILITIES = Object.freeze({
  anthropic: ANTHROPIC_CAPABILITIES,
  openai: OPENAI_CAPABILITIES,
  openrouter: OPENROUTER_CAPABILITIES,
  ollama: OLLAMA_CAPABILITIES,
  google: GOOGLE_CAPABILITIES,
});

/**
 * HTTP status codes that should trigger a fallback attempt
 * @type {Readonly<number[]>}
 */
export const FALLBACK_STATUS_CODES = Object.freeze([
  429, // Too Many Requests (rate limit)
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
]);

/**
 * Default maximum number of fallback attempts
 * @type {number}
 */
export const DEFAULT_MAX_FALLBACK_ATTEMPTS = 3;

/**
 * Get capabilities for a given provider
 *
 * @param {string} provider - Provider type identifier
 * @returns {Object|null} Capabilities object or null if provider not found
 *
 * @example
 * const caps = getProviderCapabilities('anthropic');
 * if (caps?.tools) { console.log('Tools supported'); }
 */
export const getProviderCapabilities = provider => {
  if (!provider || typeof provider !== 'string') {
    return null;
  }
  return PROVIDER_CAPABILITIES[provider] || null;
};

/**
 * Check if a provider supports a specific capability
 *
 * @param {string} provider - Provider type identifier
 * @param {string} capability - Capability name ('streaming', 'tools', 'vision')
 * @returns {boolean} True if the provider supports the capability
 *
 * @example
 * hasCapability('anthropic', 'vision'); // true
 * hasCapability('ollama', 'vision');    // false
 */
export const hasCapability = (provider, capability) => {
  const caps = getProviderCapabilities(provider);
  if (!caps) {
    return false;
  }
  return caps[capability] === true;
};
