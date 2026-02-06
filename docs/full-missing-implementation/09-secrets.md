# Missing: Secrets Integration

**Status:** 🟡 Partially Implemented
**Priority:** Low
**Design Doc:** [docs/idea/06-secrets.md](../idea/06-secrets.md)

## What Exists

✅ Secret adapters implemented:
- `EnvAdapter` (src/adapters/secrets/env.js)
- `BitwardenAdapter` (src/adapters/secrets/bitwarden.js)
- `OnePasswordAdapter` (src/adapters/secrets/onepassword.js)

## What's Missing

### 1. Secret Resolution in ConfigLoader

**Current behavior:**
ConfigLoader doesn't resolve `${VAR}` syntax automatically.

**Needed:**
```javascript
// src/config/ConfigLoader.js - Add secret resolution
class ConfigLoader {
  async load(path, secretsAdapter) {
    const config = await this._loadFile(path);
    return await this._resolveSecrets(config, secretsAdapter);
  }

  async _resolveSecrets(obj, adapter) {
    // Recursively find ${VAR} and resolve
    // e.g., "${SLACK_BOT_TOKEN}" → actual token value
  }
}
```

### 2. Secrets Manager

**Not implemented:**
```javascript
// src/secrets/secrets-manager.js - NOT IMPLEMENTED
class SecretsManager {
  constructor(adapters) {
    this.adapters = adapters; // Map of name → adapter
  }

  async resolve(ref) {
    // Parse ref: "bw:prod/slack-token"
    // Route to appropriate adapter
    // Return decrypted secret
  }

  async resolveAll(config) {
    // Find all ${...} references
    // Resolve each one
    // Return config with secrets injected
  }
}
```

### 3. Secret Reference Format

**Support multiple formats:**
```json
{
  "slack": {
    "botToken": "${SLACK_BOT_TOKEN}",           // Env var
    "appToken": "${bw:prod/slack-app-token}",   // Bitwarden
    "signingSecret": "${1p:prod/slack-secret}"   // 1Password
  }
}
```

**Reference patterns:**
- `${VAR}` - Environment variable
- `${bw:vault/item}` - Bitwarden
- `${1p:vault/item}` - 1Password
- `${vault:secret/path}` - HashiCorp Vault (future)

### 4. Secret Caching

**Not implemented:**
```javascript
class SecretCache {
  constructor(ttl = 300000) { // 5 min default
    this.cache = new Map();
    this.ttl = ttl;
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value) {
    this.cache.set(key, {
      value,
      timestamp: Date.now()
    });
  }
}
```

**Benefits:**
- Reduce API calls to secret managers
- Faster config loading
- Respect TTL for security

### 5. Configuration for Adapters

**Not validated/used:**
```json
{
  "secrets": {
    "default": "env",
    "adapters": {
      "bitwarden": {
        "type": "bitwarden",
        "sessionToken": "${BW_SESSION}"
      },
      "onepassword": {
        "type": "onepassword",
        "account": "company.1password.com",
        "token": "${OP_SESSION}"
      }
    }
  }
}
```

### 6. Secret Validation

**Missing:**
```javascript
class SecretValidator {
  validateReference(ref) {
    // Check format is valid
    // Check adapter exists
    // Optionally pre-fetch to verify access
  }

  async validateAll(config) {
    const refs = this.extractReferences(config);
    for (const ref of refs) {
      await this.validateReference(ref);
    }
  }
}
```

## Current State

**What Works:**
- Adapter classes exist
- Can manually call adapters
- Env vars work via process.env

**What Doesn't Work:**
- Automatic secret resolution in config
- `${VAR}` syntax parsing
- Bitwarden/1Password integration in config loading
- Secret caching
- Secret validation

## Implementation Path

### Step 1: Secret Resolution
1. Add `_resolveSecrets()` to ConfigLoader
2. Recursively walk config object
3. Find strings matching `${...}`
4. Parse reference format
5. Test with env vars first

### Step 2: Reference Parsing
1. Create `SecretReferenceParser` class
2. Parse `${adapter:path}` format
3. Handle plain `${VAR}` as env var
4. Validate reference syntax

### Step 3: Secrets Manager
1. Implement `SecretsManager` class
2. Register adapters (env, bw, 1p)
3. Route references to correct adapter
4. Test with multiple adapters

### Step 4: Integration
1. Create SecretsManager in Orchestrator
2. Pass to ConfigLoader
3. Resolve secrets during config load
4. Test with Bitwarden/1Password

### Step 5: Caching
1. Implement `SecretCache` class
2. Cache resolved secrets
3. Respect TTL
4. Add cache stats to status command

### Step 6: Validation
1. Implement pre-flight secret validation
2. Check all references exist
3. Report missing secrets clearly
4. Add to `ai-army validate` command

## Files to Create/Update

```
src/secrets/secrets-manager.js (new)
src/secrets/secret-cache.js (new)
src/secrets/reference-parser.js (new)
src/config/ConfigLoader.js (update)
test/unit/secrets-manager.test.js
test/integration/secrets-resolution.test.js
```

## Configuration Example

```json
{
  "secrets": {
    "default": "env",
    "cache": {
      "enabled": true,
      "ttl": 300000
    },
    "adapters": {
      "bitwarden": {
        "type": "bitwarden",
        "sessionToken": "${BW_SESSION}"
      }
    }
  },
  "providers": {
    "anthropic": {
      "apiKey": "${bw:prod/anthropic-key}"
    }
  },
  "channels": {
    "slack": {
      "type": "slack",
      "botToken": "${SLACK_BOT_TOKEN}",
      "appToken": "${bw:prod/slack-app-token}"
    }
  }
}
```

## CLI Commands

```bash
# Validate all secrets are accessible
ai-army secrets validate

# List all secret references in config
ai-army secrets list

# Test secret resolution
ai-army secrets test bw:prod/slack-token
```

## Dependencies

- ✅ Adapter classes (already exist)
- ConfigLoader (needs update)
- Regex for parsing references

## Security Considerations

1. **Never log secrets**: Redact in logs
2. **Memory safety**: Clear secrets after use
3. **Cache security**: Encrypt cached secrets
4. **Validation**: Pre-flight checks before start

## Complexity: Low
- Simple regex parsing
- Adapter routing logic
- Straightforward caching
- Well-scoped feature
