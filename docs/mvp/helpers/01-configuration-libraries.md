# Configuration & Environment Variable Libraries

**Problem Areas**:
- Loading configuration from JSON files
- Environment variable parsing and interpolation (`${VAR}`, `${VAR:-default}`)
- Deep merging nested configuration objects
- Configuration validation

---

## Environment Variables

### ✅ Recommended: dotenv + dotenv-expand
**Install**: `npm install dotenv dotenv-expand`

**Why**: Industry standard, zero dependencies, simple API

**Usage**:
```javascript
import 'dotenv/config';
import dotenvExpand from 'dotenv-expand';

const myEnv = dotenv.config();
dotenvExpand.expand(myEnv);

// Now process.env has all vars with expansion support
console.log(process.env.DATABASE_URL);
```

**Alternatives**:
- **dotenvx** ([dotenvx.com](https://dotenvx.com/docs/env-file)) - Modern alternative with built-in encryption, variable expansion, and multi-language support
- **string-env-interpolation** ([npm](https://www.npmjs.com/package/string-env-interpolation)) - Specialized for config file interpolation

**Sources**:
- [GitHub - motdotla/dotenv](https://github.com/motdotla/dotenv)
- [.env | dotenvx](https://dotenvx.com/docs/env-file)
- [Using Environment Variables in Node.js - Doppler](https://www.doppler.com/blog/environment-variables-node-js)

---

## Deep Object Merging

### ✅ Recommended: deepmerge
**Install**: `npm install deepmerge`

**Why**: Purpose-built for deep merging, immutable by default, handles arrays intelligently

**Usage**:
```javascript
import deepmerge from 'deepmerge';

const defaults = {
  model: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
  tools: ['bash']
};

const botConfig = {
  model: { model: 'claude-haiku-4-5' },
  tools: ['readFile']
};

const merged = deepmerge(defaults, botConfig, {
  arrayMerge: (target, source) => source // Replace arrays instead of concat
});

// Result: { model: { provider: 'anthropic', model: 'claude-haiku-4-5' }, tools: ['readFile'] }
```

**Custom Array Merge**:
```javascript
const options = {
  arrayMerge: (destinationArray, sourceArray, options) => {
    // Replace arrays entirely
    return sourceArray;

    // Or concat unique only
    // return [...new Set([...destinationArray, ...sourceArray])];
  }
};
```

**Alternatives**:
- **lodash.merge** - More general purpose, but mutates objects and treats arrays as objects (not ideal for config merging)

**Sources**:
- [deepmerge vs lodash.merge - npm-compare](https://npm-compare.com/deepmerge,lodash.merge)
- [Deep Merge Objects in JavaScript - egghead.io](https://egghead.io/lessons/javascript-deep-merge-objects-in-javascript-with-spread-lodash-and-deepmerge)

---

## Custom Interpolation for Config Files

If you need more advanced interpolation directly in JSON/config files:

### Option: interpolate-json
**Install**: `npm install interpolate-json`

**Features**:
- Variable interpolation in JSON objects
- Function evaluation within interpolations
- Custom value injection

**Usage**:
```javascript
import interpolate from 'interpolate-json';

const config = {
  database: "${DATABASE_URL}",
  port: "${PORT:-3000}",
  apiKey: "${ANTHROPIC_API_KEY}"
};

const interpolated = interpolate(config, {
  context: process.env
});
```

**Sources**:
- [interpolate-json - npm](https://www.npmjs.com/package/interpolate-json)

---

## Implementation Strategy for AI Army

**Phase 1 - ConfigLoader.js**:
```javascript
import fs from 'fs/promises';
import deepmerge from 'deepmerge';

export class ConfigLoader {
  async load(configPath) {
    const raw = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(raw);
    return this.interpolateEnvVars(config);
  }

  interpolateEnvVars(obj) {
    if (typeof obj === 'string') {
      // Match ${VAR}, ${VAR:-default}, ${VAR:+value}
      return obj.replace(/\$\{([^}:]+)(:[-+])?([^}]*)\}/g, (match, key, op, value) => {
        const envValue = process.env[key];

        if (op === ':-') {
          // ${VAR:-default} - use default if not set
          return envValue || value;
        } else if (op === ':+') {
          // ${VAR:+value} - use value only if VAR is set
          return envValue ? value : '';
        } else {
          // ${VAR} - required, error if not set
          if (!envValue) {
            throw new Error(`Required environment variable ${key} is not set`);
          }
          return envValue;
        }
      });
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.interpolateEnvVars(item));
    }

    if (obj && typeof obj === 'object') {
      return Object.fromEntries(
        Object.entries(obj).map(([k, v]) => [k, this.interpolateEnvVars(v)])
      );
    }

    return obj;
  }

  deepMerge(defaults, overrides) {
    return deepmerge(defaults, overrides, {
      arrayMerge: (target, source) => source // Replace arrays
    });
  }
}
```

---

## Testing Recommendations

```javascript
// test/unit/config/ConfigLoader.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { ConfigLoader } from '../../../src/config/ConfigLoader.js';

test('interpolates required env vars', async () => {
  process.env.TEST_API_KEY = 'sk-test-123';
  const loader = new ConfigLoader();

  const result = loader.interpolateEnvVars({
    apiKey: '${TEST_API_KEY}'
  });

  assert.strictEqual(result.apiKey, 'sk-test-123');
});

test('uses default value when var not set', () => {
  delete process.env.TEST_PORT;
  const loader = new ConfigLoader();

  const result = loader.interpolateEnvVars({
    port: '${TEST_PORT:-3000}'
  });

  assert.strictEqual(result.port, '3000');
});

test('deep merges nested objects', () => {
  const loader = new ConfigLoader();

  const defaults = { db: { host: 'localhost', port: 5432 } };
  const overrides = { db: { port: 5433 } };

  const result = loader.deepMerge(defaults, overrides);

  assert.deepStrictEqual(result, {
    db: { host: 'localhost', port: 5433 }
  });
});
```

---

## Summary

| Need | Library | Why |
|------|---------|-----|
| .env loading | dotenv + dotenv-expand | Standard, simple, works everywhere |
| Deep merging | deepmerge | Immutable, smart array handling |
| Config interpolation | Custom implementation | Full control over syntax |

**Total Dependencies**: 2 (dotenv, deepmerge)
