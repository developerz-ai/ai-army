#!/usr/bin/env node

/**
 * AI Assistants Army CLI
 *
 * Command-line interface for managing the AI Army framework.
 * Uses commander for subcommand routing, option parsing, and help generation.
 *
 * Commands:
 *   init <project-name>  - Initialize a new AI Army project
 *   validate             - Validate configuration files
 *   migrate              - Run database migrations
 *   start                - Start in production mode
 *   dev                  - Start in development mode (hot reload)
 *   status               - Show system status
 *   reload               - Validate and reload config (nginx-style)
 *
 * @module bin/cli
 */

import { Command } from 'commander';
import path from 'path';
import { ProjectInitializer } from '../src/cli/ProjectInitializer.js';
import { runValidate } from '../src/cli/ValidateCommand.js';
import { runMigrate } from '../src/cli/MigrateCommand.js';
import { runStart } from '../src/cli/StartCommand.js';
import { runDev } from '../src/cli/DevCommand.js';
import { runReload } from '../src/cli/ReloadCommand.js';
import { runStatus } from '../src/cli/StatusCommand.js';
import { runInstance } from '../src/cli/InstanceCommand.js';

/**
 * Collect repeatable --override values into an array
 *
 * Used as a commander option parser callback so multiple
 * `--override key=value` flags accumulate into a single array.
 *
 * @param {string} value - New override "key=value" string
 * @param {Array<string>} previous - Accumulated overrides so far
 * @returns {Array<string>} Updated array of overrides
 * @private
 */
function collectOverrides(value, previous) {
  return [...previous, value];
}

/**
 * Create a PostgresStorage, run a callback, then disconnect
 *
 * Handles DATABASE_URL validation, connection lifecycle, and error reporting
 * so that each instance subcommand does not need to repeat this boilerplate.
 *
 * @param {Function} fn - Async function receiving the connected storage
 * @returns {Promise<void>}
 * @private
 */
async function withStorage(fn) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    process.stderr.write('DATABASE_URL environment variable is required\n');
    process.exitCode = 1;
    return;
  }

  const { PostgresStorage } = await import('../src/adapters/storage/postgres.js');
  const storage = new PostgresStorage(databaseUrl);

  try {
    await storage.connect();
    await fn(storage);
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exitCode = 1;
  } finally {
    await storage.disconnect();
  }
}

/**
 * Create and configure the CLI program
 * @returns {Command} Configured commander program
 */
