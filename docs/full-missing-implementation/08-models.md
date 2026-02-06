# Missing: Model Provider System

**Status:** 🟡 Partially Implemented
**Priority:** Medium
**Design Doc:** [docs/idea/08-ai-sdks.md](../idea/08-ai-sdks.md)

## What Exists

✅ Vercel AI SDK dependencies:
- `@ai-sdk/anthropic`
- `@ai-sdk/openai`
- `ai` (core SDK)

✅ `src/models/model-factory.js` file exists

## What's Missing

### 1. Model Factory Implementation

**File exists but likely incomplete:**
```javascript
// src/models/model-factory.js - Needs implementation
class ModelFactory {
  // Missing methods:
  createModel(provider, modelName, config)
  getAvailableModels(provider)
  validateModelConfig(config)
  getModelCapabilities(provider, modelName)
}
```

### 2. Provider Registry

**Not implemented:**
```javascript
// src/models/provider-registry.js - NOT IMPLEMENTED
class ProviderRegistry {
  registerProvider(name, adapter)
  getProvider(name)
  listProviders()
  validateProvider(config)
}
```

**Built-in providers to support:**
- `anthropic` - Claude models
- `openai` - GPT models
- `openrouter` - Multi-model proxy
- `google` - Gemini models
- `ollama` - Local models

### 3. Configuration Format

**Provider definitions not validated:**
```json
{
  "providers": {
    "anthropic": {
      "type": "anthropic",
      "apiKey": "${ANTHROPIC_API_KEY}",
      "baseURL": "https://api.anthropic.com"
    },
    "openrouter": {
      "type": "openrouter",
      "apiKey": "${OPENROUTER_API_KEY}",
      "baseURL": "https://openrouter.ai/api/v1"
    },
    "ollama": {
      "type": "ollama",
      "baseURL": "http://localhost:11434"
    }
  }
}
```

**Bot references provider:**
```json
{
  "id": "work-bot",
  "provider": "anthropic",
  "model": "claude-sonnet-4-5",
  "modelConfig": {
    "temperature": 0.7,
    "maxTokens": 4096
  }
}
```

### 4. Model Adapters

**Vercel AI SDK integration:**
```javascript
// src/models/adapters/anthropic-adapter.js
import { anthropic } from '@ai-sdk/anthropic';

export class AnthropicAdapter {
  createModel(modelName, config) {
    return anthropic(modelName, {
      apiKey: config.apiKey,
      baseURL: config.baseURL
    });
  }
}
```

**Similar adapters needed for:**
- OpenAI
- OpenRouter
- Google (Gemini)
- Ollama

### 5. Model Capabilities

**Track what each provider supports:**
```javascript
const PROVIDER_CAPABILITIES = {
  anthropic: {
    streaming: true,
    tools: true,
    vision: true,
    maxTokens: 200000,
    models: ['claude-sonnet-4-5', 'claude-opus-4-6', 'claude-haiku-4-5']
  },
  openai: {
    streaming: true,
    tools: true,
    vision: true,
    maxTokens: 128000,
    models: ['gpt-4o', 'gpt-4', 'gpt-3.5-turbo']
  },
  ollama: {
    streaming: true,
    tools: true,
    vision: false,
    maxTokens: null,
    models: null // Dynamic, query at runtime
  }
};
```

### 6. Model Selection Logic

**Smart model selection:**
```javascript
class ModelSelector {
  selectBestModel(requirements) {
    // Choose based on:
    // - Required capabilities (tools, vision)
    // - Token budget
    // - Cost constraints
    // - Latency requirements
  }
}
```

### 7. Fallback Logic

**Not implemented:**
```json
{
  "id": "work-bot",
  "provider": "anthropic",
  "model": "claude-sonnet-4-5",
  "fallback": {
    "provider": "openrouter",
    "model": "anthropic/claude-sonnet-4.5"
  }
}
```

**Fallback on:**
- Rate limits (429)
- Service unavailable (503)
- API errors (500)

## Current State

**What Works:**
- Basic Anthropic model usage (hardcoded)
- Vercel AI SDK installed

**What Doesn't Work:**
- Dynamic provider selection
- Multiple provider support
- Model capability checking
- Fallback logic
- Cost tracking
- Model validation

## Implementation Path

### Step 1: Model Factory
1. Implement `ModelFactory.createModel()`
2. Support anthropic provider first
3. Test model creation
4. Add to MessageProcessor

### Step 2: Provider Adapters
1. Create adapter for each provider
2. Wrap Vercel AI SDK for each
3. Test model creation per provider
4. Handle provider-specific quirks

### Step 3: Configuration
1. Extend ConfigValidator for providers
2. Validate provider configs
3. Validate model names per provider
4. Test config validation

### Step 4: Provider Registry
1. Implement ProviderRegistry
2. Register built-in providers
3. Support custom provider registration
4. Wire into Orchestrator

### Step 5: Capabilities
1. Define capability schema
2. Add capabilities for each provider
3. Validate bot config against capabilities
4. Warn about unsupported features

### Step 6: Fallback
1. Implement fallback logic
2. Retry with fallback on failure
3. Log fallback usage
4. Test fallback scenarios

### Step 7: Ollama Support
1. Query available models at runtime
2. Handle local model paths
3. Test with local Ollama instance
4. Document Ollama setup

## Files to Create/Update

```
src/models/model-factory.js (enhance)
src/models/provider-registry.js (new)
src/models/adapters/anthropic-adapter.js (new)
src/models/adapters/openai-adapter.js (new)
src/models/adapters/openrouter-adapter.js (new)
src/models/adapters/ollama-adapter.js (new)
src/models/capabilities.js (new)
test/unit/model-factory.test.js
test/integration/multi-provider.test.js
```

## Configuration Example

```json
{
  "providers": {
    "anthropic": {
      "type": "anthropic",
      "apiKey": "${ANTHROPIC_API_KEY}"
    },
    "openai": {
      "type": "openai",
      "apiKey": "${OPENAI_API_KEY}"
    },
    "ollama": {
      "type": "ollama",
      "baseURL": "http://localhost:11434"
    }
  },
  "bots": {
    "work-bot": {
      "provider": "anthropic",
      "model": "claude-sonnet-4-5",
      "fallback": {
        "provider": "openai",
        "model": "gpt-4"
      }
    },
    "local-bot": {
      "provider": "ollama",
      "model": "llama3:8b"
    }
  }
}
```

## Dependencies

- ✅ @ai-sdk/anthropic (installed)
- ✅ @ai-sdk/openai (installed)
- Need: @ai-sdk/google (for Gemini)
- Need: ollama SDK (for local models)

## Complexity: Low-Medium
- Mostly wrapping existing SDK
- Well-defined adapter pattern
- Straightforward config validation
