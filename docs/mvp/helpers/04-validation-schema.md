# Validation & Schema Libraries

**Problem Areas**:
- Configuration validation (bot configs, main config)
- Runtime schema validation
- Type safety with TypeScript
- Tool parameter validation

---

## Schema Validation

### ✅ Recommended: Zod
**Install**: `npm install zod`

**Why**: TypeScript-first, zero dependencies, excellent type inference, fastest among alternatives, perfect for Vercel AI SDK

**Key Advantages**:
- Built for TypeScript with automatic type inference
- Zero dependencies (smallest bundle)
- Used by Vercel AI SDK for tool parameters
- Fastest validation performance
- Composable schemas

**Basic Usage**:
```javascript
import { z } from 'zod';

// Define schema
const BotConfigSchema = z.object({
  id: z.string().min(1),
  soul: z.string(),
  provider: z.enum(['anthropic', 'openai', 'openrouter', 'ollama']),
  model: z.string(),
  tools: z.array(z.string()).optional().default([]),
  sandbox: z.object({
    image: z.string().default('node:22-slim'),
    packages: z.array(z.string()).optional(),
    memory: z.string().default('2g'),
    cpus: z.number().default(2)
  }).optional()
});

// Validate
const config = BotConfigSchema.parse(rawConfig); // Throws on invalid

// Or safe parse
const result = BotConfigSchema.safeParse(rawConfig);
if (!result.success) {
  console.error(result.error.issues);
}

// TypeScript gets automatic type inference
type BotConfig = z.infer<typeof BotConfigSchema>;
```

**Vercel AI SDK Integration**:
```javascript
import { tool } from 'ai';
import { z } from 'zod';

// Tool parameters use Zod
const bashTool = tool({
  description: 'Execute bash command',
  parameters: z.object({
    command: z.string().describe('Bash command to execute'),
    timeout: z.number().optional().default(30000).describe('Timeout in ms')
  }),
  execute: async ({ command, timeout }) => {
    // command and timeout are validated and typed
    return await executeBash(command, { timeout });
  }
});
```

