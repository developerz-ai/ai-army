# Secrets Management - Bitwarden Integration

## Overview

Secrets (API keys, tokens, credentials) are **never stored in config files**. Instead:
- Reference secrets using `${VAR_NAME}` syntax
- Secrets are resolved at runtime from:
  1. Environment variables (local/simple)
  2. Bitwarden (production/team)
  3. Other secret managers (AWS Secrets Manager, HashiCorp Vault)

## Secret Reference Syntax

```json
{
  "apiKey": "${ANTHROPIC_API_KEY}",
  "token": "${SLACK_BOT_TOKEN}",
  "optional": "${OPTIONAL_VAR:-default_value}"
}
```

Patterns:
- `${VAR}` - Required, error if not set
- `${VAR:-default}` - Use default if not set
- `${VAR:+value}` - Use value only if VAR is set

## Environment Variables (Simple Setup)

For local development or single-server deployments:

### .env file

```bash
# .env (DO NOT COMMIT)
ANTHROPIC_API_KEY=sk-ant-...
OPENROUTER_API_KEY=sk-or-...
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
DISCORD_BOT_TOKEN=...
GITHUB_TOKEN=ghp_...
```

### Loading

```javascript
// src/config/env.ts
import { config } from 'dotenv';

export function loadEnv() {
  // Load .env file
  config();

  // Also load .env.local for overrides
  config({ path: '.env.local', override: true });
}
```

## Bitwarden Integration (Production)

For team environments, use Bitwarden Secrets Manager:

### Configuration

```json
{
  "secrets": {
    "provider": "bitwarden",
    "config": {
      "server": "${BW_SERVER:-https://vault.bitwarden.com}",
      "accessToken": "${BW_ACCESS_TOKEN}",
      "organizationId": "${BW_ORG_ID}",
      "projectId": "ai-army-prod"
    }
  }
}
```

### Bitwarden Secrets Manager Setup

1. Create a project in Bitwarden Secrets Manager
2. Add secrets with names matching your config references
3. Create a service account with access to the project
4. Use the access token in your deployment

### Implementation

```javascript
// src/secrets/bitwarden.ts
import { BitwardenClient, SecretIdentifierType } from '@bitwarden/sdk-napi';

export class BitwardenSecretsProvider {
  private client: BitwardenClient;
  private cache = new Map();
  private projectId: string;

  async initialize(config) {
    this.client = new BitwardenClient();
    this.projectId = config.projectId;

    await this.client.loginAccessToken(config.accessToken);

    // Pre-fetch all secrets for the project
    const secrets = await this.client.secrets().list(this.projectId);

    for (const secret of secrets.data) {
      const full = await this.client.secrets().get(secret.id);
      this.cache.set(secret.key, full.value);
    }
  }

  get(name) {
    if (!this.cache.has(name)) {
      throw new Error(`Secret not found: ${name}`);
    }
    return this.cache.get(name);
  }

  async refresh() {
    // Re-fetch secrets (call periodically or on SIGHUP)
    await this.initialize(this.config);
  }
}
```

## Secret Resolution

```javascript
// src/secrets/resolver.ts
export class SecretResolver {
  private providers: Map<string, SecretsProvider>;
  private primaryProvider: string;

  constructor(config) {
    this.providers = new Map();
    this.primaryProvider = config.secrets?.provider || 'env';

    // Always have env as fallback
    this.providers.set('env', new EnvSecretsProvider());

    // Initialize configured provider
    if (config.secrets?.provider === 'bitwarden') {
      const bw = new BitwardenSecretsProvider();
      bw.initialize(config.secrets.config);
      this.providers.set('bitwarden', bw);
    }
  }

  resolve(value) {
    if (typeof value !== 'string') return value;

    // Match ${VAR}, ${VAR:-default}, ${VAR:+value}
    return value.replace(/\$\{([^}]+)\}/g, (match, expr) => {
      // Parse expression
      const defaultMatch = expr.match(/^(.+?):-(.*)$/);
      const setMatch = expr.match(/^(.+?):\+(.*)$/);

      let varName, defaultValue, setValue;

      if (defaultMatch) {
        [, varName, defaultValue] = defaultMatch;
      } else if (setMatch) {
        [, varName, setValue] = setMatch;
      } else {
        varName = expr;
      }

      // Try primary provider first, then env
      let secretValue = null;

      try {
        secretValue = this.providers.get(this.primaryProvider)?.get(varName);
      } catch {
        secretValue = this.providers.get('env')?.get(varName);
      }

      // Handle modifiers
      if (secretValue === null || secretValue === undefined) {
        if (defaultValue !== undefined) {
          return defaultValue;
        }
        throw new Error(`Required secret not found: ${varName}`);
      }

      if (setValue !== undefined) {
        return setValue;
      }

      return secretValue;
    });
  }

  resolveObject(obj) {
    if (typeof obj === 'string') {
      return this.resolve(obj);
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.resolveObject(item));
    }

    if (typeof obj === 'object' && obj !== null) {
      const result = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.resolveObject(value);
      }
      return result;
    }

    return obj;
  }
}
```

