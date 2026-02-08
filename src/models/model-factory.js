/**
 * ModelFactory - Creates Vercel AI SDK model instances for multiple providers
 *
 * Provides a unified factory for creating language model instances across
 * Anthropic, OpenAI, OpenRouter, and Ollama providers. Uses the Vercel AI SDK
 * provider packages under the hood. Supports fallback logic for resilient
 * model creation across multiple provider/model combinations.
 *
 * @module models/model-factory
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';

import { FALLBACK_STATUS_CODES, DEFAULT_MAX_FALLBACK_ATTEMPTS } from './capabilities.js';

/**
 * Custom error class for model creation errors
 */
export class ModelFactoryError extends Error {
  /**
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {string} [options.provider] - Provider that caused the error
   * @param {string} [options.modelName] - Model name that was requested
   * @param {Error} [options.cause] - Original error that caused this
   */
  constructor(message, options = {}) {
    super(message);
    this.name = 'ModelFactoryError';
    this.provider = options.provider;
    this.modelName = options.modelName;
    this.cause = options.cause;
  }
}

/**
 * Supported provider identifiers
 * @type {string[]}
 */
const SUPPORTED_PROVIDERS = ['anthropic', 'openai', 'openrouter', 'ollama'];

/**
 * Default OpenRouter API base URL
 * @type {string}
 */
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * Default Ollama API base URL
 * @type {string}
 */
const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434/v1';

/**
 * Factory for creating Vercel AI SDK language model instances
 *
 * Supports multiple providers through a unified interface.
 * Each provider is backed by the appropriate AI SDK package.
 *
 * @example
 * const model = ModelFactory.createModel('anthropic', 'claude-sonnet-4-5', 'sk-ant-...');
 * const result = await generateText({ model, prompt: 'Hello!' });
 *
 * @example
 * // OpenRouter for multi-model gateway
 * const model = ModelFactory.createModel('openrouter', 'anthropic/claude-sonnet-4-5', 'sk-or-...');
 *
 * @example
 * // Ollama for local models (no real API key needed)
 * const model = ModelFactory.createModel('ollama', 'llama3.2:latest');
 */
export class ModelFactory {
  /**
   * Create a Vercel AI SDK language model instance
   *
   * @param {string} provider - Provider identifier ('anthropic', 'openai', 'openrouter', 'ollama')
   * @param {string} modelName - Model name (e.g., 'claude-sonnet-4-5', 'gpt-4o')
   * @param {string} [apiKey] - API key for the provider (optional for ollama)
   * @param {Object} [options={}] - Additional provider options
   * @param {string} [options.baseUrl] - Custom base URL (overrides defaults)
   * @returns {import('ai').LanguageModel} Vercel AI SDK language model instance
   * @throws {ModelFactoryError} If provider is unsupported or model creation fails
   *
   * @example
   * const model = ModelFactory.createModel('anthropic', 'claude-sonnet-4-5', 'sk-ant-...');
   */
  static createModel(provider, modelName, apiKey, options = {}) {
    if (!provider || typeof provider !== 'string') {
      throw new ModelFactoryError('Provider is required and must be a string', {
        provider,
        modelName,
      });
    }

    if (!modelName || typeof modelName !== 'string') {
      throw new ModelFactoryError('Model name is required and must be a string', {
        provider,
        modelName,
      });
    }

    if (!SUPPORTED_PROVIDERS.includes(provider)) {
      throw new ModelFactoryError(
        `Unsupported provider: "${provider}". Supported providers: ${SUPPORTED_PROVIDERS.join(', ')}`,
        { provider, modelName }
      );
    }

    try {
      switch (provider) {
        case 'anthropic':
          return createAnthropicModel(modelName, apiKey);
        case 'openai':
          return createOpenAIModel(modelName, apiKey, options);
        case 'openrouter':
          return createOpenRouterModel(modelName, apiKey, options);
        case 'ollama':
          return createOllamaModel(modelName, options);
        /* c8 ignore next 2 */
        default:
          throw new ModelFactoryError(`Unhandled provider: "${provider}"`, { provider, modelName });
      }
    } catch (err) {
      if (err instanceof ModelFactoryError) {
        throw err;
      }
      throw new ModelFactoryError(`Failed to create model for provider "${provider}"`, {
        provider,
        modelName,
        cause: err,
      });
    }
  }