**Sources**:
- [Zod vs Yup vs Joi - Better Stack](https://betterstack.com/community/guides/scaling-nodejs/joi-vs-zod/)
- [Comparing Schema Validation Libraries - Bitovi](https://www.bitovi.com/blog/comparing-schema-validation-libraries-ajv-joi-yup-and-zod)
- [Yup vs. Zod vs. Joi - Medium](https://medium.com/@gimnathperera/yup-vs-zod-vs-joi-a-comprehensive-comparison-of-javascript-validation-libraries-4mhi)

**Alternatives**:
- **Joi** - Mature, feature-rich, but heavier (not ideal for TypeScript)
- **Yup** - Frontend-focused, less ideal for backend
- **AJV** - JSON Schema based, fast but more verbose

---

## Configuration Validator Implementation

```javascript
// src/config/ConfigValidator.js
import { z } from 'zod';

// Main config schema
const MainConfigSchema = z.object({
  defaults: z.object({
    model: z.object({
      provider: z.string(),
      model: z.string()
    }),
    sandbox: z.object({
      type: z.literal('docker'),
      image: z.string()
    }).optional()
  }).optional(),

  providers: z.record(z.object({
    type: z.enum(['anthropic', 'openai', 'openrouter', 'ollama']),
    apiKey: z.string().optional(),
    baseURL: z.string().url().optional()
  })),

  channels: z.record(z.object({
    type: z.enum(['slack', 'discord', 'rest']),
    botToken: z.string().optional(),
    appToken: z.string().optional(),
    token: z.string().optional()
  }))
});

// Bot config schema
const BotConfigSchema = z.object({
  id: z.string().min(1, 'Bot ID is required'),
  soul: z.string().min(1, 'Soul file path is required'),
  provider: z.enum(['anthropic', 'openai', 'openrouter', 'ollama']),
  model: z.string().min(1, 'Model name is required'),
  channel: z.string().optional(),

  tools: z.array(
    z.enum(['bash', 'readFile', 'writeFile', 'glob', 'grep'])
  ).optional().default([]),

  workspace: z.object({
    root: z.string()
  }).optional(),

  sandbox: z.object({
    type: z.literal('docker').default('docker'),
    image: z.string().default('node:22-slim'),
    packages: z.array(z.string()).optional(),
    memory: z.string().default('2g'),
    cpus: z.number().int().positive().default(2),
    network: z.string().default('bridge')
  }).optional(),

  restrictions: z.object({
    allowedUsers: z.array(z.string()).optional(),
    deniedUsers: z.array(z.string()).optional(),
    allowedChannels: z.array(z.string()).optional(),
    deniedChannels: z.array(z.string()).optional(),
    dmAllowed: z.boolean().default(true)
  }).optional(),

  compactionThreshold: z.number().int().positive().default(50000),
  maxSteps: z.number().int().positive().default(30)
});

export class ConfigValidator {
  validateMainConfig(config) {
    try {
      MainConfigSchema.parse(config);
      return { valid: true, errors: [] };
    } catch (err) {
      return {
        valid: false,
        errors: err.errors.map(e => ({
          path: e.path.join('.'),
          message: e.message,
          code: e.code
        }))
      };
    }
  }

  validateBotConfig(botConfig) {
    try {
      return BotConfigSchema.parse(botConfig);
    } catch (err) {
      const errors = err.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      throw new Error(`Bot configuration invalid:\n  ${errors.join('\n  ')}`);
    }
  }

  async validateAll(configPath) {
    const config = await ConfigLoader.load(configPath);
    const allErrors = [];

    // Validate main config
    const mainResult = this.validateMainConfig(config);
    if (!mainResult.valid) {
      allErrors.push(...mainResult.errors.map(e => `config.json: ${e.path} - ${e.message}`));
    }

    // Validate each bot
    for (const [botPath, botConfig] of Object.entries(config.bots || {})) {
      try {
        this.validateBotConfig(botConfig);
      } catch (err) {
        allErrors.push(`${botPath}: ${err.message}`);
      }
    }

    return allErrors;
  }

  generateReport(errors) {
    if (errors.length === 0) {
      return '✅ All configurations valid';
    }

    return `❌ Configuration errors found:\n\n${errors.map(e => `  - ${e}`).join('\n')}`;
  }
}
```

---

## Custom Validations

```javascript
// Environment variable validation
const EnvVarSchema = z.string().refine(
  (val) => /^\${[A-Z_][A-Z0-9_]*}$/.test(val),
  'Must be in format ${VAR_NAME}'
);

// Docker image validation
const DockerImageSchema = z.string().refine(
  (val) => /^[a-z0-9-]+:[a-z0-9.-]+$/.test(val),
  'Must be valid Docker image format (name:tag)'
);

// Session key validation
const SessionKeySchema = z.string().refine(
  (val) => /^[a-z0-9-]+:(slack|discord|rest):[A-Z0-9]+:[A-Z0-9]+$/.test(val),
  'Must be in format botId:channelType:channelId:userId'
);

// Memory size validation
const MemorySizeSchema = z.string().refine(
  (val) => /^\d+[kmg]$/i.test(val),
  'Must be in format like 1g, 512m, 256k'
);
```

---

## Transformation & Coercion

```javascript
// Automatically transform strings to numbers
const PortSchema = z.coerce.number().int().positive();

// Parse and validate JSON strings
const JsonbSchema = z.string().transform((str, ctx) => {
  try {
    return JSON.parse(str);
  } catch (e) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid JSON' });
    return z.NEVER;
  }
});

// Environment variable expansion
const EnvExpandSchema = z.string().transform((val) => {
  return val.replace(/\$\{([^}]+)\}/g, (_, key) => {
    return process.env[key] || '';
  });
});
```

---

## Testing

```javascript
// test/unit/config/ConfigValidator.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { ConfigValidator } from '../../../src/config/ConfigValidator.js';

test('validates correct bot config', () => {
  const validator = new ConfigValidator();

  const validConfig = {
    id: 'test-bot',
    soul: './soul.md',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    tools: ['bash']
  };

  // Should not throw
  const result = validator.validateBotConfig(validConfig);
  assert.ok(result);
});

test('rejects missing required fields', () => {
  const validator = new ConfigValidator();

  const invalidConfig = {
    id: 'test-bot',
    // Missing soul, provider, model
  };

  assert.throws(() => {
    validator.validateBotConfig(invalidConfig);
  }, /Bot configuration invalid/);
});

test('validates enum values', () => {
  const validator = new ConfigValidator();

  const invalidConfig = {
    id: 'test-bot',
    soul: './soul.md',
    provider: 'invalid-provider', // Not in enum
    model: 'claude-sonnet-4-5'
  };

  assert.throws(() => {
    validator.validateBotConfig(invalidConfig);
  });
});

test('applies defaults', () => {
  const validator = new ConfigValidator();

  const config = {
    id: 'test-bot',
    soul: './soul.md',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5'
  };

  const result = validator.validateBotConfig(config);

  // Default values applied
  assert.deepStrictEqual(result.tools, []);
  assert.strictEqual(result.compactionThreshold, 50000);
});
```

---

## Why NOT Joi or Yup

**Joi**:
- ❌ Heavier (more dependencies)
- ❌ TypeScript support requires extra types
- ❌ Slower than Zod

**Yup**:
- ❌ Frontend-focused (designed for forms)
- ❌ Less ideal for backend validation
- ❌ Async-first (overkill for sync validation)

**Zod Wins Because**:
- ✅ TypeScript-first with automatic inference
- ✅ Zero dependencies (smallest)
- ✅ Fastest performance
- ✅ Used by Vercel AI SDK (consistency)
- ✅ Excellent error messages
- ✅ Composable schemas

---

## Summary

| Need | Library | Why |
|------|---------|-----|
| Schema validation | Zod | TypeScript-first, zero deps, fastest, AI SDK compatible |
| Config validation | Zod | Same library, consistent API |
| Tool parameters | Zod | Required by Vercel AI SDK |

**Total Dependencies**: 1 (zod)