## Per-Bot Secrets

Bots can have their own secrets that override global ones:

```
config/
├── config.json          # Global secrets references
└── bots/
    ├── work/
    │   ├── config.json
    │   └── .env         # Bot-specific secrets (local dev)
    └── devops/
        ├── config.json
        └── .env
```

In Bitwarden, organize secrets by bot:

```
Project: ai-army-prod
├── ANTHROPIC_API_KEY          # Shared
├── work/SLACK_BOT_TOKEN       # Bot-specific
├── work/GITHUB_TOKEN
├── devops/SLACK_BOT_TOKEN
├── devops/AWS_ACCESS_KEY
└── devops/AWS_SECRET_KEY
```

## AWS Secrets Manager (Alternative)

```javascript
// src/secrets/aws.ts
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

export class AwsSecretsProvider {
  private client: SecretsManagerClient;
  private prefix: string;
  private cache = new Map();

  constructor(config) {
    this.client = new SecretsManagerClient({
      region: config.region || 'us-east-1'
    });
    this.prefix = config.prefix || 'ai-army/';
  }

  async get(name) {
    if (this.cache.has(name)) {
      return this.cache.get(name);
    }

    const command = new GetSecretValueCommand({
      SecretId: `${this.prefix}${name}`
    });

    const response = await this.client.send(command);
    const value = response.SecretString;

    this.cache.set(name, value);
    return value;
  }
}
```

## HashiCorp Vault (Alternative)

```javascript
// src/secrets/vault.ts
import vault from 'node-vault';

export class VaultSecretsProvider {
  private client;
  private mountPath: string;

  constructor(config) {
    this.client = vault({
      endpoint: config.endpoint || 'http://127.0.0.1:8200',
      token: config.token
    });
    this.mountPath = config.mountPath || 'secret/data/ai-army';
  }

  async get(name) {
    const result = await this.client.read(`${this.mountPath}/${name}`);
    return result.data.data.value;
  }
}
```

## Security Best Practices

### 1. Never Log Secrets

```javascript
// src/utils/logging.ts
const REDACT_PATTERNS = [
  /sk-ant-[a-zA-Z0-9-]+/g,        // Anthropic
  /sk-or-[a-zA-Z0-9-]+/g,         // OpenRouter
  /xoxb-[a-zA-Z0-9-]+/g,          // Slack bot
  /xapp-[a-zA-Z0-9-]+/g,          // Slack app
  /ghp_[a-zA-Z0-9]+/g,            // GitHub
  /gho_[a-zA-Z0-9]+/g,            // GitHub OAuth
];

export function redactSecrets(text) {
  let result = text;
  for (const pattern of REDACT_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}
```

### 2. Rotate Secrets Regularly

```javascript
// Set up secret rotation notification
export function checkSecretAge(secrets) {
  const maxAge = 90 * 24 * 60 * 60 * 1000; // 90 days

  for (const [name, metadata] of secrets) {
    if (Date.now() - metadata.createdAt > maxAge) {
      console.warn(`Secret ${name} is older than 90 days, consider rotating`);
    }
  }
}
```

### 3. Minimal Scope

Give each bot only the secrets it needs:

```json
{
  "bots": {
    "work": {
      "secrets": ["ANTHROPIC_API_KEY", "SLACK_WORK_TOKEN", "GITHUB_TOKEN"]
    },
    "family": {
      "secrets": ["OPENROUTER_API_KEY", "DISCORD_TOKEN"]
    }
  }
}
```

### 4. Audit Access

```javascript
// src/secrets/audit.ts
export function auditSecretAccess(secretName, botId, action) {
  const entry = {
    timestamp: new Date().toISOString(),
    secret: secretName,
    bot: botId,
    action: action // 'read' | 'rotate' | 'delete'
  };

  // Log to audit trail
  fs.appendFileSync('logs/secret-audit.jsonl', JSON.stringify(entry) + '\n');
}
```