  /**
   * Get list of supported provider identifiers
   *
   * @returns {string[]} Array of supported provider names
   *
   * @example
   * ModelFactory.getSupportedProviders(); // ['anthropic', 'openai', 'openrouter', 'ollama']
   */
  static getSupportedProviders() {
    return [...SUPPORTED_PROVIDERS];
  }

  /**
   * Check if a provider is supported
   *
   * @param {string} provider - Provider identifier to check
   * @returns {boolean} True if the provider is supported
   *
   * @example
   * ModelFactory.isProviderSupported('anthropic'); // true
   * ModelFactory.isProviderSupported('cohere');     // false
   */
  static isProviderSupported(provider) {
    return SUPPORTED_PROVIDERS.includes(provider);
  }

  /**
   * Create a model with automatic fallback support
   *
   * Attempts to create and optionally validate the primary model. If creation
   * fails, iterates through fallback configurations in order until one succeeds
   * or all options are exhausted.
   *
   * @param {Object} config - Model configuration with fallbacks
   * @param {string} config.provider - Primary provider identifier
   * @param {string} config.model - Primary model name
   * @param {string} [config.apiKey] - API key for the primary provider
   * @param {Object} [config.options={}] - Additional provider options
   * @param {Array<Object>} [config.fallbacks=[]] - Fallback model configurations
   * @param {string} config.fallbacks[].provider - Fallback provider identifier
   * @param {string} config.fallbacks[].model - Fallback model name
   * @param {string} [config.fallbacks[].apiKey] - Fallback API key
   * @param {Object} [config.fallbacks[].options] - Fallback provider options
   * @param {Function} [config.onFallback] - Callback invoked when a fallback is used
   * @returns {Object} Result object with { model, provider, modelName, fallbackUsed, attempts }
   * @throws {ModelFactoryError} If all attempts (primary + fallbacks) fail
   *
   * @example
   * const result = ModelFactory.createModelWithFallback({
   *   provider: 'anthropic',
   *   model: 'claude-sonnet-4-5',
   *   apiKey: 'sk-ant-...',
   *   fallbacks: [
   *     { provider: 'openrouter', model: 'anthropic/claude-sonnet-4-5', apiKey: 'sk-or-...' },
   *     { provider: 'ollama', model: 'llama3.2:latest' },
   *   ],
   * });
   * console.log(result.fallbackUsed); // false if primary succeeded
   */
  static createModelWithFallback(config) {
    if (!config || typeof config !== 'object') {
      throw new ModelFactoryError('Configuration object is required for createModelWithFallback');
    }

    const { provider, model: modelName, apiKey, options = {}, fallbacks = [], onFallback } = config;

    if (!provider || !modelName) {
      throw new ModelFactoryError(
        'Primary provider and model are required in fallback configuration',
        { provider, modelName }
      );
    }

    const maxAttempts = Math.min(1 + fallbacks.length, DEFAULT_MAX_FALLBACK_ATTEMPTS + 1);
    const errors = [];

    // Build the ordered list of attempts: primary first, then fallbacks
    const attempts = [
      { provider, model: modelName, apiKey, options },
      ...fallbacks.slice(0, maxAttempts - 1),
    ];

    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i];
      const isFallback = i > 0;

