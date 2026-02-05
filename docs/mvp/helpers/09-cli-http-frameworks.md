# CLI & HTTP Framework Libraries

**Problem Areas**:
- Command-line interface with subcommands
- HTTP server for admin API
- Request routing and middleware
- CLI argument parsing

---

## CLI Frameworks

### ✅ Recommended: commander
**Install**: `npm install commander`

**Why**:
- Lightweight and flexible (239M weekly downloads)
- Simple API for subcommands
- Automatic help generation
- Option parsing built-in
- No opinions, just works

**Basic Usage**:
```javascript
#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command();

program
  .name('ai-army')
  .description('AI Army - Multi-bot framework')
  .version('1.0.0');

program
  .command('init <project-name>')
  .description('Initialize new project')
  .option('-t, --template <name>', 'Template to use', 'basic')
  .action(async (projectName, options) => {
    console.log(`Creating ${projectName} with template ${options.template}`);
    await ProjectInitializer.initialize(projectName, options.template);
  });

program
  .command('validate')
  .description('Validate configuration')
  .action(async () => {
    const errors = await ConfigValidator.validateAll('./config.json');
    if (errors.length === 0) {
      console.log('✅ Configuration valid');
    } else {
      console.error('❌ Validation errors:');
      errors.forEach(e => console.error(`  - ${e}`));
      process.exit(1);
    }
  });

program
  .command('start')
  .description('Start AI Army')
  .option('-c, --config <path>', 'Config file path', './config.json')
  .action(async (options) => {
    const orchestrator = new Orchestrator({ configPath: options.config });
    await orchestrator.start();
  });

program.parse();
```

