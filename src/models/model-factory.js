/**
 * ModelFactory - Creates Vercel AI SDK model instances for multiple providers
 *
 * Provides a unified factory for creating language model instances across
 * Anthropic, OpenAI, OpenRouter, and Ollama providers. Uses the Vercel AI SDK
 * provider packages under the hood.
 *
 * @module models/model-factory
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';

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
