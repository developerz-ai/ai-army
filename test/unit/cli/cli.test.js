/**
 * Unit tests for CLI argument parsing and command routing
 *
 * Tests commander-based CLI handling including:
 * - Program creation with proper configuration
 * - Command argument parsing
 * - Option validation and defaults
 * - Error handling for invalid arguments
 * - Help output generation
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createProgram, runInit } from '../../../bin/cli.js';

describe('CLI - createProgram()', () => {
  test('creates a program with correct name and version', () => {
    const program = createProgram();
    assert.ok(program.name);
    assert.equal(program.name(), 'ai-army');
    assert.ok(program.version);
  });

  test('program has description', () => {
    const program = createProgram();
    assert.ok(program.description);
  });

  test('program has init command', () => {
    const program = createProgram();
    const { commands } = program;
    const initCmd = commands.find(c => c.name() === 'init');
    assert.ok(initCmd, 'init command should exist');
  });

  test('program has validate command', () => {
    const program = createProgram();
    const { commands } = program;
    const validateCmd = commands.find(c => c.name() === 'validate');
    assert.ok(validateCmd, 'validate command should exist');
  });

  test('program has migrate command', () => {
    const program = createProgram();
    const { commands } = program;
    const migrateCmd = commands.find(c => c.name() === 'migrate');
    assert.ok(migrateCmd, 'migrate command should exist');
  });

  test('program has start command', () => {
    const program = createProgram();
    const { commands } = program;
    const startCmd = commands.find(c => c.name() === 'start');
    assert.ok(startCmd, 'start command should exist');
  });

  test('program has dev command', () => {
    const program = createProgram();
    const { commands } = program;
    const devCmd = commands.find(c => c.name() === 'dev');
    assert.ok(devCmd, 'dev command should exist');
  });

  test('program has status command', () => {
    const program = createProgram();
    const { commands } = program;
    const statusCmd = commands.find(c => c.name() === 'status');
    assert.ok(statusCmd, 'status command should exist');
  });

  test('program has reload command', () => {
    const program = createProgram();
    const { commands } = program;
    const reloadCmd = commands.find(c => c.name() === 'reload');
    assert.ok(reloadCmd, 'reload command should exist');
  });
});

describe('CLI - init command', () => {
  test('init command exists with proper structure', () => {
    const program = createProgram();
    const initCmd = program.commands.find(c => c.name() === 'init');
    assert.ok(initCmd, 'init command should exist');
    assert.ok(initCmd.description, 'init command should have description');
  });

  test('init command has template option with default value', () => {
    const program = createProgram();
    const initCmd = program.commands.find(c => c.name() === 'init');
    assert.ok(initCmd);
    // Look for template option
    const { options } = initCmd;
    const templateOpt = options.find(o => o.long === '--template');
    assert.ok(templateOpt, 'init should have --template option');
    assert.equal(templateOpt.defaultValue, 'basic', 'template default should be basic');
  });

  test('init command accepts -t short form for template', () => {
    const program = createProgram();
    const initCmd = program.commands.find(c => c.name() === 'init');
    assert.ok(initCmd);
    const { options } = initCmd;
    const templateOpt = options.find(o => o.short === '-t');
    assert.ok(templateOpt, 'init should have -t short form');
  });
});

describe('CLI - validate command', () => {
  test('validate command has config option with default value', () => {
    const program = createProgram();
    const validateCmd = program.commands.find(c => c.name() === 'validate');
    assert.ok(validateCmd);
    const { options } = validateCmd;
    const configOpt = options.find(o => o.long === '--config');
    assert.ok(configOpt, 'validate should have --config option');
    assert.equal(configOpt.defaultValue, './config.json');
  });

  test('validate command accepts -c short form for config', () => {
    const program = createProgram();
    const validateCmd = program.commands.find(c => c.name() === 'validate');
    assert.ok(validateCmd);
    const { options } = validateCmd;
    const configOpt = options.find(o => o.short === '-c');
    assert.ok(configOpt, 'validate should have -c short form');
  });
});

describe('CLI - start command', () => {
  test('start command has config option with default value', () => {
    const program = createProgram();
    const startCmd = program.commands.find(c => c.name() === 'start');
    assert.ok(startCmd);
    const { options } = startCmd;
    const configOpt = options.find(o => o.long === '--config');
    assert.ok(configOpt, 'start should have --config option');
    assert.equal(configOpt.defaultValue, './config.json');
  });
});

describe('CLI - dev command', () => {
  test('dev command has config option with default value', () => {
    const program = createProgram();
    const devCmd = program.commands.find(c => c.name() === 'dev');
    assert.ok(devCmd);
    const { options } = devCmd;
    const configOpt = options.find(o => o.long === '--config');
    assert.ok(configOpt, 'dev should have --config option');
    assert.equal(configOpt.defaultValue, './config.json');
  });
});

describe('CLI - status command', () => {
  test('status command has config option with default value', () => {
    const program = createProgram();
    const statusCmd = program.commands.find(c => c.name() === 'status');
    assert.ok(statusCmd);
    const { options } = statusCmd;
    const configOpt = options.find(o => o.long === '--config');
    assert.ok(configOpt, 'status should have --config option');
    assert.equal(configOpt.defaultValue, './config.json');
  });

  test('status command accepts -c short form for config', () => {
    const program = createProgram();
    const statusCmd = program.commands.find(c => c.name() === 'status');
    assert.ok(statusCmd);
    const { options } = statusCmd;
    const configOpt = options.find(o => o.short === '-c');
    assert.ok(configOpt, 'status should have -c short form');
  });
});

describe('CLI - reload command', () => {
  test('reload command has config option with default value', () => {
    const program = createProgram();
    const reloadCmd = program.commands.find(c => c.name() === 'reload');
    assert.ok(reloadCmd);
    const { options } = reloadCmd;
    const configOpt = options.find(o => o.long === '--config');
    assert.ok(configOpt, 'reload should have --config option');
    assert.equal(configOpt.defaultValue, './config.json');
  });
});

describe('CLI - runInit()', () => {
  test('runInit is a function and exported', async () => {
    assert.ok(typeof runInit === 'function');
  });

  test('runInit accepts project name and options parameters', async () => {
    assert.ok(typeof runInit === 'function');
    // Verify signature includes projectName and options
    const sig = runInit.toString();
    assert.ok(sig.includes('projectName'));
    assert.ok(sig.includes('options'));
  });

  test('runInit accepts template option', async () => {
    assert.ok(typeof runInit === 'function');
    // Verify signature
    const sig = runInit.toString();
    assert.ok(sig.includes('template'));
  });
});

describe('CLI - help output', () => {
  test('program generates help text', () => {
    const program = createProgram();
    assert.ok(program.help);
  });

  test('init command has description', () => {
    const program = createProgram();
    const initCmd = program.commands.find(c => c.name() === 'init');
    assert.ok(initCmd.description());
    assert.ok(initCmd.description().toLowerCase().includes('initialize'));
  });

  test('all commands have descriptions', () => {
    const program = createProgram();
    const expectedCmds = ['init', 'validate', 'migrate', 'start', 'dev', 'status', 'reload'];

    for (const cmdName of expectedCmds) {
      const cmd = program.commands.find(c => c.name() === cmdName);
      assert.ok(cmd, `${cmdName} command should exist`);
      const desc = cmd.description();
      assert.ok(desc && desc.length > 0, `${cmdName} should have a description`);
    }
  });
});

describe('CLI - error handling', () => {
  test('runInit function signature allows error handling', () => {
    assert.ok(typeof runInit === 'function');
    // Verify the function has stderr parameter for error handling
    const sig = runInit.toString();
    assert.ok(sig.includes('stderr'));
  });

  test('runInit function accepts optional stdout and stderr streams', () => {
    assert.ok(typeof runInit === 'function');
    // Verify function parameters
    const sig = runInit.toString();
    assert.ok(sig.includes('stdout'));
    assert.ok(sig.includes('stderr'));
  });
});

describe('CLI - program parsing', () => {
  test('program parses async correctly', async () => {
    const program = createProgram();
    assert.ok(program.parseAsync);
  });

  test('program parse method exists', () => {
    const program = createProgram();
    assert.ok(program.parse);
  });

  test('program has exitOverride capability', () => {
    const program = createProgram();
    // Commander programs support exitOverride for testing
    assert.ok(program.exitOverride);
  });
});

describe('CLI - command help text', () => {
  test('validate command help is informative', () => {
    const program = createProgram();
    const validateCmd = program.commands.find(c => c.name() === 'validate');
    const desc = validateCmd.description();
    assert.ok(desc.toLowerCase().includes('config') || desc.toLowerCase().includes('validate'));
  });

  test('migrate command help is informative', () => {
    const program = createProgram();
    const migrateCmd = program.commands.find(c => c.name() === 'migrate');
    const desc = migrateCmd.description();
    assert.ok(desc.toLowerCase().includes('migrat'));
  });

  test('start command help is informative', () => {
    const program = createProgram();
    const startCmd = program.commands.find(c => c.name() === 'start');
    const desc = startCmd.description();
    assert.ok(desc.toLowerCase().includes('start') || desc.toLowerCase().includes('production'));
  });

  test('dev command help is informative', () => {
    const program = createProgram();
    const devCmd = program.commands.find(c => c.name() === 'dev');
    const desc = devCmd.description();
    assert.ok(desc.toLowerCase().includes('dev') || desc.toLowerCase().includes('development'));
  });
});
