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

  // === validate command (stub for Phase 7b) ===
  program
    .command('validate')
    .description('Validate configuration files')
    .option('-c, --config <path>', 'Config file path', './config.json')
    .action(async _options => {
      console.log('✅ Validating configuration...');
      console.log('⚠️  validate command not yet implemented');
    });

  // === migrate command (stub for Phase 7b) ===
  program
    .command('migrate')
    .description('Run database migrations')
    .action(async () => {
      console.log('🔄 Running migrations...');
      console.log('⚠️  migrate command not yet implemented');
    });

  // === start command (stub for Phase 7b) ===
  program
    .command('start')
    .description('Start AI Army in production mode')
    .option('-c, --config <path>', 'Config file path', './config.json')
    .action(async _options => {
      console.log('🚀 Starting in production mode...');
      console.log('⚠️  start command not yet implemented');
    });

  // === dev command (stub for Phase 7b) ===
  program
    .command('dev')
    .description('Start AI Army in development mode (with hot reload)')
    .option('-c, --config <path>', 'Config file path', './config.json')
    .action(async _options => {
      console.log('🛠️  Starting in development mode...');
      console.log('⚠️  dev command not yet implemented');
    });

  // === status command (stub for Phase 7b) ===
  program
    .command('status')
    .description('Show system status')
    .action(async () => {
      console.log('📊 Checking status...');
      console.log('⚠️  status command not yet implemented');
    });

  // === reload command (stub for Phase 7b) ===
  program
    .command('reload')
    .description('Validate and reload configuration (nginx-style)')
    .option('-c, --config <path>', 'Config file path', './config.json')
    .action(async _options => {
      console.log('🔄 Reloading configuration...');
      console.log('⚠️  reload command not yet implemented');
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