**Sources**:
- [commander vs yargs vs oclif - npm-compare](https://npm-compare.com/commander,oclif,vorpal,yargs)
- [Building CLI Applications Made Easy - Medium](https://ibrahim-haouari.medium.com/building-cli-applications-made-easy-with-these-nodejs-frameworks-2c06d1ff7a51)
- [In-Depth Comparison of CLI Frameworks - Oreate AI](https://www.oreateai.com/blog/indepth-comparison-of-cli-frameworks-technical-features-and-application-scenarios-of-yargs-commander-and-oclif/24440ae03bfbae6c4916c403a728f6da)

**Alternatives**:
- **yargs** (138M downloads) - More declarative, but more complex
- **oclif** (173K downloads) - Heavyweight framework (like Angular for CLIs), overkill for our needs

---

## CLI Implementation

```javascript
// bin/cli.js
#!/usr/bin/env node
import { Command } from 'commander';
import { ProjectInitializer } from '../src/cli/ProjectInitializer.js';
import { ConfigValidator } from '../src/config/ConfigValidator.js';
import { MigrationRunner } from '../src/database/MigrationRunner.js';
import { Orchestrator } from '../src/core/Orchestrator.js';
import { StatusCommand } from '../src/cli/StatusCommand.js';
import { ReloadCommand } from '../src/cli/ReloadCommand.js';

const program = new Command();

program
  .name('ai-army')
  .description('Multi-bot AI framework')
  .version('1.0.0');

// Init command
program
  .command('init <project-name>')
  .description('Initialize new AI Army project')
  .option('-t, --template <name>', 'Template to use', 'basic')
  .action(async (projectName, options) => {
    await ProjectInitializer.initialize(projectName, options.template);
    console.log(`✅ Project created: ${projectName}`);
    console.log('\nNext steps:');
    console.log(`  cd ${projectName}`);
    console.log('  cp .env.example .env');
    console.log('  # Add your API keys to .env');
    console.log('  npm start');
  });

// Validate command
program
  .command('validate')
  .description('Validate configuration files')
  .option('-c, --config <path>', 'Config file path', './config.json')
  .action(async (options) => {
    const errors = await ConfigValidator.validateAll(options.config);
    console.log(ConfigValidator.generateReport(errors));
    if (errors.length > 0) process.exit(1);
  });

// Migrate command
program
  .command('migrate')
  .description('Run database migrations')
  .action(async () => {
    const storage = new PostgresStorage(process.env.DATABASE_URL);
    await storage.connect();

    const runner = new MigrationRunner(storage);
    await runner.runMigrations('./migrations');

    await storage.disconnect();
    console.log('✅ Migrations complete');
  });

// Start command
program
  .command('start')
  .description('Start AI Army in production mode')
  .option('-c, --config <path>', 'Config file path', './config.json')
  .action(async (options) => {
    const orchestrator = new Orchestrator({ configPath: options.config });
    await orchestrator.start();
  });

// Dev command (with watch mode)
program
  .command('dev')
  .description('Start AI Army in development mode (with hot reload)')
  .option('-c, --config <path>', 'Config file path', './config.json')
  .action(async (options) => {
    const orchestrator = new Orchestrator({ configPath: options.config });
    await orchestrator.start();

    // Watch for config changes
    const watcher = new ConfigWatcher(orchestrator);
    await watcher.watch(['./config.json', './bots/**/*.{json,md}']);

    console.log('👁️  Watching for config changes...');
  });

// Status command
program
  .command('status')
  .description('Show system status')
  .action(async () => {
    const storage = new PostgresStorage(process.env.DATABASE_URL);
    await storage.connect();

    await StatusCommand.showStatus(storage);

    await storage.disconnect();
  });

// Reload command
program
  .command('reload')
  .description('Validate and reload configuration (nginx-style)')
  .option('-c, --config <path>', 'Config file path', './config.json')
  .action(async (options) => {
    await ReloadCommand.reload(options.config);
  });

program.parse();
```

---

## HTTP Frameworks

### ✅ Recommended: Fastify
**Install**: `npm install fastify`

**Why**:
- Fastest Node.js framework (2x faster than Express)
- Modern async/await support
- Schema validation built-in
- Plugin architecture
- Excellent TypeScript support
- Growing ecosystem

**Basic Usage**:
```javascript
import Fastify from 'fastify';

const fastify = Fastify({
  logger: true
});

// Routes
fastify.get('/api/admin/status', async (request, reply) => {
  const bots = await botManager.listBots();
  return {
    bots: bots.map(b => ({
      id: b.id,
      status: b.status,
      lastActive: b.lastActiveAt
    }))
  };
});

fastify.post('/api/admin/reload', async (request, reply) => {
  await orchestrator.reload();
  return { success: true, message: 'Configuration reloaded' };
});

// Start server
await fastify.listen({ port: 3000 });
```

**Sources**:
- [Fastify vs Express vs Hono - Medium](https://medium.com/@arifdewi/fastify-vs-express-vs-hono-choosing-the-right-node-js-framework-for-your-project-da629adebd4e)
- [Comparing Hono, Express, and Fastify - Red Sky Digital](https://redskydigital.com/us/comparing-hono-express-and-fastify-lightweight-frameworks-today/)
- [Fastify vs Hono - Better Stack](https://betterstack.com/community/guides/scaling-nodejs/hono-vs-fastify/)

**Alternatives**:
- **Express** - Most popular, but slower and older API
- **Hono** - Edge-first, great for Cloudflare Workers (not needed for our VPS deployment)

---

## Admin API Implementation

```javascript
// src/api/AdminRouter.js
import Fastify from 'fastify';

export class AdminRouter {
  constructor(orchestrator) {
    this.orchestrator = orchestrator;
    this.fastify = Fastify({ logger: true });
    this._setupRoutes();
  }

  _setupRoutes() {
    // Health check
    this.fastify.get('/health', async () => {
      return { status: 'ok', timestamp: new Date().toISOString() };
    });

    // Status endpoint
    this.fastify.get('/api/admin/status', async () => {
      const bots = this.orchestrator.botManager.listBots();
      const sessions = await this.orchestrator.storage.query(
        'SELECT COUNT(*) as count FROM sessions'
      );

      return {
        bots: bots.map(b => ({
          id: b.id,
          status: b.status,
          lastActive: b.lastActiveAt
        })),
        sessions: {
          total: parseInt(sessions.rows[0].count)
        }
      };
    });

    // Reload endpoint
    this.fastify.post('/api/admin/reload', async () => {
      try {
        await this.orchestrator.reload();
        return {
          success: true,
          message: 'Configuration reloaded'
        };
      } catch (err) {
        return {
          success: false,
          error: err.message
        };
      }
    });

    // Bot restart endpoint
    this.fastify.post('/api/admin/bots/:botId/restart', async (request) => {
      const { botId } = request.params;

      await this.orchestrator.botManager.stopBot(botId);
      await this.orchestrator.botManager.startBot(botId);

      return {
        success: true,
        botId,
        message: 'Bot restarted'
      };
    });
  }

  async start(port = 3000) {
    await this.fastify.listen({ port, host: '0.0.0.0' });
    console.log(`Admin API listening on http://localhost:${port}`);
  }

  async stop() {
    await this.fastify.close();
  }
}
```

---

## Authentication Middleware

```javascript
// Simple bearer token auth
this.fastify.addHook('onRequest', async (request, reply) => {
  // Skip auth for health check
  if (request.url === '/health') return;

  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'Unauthorized' });
    return;
  }

  const token = authHeader.substring(7);
  if (token !== process.env.ADMIN_API_KEY) {
    reply.code(401).send({ error: 'Invalid token' });
    return;
  }
});
```

---

## Graceful Shutdown

```javascript
// Handle signals for graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  await orchestrator.stop();
  await fastify.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully...');
  await orchestrator.stop();
  await fastify.close();
  process.exit(0);
});
```

---

## Package.json Configuration

```json
{
  "name": "ai-army",
  "version": "1.0.0",
  "type": "module",
  "bin": {
    "ai-army": "./bin/cli.js"
  },
  "scripts": {
    "start": "node src/index.js",
    "dev": "node bin/cli.js dev",
    "test": "node --test"
  }
}
```

---

## Testing CLI

```javascript
// test/integration/cli/commands.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

test('ai-army validate catches errors', async () => {
  const { stdout, stderr } = await execAsync('node bin/cli.js validate');

  assert.ok(stdout.includes('✅') || stdout.includes('❌'));
});

test('ai-army --help shows usage', async () => {
  const { stdout } = await execAsync('node bin/cli.js --help');

  assert.ok(stdout.includes('init'));
  assert.ok(stdout.includes('validate'));
  assert.ok(stdout.includes('start'));
});
```

---

## Why Fastify over Express?

**Fastify Advantages**:
- ✅ 2x faster (30K ops/sec vs 15K)
- ✅ Modern async/await (not callback-based)
- ✅ Schema validation built-in
- ✅ Better TypeScript support
- ✅ Plugin architecture

**Express Advantages**:
- Larger ecosystem
- More tutorials/examples
- Team familiarity

**For AI Army**: Fastify is better because:
- Performance matters for admin API
- Modern API (async/await)
- Validation built-in (consistent with Zod)
- Growing adoption

---

## Summary

| Need | Library | Why |
|------|---------|-----|
| CLI framework | commander | Simple, flexible, 239M downloads |
| HTTP server | fastify | Fastest, modern, schema validation |
| Auth | Custom middleware | Simple bearer token for admin API |

**Total Dependencies**: 2 (commander, fastify)