export function createProgram() {
  const program = new Command();

  program.name('ai-army').description('AI Army - Multi-bot AI framework').version('0.1.0');

  // === init command ===
  program
    .command('init <project-name>')
    .description('Initialize a new AI Army project')
    .option('-t, --template <name>', 'Template to use', 'basic')
    .action(async (projectName, options) => {
      await runInit(projectName, options, process.stdout, process.stderr);
    });

  // === validate command ===
  program
    .command('validate')
    .description('Validate configuration files')
    .option('-c, --config <path>', 'Config file path', './config.json')
    .action(async options => {
      const result = await runValidate({
        configPath: options.config,
        output: process.stdout,
      });
      if (!result.valid) {
        process.exitCode = 1;
      }
    });

  // === migrate command ===
  program
    .command('migrate')
    .description('Run database migrations')
    .action(async () => {
      const { PostgresStorage } = await import('../src/adapters/storage/postgres.js');
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) {
        process.stderr.write('❌ DATABASE_URL environment variable is required\n');
        process.exitCode = 1;
        return;
      }
      const storage = new PostgresStorage(databaseUrl);
      try {
        await storage.connect();
        const result = await runMigrate({
          storage,
          output: process.stdout,
        });
        if (!result.success) {
          process.exitCode = 1;
        }
      } catch (err) {
        process.stderr.write(`❌ Migration error: ${err.message}\n`);
        process.exitCode = 1;
      } finally {
        await storage.disconnect();
      }
    });

  // === start command ===
  program
    .command('start')
    .description('Start AI Army in production mode')
    .option('-c, --config <path>', 'Config file path', './config.json')
    .action(async options => {
      await runStart({
        configPath: options.config,
        output: process.stdout,
      });
    });

  // === dev command ===
  program
    .command('dev')
    .description('Start AI Army in development mode (with hot reload)')
    .option('-c, --config <path>', 'Config file path', './config.json')
    .action(async options => {
      await runDev({
        configPath: options.config,
        output: process.stdout,
      });
    });

  // === status command ===
  program
    .command('status')
    .description('Show system status')
    .option('-c, --config <path>', 'Config file path', './config.json')
    .action(async () => {
      const { PostgresStorage } = await import('../src/adapters/storage/postgres.js');
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) {
        process.stderr.write('❌ DATABASE_URL environment variable is required\n');
        process.exitCode = 1;
        return;
      }
      const storage = new PostgresStorage(databaseUrl);
      try {
        await storage.connect();
        const result = await runStatus({
          storage,
          output: process.stdout,
        });
        if (!result.success) {
          process.exitCode = 1;
        }
      } catch (err) {
        process.stderr.write(`❌ Status error: ${err.message}\n`);
        process.exitCode = 1;
      } finally {
        await storage.disconnect();
      }
    });

  // === reload command ===
  program
    .command('reload')
    .description(
      'Validate and reload configuration (nginx-style). Runs validate-only when outside "ai-army dev"'
    )
    .option('-c, --config <path>', 'Config file path', './config.json')
    .action(async options => {
      const result = await runReload({
        configPath: options.config,
      });
      if (!result.success) {
        process.exitCode = 1;
      }
    });

  // === instance command ===
  const instanceCmd = program
    .command('instance')
    .description('Manage template instances (create, list, scale, stop, rm)');

  instanceCmd
    .command('create <templateId> <instanceId>')
    .description('Create a new instance from a template')
    .option('-n, --name <name>', 'Human-readable instance name')
    .option('-o, --override <key=value...>', 'Override values (repeatable)', collectOverrides, [])
    .action(async (templateId, instanceId, options) => {
      await withStorage(async storage => {
        const result = await runInstance('create', {
          templateId,
          instanceId,
          name: options.name,
          overrides: options.override,
          storage,
          output: process.stdout,
        });
        if (!result.success) {
          process.exitCode = 1;
        }
      });
    });

  instanceCmd
    .command('list')
    .description('List all instances')
    .option('-t, --template <templateId>', 'Filter by template ID')
    .option('-s, --status <status>', 'Filter by status')
    .action(async options => {
      await withStorage(async storage => {
        const result = await runInstance('list', {
          templateId: options.template,
          status: options.status,
          storage,
          output: process.stdout,
        });
        if (!result.success) {
          process.exitCode = 1;
        }
      });
    });

  instanceCmd
    .command('scale <templateId>')
    .description('Create multiple instances from a template')
    .requiredOption('--count <n>', 'Number of instances to create', parseInt)
    .option('-o, --override <key=value...>', 'Override values (repeatable)', collectOverrides, [])
    .action(async (templateId, options) => {
      await withStorage(async storage => {
        const result = await runInstance('scale', {
          templateId,
          count: options.count,
          overrides: options.override,
          storage,
          output: process.stdout,
        });
        if (!result.success) {
          process.exitCode = 1;
        }
      });
    });

  instanceCmd
    .command('stop <instanceId>')
    .description('Stop a running instance')
    .action(async instanceId => {
      await withStorage(async storage => {
        const result = await runInstance('stop', {
          instanceId,
          storage,
          output: process.stdout,
        });
        if (!result.success) {
          process.exitCode = 1;
        }
      });
    });

  instanceCmd
    .command('rm <instanceId>')
    .description('Remove (delete) an instance')
    .action(async instanceId => {
      await withStorage(async storage => {
        const result = await runInstance('rm', {
          instanceId,
          storage,
          output: process.stdout,
        });
        if (!result.success) {
          process.exitCode = 1;
        }
      });
    });

  return program;
}

/**
 * Run the init command
 *
 * Creates a new AI Army project at the specified path with the given template.
 * Resolves the project path relative to cwd and prints next-step instructions.
 *
 * @param {string} projectName - Name/path for the new project
 * @param {Object} options - Command options
 * @param {string} [options.template='basic'] - Template to use
 * @param {Object} stdout - Writable stream for output (default: process.stdout)
 * @param {Object} stderr - Writable stream for errors (default: process.stderr)
 * @returns {Promise<void>}
 */
export async function runInit(
  projectName,
  options,
  stdout = process.stdout,
  stderr = process.stderr
) {
  const { template } = options;
  const targetPath = path.resolve(process.cwd(), projectName);

  stdout.write(`🚀 Creating AI Army project: ${projectName}\n`);
  stdout.write(`   Template: ${template}\n`);
  stdout.write(`   Location: ${targetPath}\n\n`);

  try {
    await ProjectInitializer.initialize(targetPath, template);

    stdout.write(`✅ Project created: ${projectName}\n\n`);
    stdout.write(`Next steps:\n`);
    stdout.write(`  cd ${projectName}\n`);
    stdout.write(`  cp .env.example .env\n`);
    stdout.write(`  # Add your API keys to .env\n`);
    stdout.write(`  npm install\n`);
    stdout.write(`  npx ai-army validate\n`);
    stdout.write(`  docker-compose up -d\n`);
    stdout.write(`  npx ai-army migrate\n`);
    stdout.write(`  npx ai-army start\n`);
  } catch (err) {
    stderr.write(`❌ Failed to create project: ${err.message}\n`);
    process.exitCode = 1;
  }
}

// Run CLI when executed directly (not imported for testing)
const isMainModule =
  process.argv[1] &&
  (process.argv[1].endsWith('/bin/cli.js') || process.argv[1].endsWith('\\bin\\cli.js'));

if (isMainModule) {
  const program = createProgram();
  program.parseAsync(process.argv).catch(err => {
    console.error(`❌ CLI error: ${err.message}`);
    process.exit(1);
  });
}
