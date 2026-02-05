# Utilities & Miscellaneous Libraries

**Problem Areas**:
- File watching for hot reload
- HTTP client for downloads/API calls
- Date/time handling
- String manipulation
- Async utilities

---

## File Watching

### ✅ Recommended: chokidar
**Install**: `npm install chokidar`

**Why**:
- Most popular file watcher (30M+ repositories use it)
- Cross-platform (Windows, Mac, Linux)
- Efficient (uses native fs.watch when possible)
- Glob pattern support
- Battle-tested (used by Vite, Webpack, Parcel)

**Basic Usage**:
```javascript
import chokidar from 'chokidar';

const watcher = chokidar.watch(['./config.json', './bots/**/*.{json,md}'], {
  persistent: true,
  ignoreInitial: true,
  awaitWriteFinish: {
    stabilityThreshold: 300,  // Wait 300ms before firing event
    pollInterval: 100
  }
});

watcher.on('change', async (path) => {
  console.log(`File changed: ${path}`);
  await handleConfigChange(path);
});

watcher.on('error', error => console.error('Watcher error:', error));

// Stop watching
watcher.close();
```

**Sources**:
- [GitHub - paulmillr/chokidar](https://github.com/paulmillr/chokidar)
- [chokidar vs nodemon vs node-watch - npm-compare](https://npm-compare.com/chokidar,gaze,node-watch,nodemon,watch)
- [How to Watch File Changes in Node.js - OneUptime](https://oneuptime.com/blog/post/2026-01-22-nodejs-watch-file-changes/view)

**Alternatives**:
- **Node.js fs.watch** - Native but inconsistent cross-platform behavior
- **node-watch** - Lightweight but less features
- **nodemon** - For restarting apps, not file watching

---

## Config Watcher Implementation

```javascript
// src/config/ConfigWatcher.js
import chokidar from 'chokidar';

export class ConfigWatcher {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    this.watcher = null;
  }

  async watch(paths) {
    this.watcher = chokidar.watch(paths, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100
      }
    });

    this.watcher.on('change', async (path) => {
      console.log(`📝 Config changed: ${path}`);
      const result = await this.validateAndReload(path);

      if (result.success) {
        console.log('✅ Config reloaded');
      } else {
        console.error('❌ Invalid config, keeping old:');
        result.errors.forEach(e => console.error(`  ${e}`));
      }
    });

    this.watcher.on('error', error => {
      console.error('Config watcher error:', error);
    });

    console.log('👁️  Watching for config changes...');
  }

  async validateAndReload(changedPath) {
    try {
      // Validate
      const newConfig = await ConfigLoader.load('./config.json');
      const errors = await ConfigValidator.validateAll(newConfig);

      if (errors.length > 0) {
        return { success: false, errors };
      }

      // Reload
      await this.orchestrator.reload(newConfig);

      return { success: true };
    } catch (err) {
      return { success: false, errors: [err.message] };
    }
  }

  stop() {
    if (this.watcher) {
      this.watcher.close();
    }
  }
}
```

---

## HTTP Client

### ✅ Recommended: Native fetch (Node.js 18+)
**Install**: None! Built into Node.js

**Why**:
- No dependencies
- Standard Web API
- Modern async/await
- Streaming support

**Basic Usage**:
```javascript
// GET request
const response = await fetch('https://api.example.com/data');
const data = await response.json();

// POST request
const response = await fetch('https://api.example.com/data', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({ key: 'value' })
});

// Download file
const response = await fetch('https://example.com/file.pdf');
const buffer = await response.arrayBuffer();
await fs.writeFile('./file.pdf', Buffer.from(buffer));

// Streaming
const response = await fetch('https://example.com/large-file');
const stream = fs.createWriteStream('./large-file');
await response.body.pipeTo(stream);
```

**Alternatives**:
- **axios** - More features, but adds dependency
- **node-fetch** - Polyfill (not needed on Node.js 18+)
- **got** - Advanced features, but heavier

---

## Download Helper

```javascript
// src/utils/Downloader.js
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';

export class Downloader {
  async downloadFile(url, destination) {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Download failed: ${response.statusText}`);
    }

    // Stream to file (memory efficient)
    const fileStream = createWriteStream(destination);
    await pipeline(response.body, fileStream);
  }

  async downloadJson(url, headers = {}) {
    const response = await fetch(url, { headers });

    if (!response.ok) {
      throw new Error(`Request failed: ${response.statusText}`);
    }

    return await response.json();
  }

  async downloadText(url) {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Request failed: ${response.statusText}`);
    }

    return await response.text();
  }
}
```

---

## Date/Time Utilities

### ✅ Recommended: Native Date (or day.js if needed)
**Install**: None for native, `npm install dayjs` if needed

**Why Use Native**:
- No dependencies
- Good enough for most use cases
- ISO format works well with PostgreSQL

**Basic Usage**:
```javascript
// Current timestamp
const now = new Date();

// ISO format (PostgreSQL compatible)
const isoString = now.toISOString();  // "2026-02-05T10:30:00.000Z"

// Unix timestamp
const timestamp = Date.now();

// Parse ISO string
const parsed = new Date('2026-02-05T10:30:00.000Z');

// Add time
const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

// Compare dates
const isAfter = date1 > date2;
```

**If you need more** (formatting, parsing, timezone):
```javascript
import dayjs from 'dayjs';

const date = dayjs('2026-02-05');
const formatted = date.format('YYYY-MM-DD HH:mm:ss');
const relative = date.from(dayjs());  // "2 days ago"
```

---

## Async Utilities

### Native Promise Methods (Node.js 20+)

```javascript
// Run in parallel, wait for all
const results = await Promise.all([
  fetchUser(),
  fetchPosts(),
  fetchComments()
]);

// Run in parallel, return first success
const fastest = await Promise.race([
  fetchFromCache(),
  fetchFromDB(),
  fetchFromAPI()
]);

// Run in parallel, wait for all (even if some fail)
const results = await Promise.allSettled([
  riskyOperation1(),
  riskyOperation2(),
  riskyOperation3()
]);

// results = [
//   { status: 'fulfilled', value: ... },
//   { status: 'rejected', reason: ... },
//   { status: 'fulfilled', value: ... }
// ]
```

---

## Retry Logic

```javascript
// src/utils/Retry.js
export async function retry(fn, options = {}) {
  const {
    maxAttempts = 3,
    delayMs = 1000,
    backoff = 2,
    onRetry
  } = options;

  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt < maxAttempts) {
        const delay = delayMs * Math.pow(backoff, attempt - 1);

        if (onRetry) {
          onRetry(err, attempt, delay);
        }

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

// Usage
const data = await retry(
  () => fetch('https://api.example.com/data').then(r => r.json()),
  {
    maxAttempts: 3,
    delayMs: 1000,
    backoff: 2,
    onRetry: (err, attempt, delay) => {
      console.log(`Retry ${attempt} after ${delay}ms: ${err.message}`);
    }
  }
);
```

---

## Timeout Wrapper

```javascript
// src/utils/Timeout.js
export async function withTimeout(promise, timeoutMs, errorMessage) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(errorMessage || 'Timeout')), timeoutMs)
    )
  ]);
}

// Usage
const result = await withTimeout(
  slowOperation(),
  5000,
  'Operation timed out after 5s'
);
```

---

## String Utilities

```javascript
// src/utils/StringUtils.js
export class StringUtils {
  // Truncate with ellipsis
  static truncate(str, maxLength) {
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength - 3) + '...';
  }

  // Slugify
  static slugify(str) {
    return str
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  // Escape shell arguments
  static escapeShell(str) {
    return str.replace(/'/g, "'\\''");
  }

  // Parse memory size
  static parseMemory(str) {
    const match = str.match(/^(\d+)([kmg])$/i);
    if (!match) throw new Error(`Invalid memory format: ${str}`);

    const [, num, unit] = match;
    const multipliers = { k: 1024, m: 1024 ** 2, g: 1024 ** 3 };
    return parseInt(num) * multipliers[unit.toLowerCase()];
  }
}
```

---

## Debounce (for hot reload)

```javascript
// src/utils/Debounce.js
export function debounce(fn, delayMs) {
  let timeoutId;

  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delayMs);
  };
}

// Usage in watcher
const debouncedReload = debounce(async (path) => {
  await orchestrator.reload();
}, 300);

watcher.on('change', debouncedReload);
```

---

## Environment Detection

```javascript
// src/utils/Environment.js
export const Environment = {
  isProduction: process.env.NODE_ENV === 'production',
  isDevelopment: process.env.NODE_ENV === 'development',
  isTest: process.env.NODE_ENV === 'test',

  get nodeVersion() {
    return process.version;
  },

  get platform() {
    return process.platform;
  },

  requireEnv(name) {
    const value = process.env[name];
    if (!value) {
      throw new Error(`Required environment variable ${name} is not set`);
    }
    return value;
  }
};
```

---

## Summary

| Need | Solution | Dependencies |
|------|----------|--------------|
| File watching | chokidar | 1 (chokidar) |
| HTTP client | Native fetch | 0 (built-in) |
| Downloads | Native fetch + streams | 0 (built-in) |
| Date/time | Native Date | 0 (built-in) |
| Async utils | Native Promise methods | 0 (built-in) |
| Retry/timeout | Custom utilities | 0 (custom code) |
| String utils | Custom utilities | 0 (custom code) |

**Total Dependencies**: 1 (chokidar only)

**Philosophy**: Use native Node.js features first, only add libraries when truly needed. Modern Node.js (v20+) has excellent built-in capabilities.