      try {
        const createdModel = ModelFactory.createModel(
          attempt.provider,
          attempt.model,
          attempt.apiKey,
          attempt.options || {}
        );

        // Notify about fallback usage
        if (isFallback && typeof onFallback === 'function') {
          onFallback({
            originalProvider: provider,
            originalModel: modelName,
            fallbackProvider: attempt.provider,
            fallbackModel: attempt.model,
            attemptIndex: i,
            errors: errors.map(e => e.message),
          });
        }

        return {
          model: createdModel,
          provider: attempt.provider,
          modelName: attempt.model,
          fallbackUsed: isFallback,
          attempts: i + 1,
        };
      } catch (err) {
        errors.push(err);
      }
    }

    // All attempts failed
    const errorMessages = errors.map((e, i) => {
      const attempt = attempts[i];
      return `  [${i + 1}] ${attempt.provider}/${attempt.model}: ${e.message}`;
    });

    throw new ModelFactoryError(
      `All model creation attempts failed (${errors.length} tried):\n${errorMessages.join('\n')}`,
      {
        provider,
        modelName,
        cause: errors[0],
      }
    );
  }

  /**
   * Check if an error is eligible for fallback
   *
   * Determines whether an error (typically from an API call) should trigger
   * a fallback attempt based on HTTP status code or error type.
   *
   * @param {Error} error - The error to check
   * @returns {boolean} True if the error should trigger a fallback
   *
   * @example
   * try {
   *   await generateText({ model, prompt: 'Hello' });
   * } catch (err) {
   *   if (ModelFactory.isFallbackEligible(err)) {
   *     // Try fallback provider
   *   }
   * }
   */
  static isFallbackEligible(error) {
    if (!error) {
      return false;
    }

    // Check for HTTP status codes that warrant fallback
    const statusCode = error.statusCode || error.status || error.code;
    if (typeof statusCode === 'number' && FALLBACK_STATUS_CODES.includes(statusCode)) {
      return true;
    }

    // Check for common transient error patterns
    const message = (error.message || '').toLowerCase();
    const transientPatterns = [
      'rate limit',
      'too many requests',
      'service unavailable',
      'timeout',
      'econnrefused',
      'econnreset',
      'enotfound',
      'network error',
    ];

    return transientPatterns.some(pattern => message.includes(pattern));
  }
}

/**
 * Create an Anthropic (Claude) model instance
 *
 * @param {string} modelName - Model name (e.g., 'claude-sonnet-4-5')
 * @param {string} [apiKey] - Anthropic API key
 * @returns {import('ai').LanguageModel} Language model instance
 * @private
 */
function createAnthropicModel(modelName, apiKey) {
  const config = {};
  if (apiKey) {
    config.apiKey = apiKey;
  }
  const provider = createAnthropic(config);
  return provider(modelName);
}

/**
 * Create an OpenAI model instance
 *
 * @param {string} modelName - Model name (e.g., 'gpt-4o')
 * @param {string} [apiKey] - OpenAI API key
 * @param {Object} [options={}] - Additional options
 * @param {string} [options.baseUrl] - Custom base URL
 * @returns {import('ai').LanguageModel} Language model instance
 * @private
 */
function createOpenAIModel(modelName, apiKey, options = {}) {
  const config = {};
  if (apiKey) {
    config.apiKey = apiKey;
  }
  if (options.baseUrl) {
    config.baseURL = options.baseUrl;
  }
  const provider = createOpenAI(config);
  return provider(modelName);
}

/**
 * Create an OpenRouter model instance
 *
 * Uses the OpenAI-compatible API with OpenRouter's base URL.
 *
 * @param {string} modelName - Model name (e.g., 'anthropic/claude-sonnet-4-5')
 * @param {string} [apiKey] - OpenRouter API key
 * @param {Object} [options={}] - Additional options
 * @param {string} [options.baseUrl] - Custom base URL (overrides default)
 * @returns {import('ai').LanguageModel} Language model instance
 * @private
 */
function createOpenRouterModel(modelName, apiKey, options = {}) {
  const config = {
    baseURL: options.baseUrl || OPENROUTER_BASE_URL,
  };
  if (apiKey) {
    config.apiKey = apiKey;
  }
  const provider = createOpenAI(config);
  return provider(modelName);
}

/**
 * Create an Ollama model instance
 *
 * Uses the OpenAI-compatible API with Ollama's local base URL.
 * API key defaults to 'ollama' (required by SDK but not checked by Ollama).
 *
 * @param {string} modelName - Model name (e.g., 'llama3.2:latest')
 * @param {Object} [options={}] - Additional options
 * @param {string} [options.baseUrl] - Custom base URL (overrides default and env)
 * @returns {import('ai').LanguageModel} Language model instance
 * @private
 */
function createOllamaModel(modelName, options = {}) {
  const baseURL = options.baseUrl || process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL;
  const provider = createOpenAI({
    baseURL,
    apiKey: 'ollama',
  });
  return provider(modelName);
}
