/**
 * Tests for demo/scripts/test.sh
 *
 * Validates the test script's structure, phases, CLI options,
 * and consistency with the demo project's bot definitions.
 *
 * @module demo/scripts/test.test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access, constants } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = __dirname;
const DEMO_DIR = join(__dirname, '..');

/**
 * Read the test script content
 * @returns {Promise<string>} File content
 */
async function readTestScript() {
  return readFile(join(SCRIPTS_DIR, 'test.sh'), 'utf-8');
}

describe('test.sh basics', () => {
  test('exists and is readable', async () => {
    await access(join(SCRIPTS_DIR, 'test.sh'), constants.R_OK);
  });

  test('is executable', async () => {
    await access(join(SCRIPTS_DIR, 'test.sh'), constants.X_OK);
  });

  test('has valid bash syntax', () => {
    const result = execSync(`bash -n "${join(SCRIPTS_DIR, 'test.sh')}" 2>&1`, {
      encoding: 'utf-8',
    });
    assert.equal(result.trim(), '');
  });

  test('uses bash shebang', async () => {
    const content = await readTestScript();
    assert.ok(content.startsWith('#!/usr/bin/env bash'), 'Should use #!/usr/bin/env bash shebang');
  });

  test('uses strict mode (set -euo pipefail)', async () => {
    const content = await readTestScript();
    assert.ok(content.includes('set -euo pipefail'), 'Should enable strict error handling');
  });

  test('resolves DEMO_DIR correctly', async () => {
    const content = await readTestScript();
    assert.ok(content.includes('DEMO_DIR='), 'Should define DEMO_DIR');
  });
});

describe('test.sh CLI options', () => {
  let content;

  test('supports --validate-only flag', async () => {
    content = content || (await readTestScript());
    assert.ok(content.includes('--validate-only'), 'Should support --validate-only flag');
    assert.ok(content.includes('VALIDATE_ONLY'), 'Should have VALIDATE_ONLY variable');
  });

  test('supports --bot flag for single bot testing', async () => {
    content = content || (await readTestScript());
    assert.ok(content.includes('--bot'), 'Should support --bot flag');
    assert.ok(content.includes('SINGLE_BOT'), 'Should have SINGLE_BOT variable');
  });

  test('supports --port flag for custom API port', async () => {
    content = content || (await readTestScript());
    assert.ok(content.includes('--port'), 'Should support --port flag');
    assert.ok(content.includes('API_PORT'), 'Should have API_PORT variable');
  });

  test('supports --timeout flag', async () => {
    content = content || (await readTestScript());
    assert.ok(content.includes('--timeout'), 'Should support --timeout flag');
    assert.ok(content.includes('TIMEOUT'), 'Should have TIMEOUT variable');
  });

  test('supports --verbose flag', async () => {
    content = content || (await readTestScript());
    assert.ok(content.includes('--verbose'), 'Should support --verbose flag');
    assert.ok(content.includes('VERBOSE'), 'Should have VERBOSE variable');
  });

  test('supports --help flag', async () => {
    content = content || (await readTestScript());
    assert.ok(content.includes('--help'), 'Should support --help flag');
  });

  test('defaults to port 3000', async () => {
    content = content || (await readTestScript());
    assert.ok(content.includes('3000'), 'Should default to port 3000');
  });

  test('allows DEMO_API_PORT environment override', async () => {
    content = content || (await readTestScript());
    assert.ok(content.includes('DEMO_API_PORT'), 'Should allow DEMO_API_PORT env var override');
  });
});

describe('test.sh test phases', () => {
  let content;

  test('has Phase 1: Structure Validation', async () => {
    content = content || (await readTestScript());
    assert.ok(content.includes('Phase 1'), 'Should have Phase 1');
    assert.ok(content.includes('Structure Validation'), 'Phase 1 should be Structure Validation');
  });

  test('has Phase 2: Config Validation', async () => {
    content = content || (await readTestScript());
    assert.ok(content.includes('Phase 2'), 'Should have Phase 2');
    assert.ok(content.includes('Config Validation'), 'Phase 2 should be Config Validation');
  });

  test('has Phase 3: Bot Config Content', async () => {
    content = content || (await readTestScript());
    assert.ok(content.includes('Phase 3'), 'Should have Phase 3');
    assert.ok(
      content.includes('Bot Config Content'),
      'Phase 3 should be Bot Config Content checks'
    );
  });

  test('has Phase 4: Server Connectivity', async () => {
    content = content || (await readTestScript());
    assert.ok(content.includes('Phase 4'), 'Should have Phase 4');
    assert.ok(content.includes('Server Connectivity'), 'Phase 4 should be Server Connectivity');
  });

  test('has Phase 5: Send Test Messages', async () => {
    content = content || (await readTestScript());
    assert.ok(content.includes('Phase 5'), 'Should have Phase 5');
    assert.ok(content.includes('Send Test Messages'), 'Phase 5 should be Send Test Messages');
  });

  test('has Phase 6: API Endpoints', async () => {
    content = content || (await readTestScript());
    assert.ok(content.includes('Phase 6'), 'Should have Phase 6');
    assert.ok(content.includes('API Endpoints'), 'Phase 6 should be API Endpoints');
  });
});

describe('test.sh bot coverage', () => {
  let content;

  test('tests echo-bot', async () => {
    content = content || (await readTestScript());
    assert.ok(content.includes('echo-bot'), 'Should test echo-bot');
  });

  test('tests calculator-bot', async () => {
    content = content || (await readTestScript());
    assert.ok(content.includes('calculator-bot'), 'Should test calculator-bot');
  });

  test('tests file-assistant', async () => {
    content = content || (await readTestScript());
    assert.ok(content.includes('file-assistant'), 'Should test file-assistant');
  });

  test('defines ALL_BOTS array with all 3 bots', async () => {
    content = content || (await readTestScript());
    assert.ok(content.includes('ALL_BOTS='), 'Should define ALL_BOTS array');
    // Verify all 3 are in the array
    const match = content.match(/ALL_BOTS=\(([^)]+)\)/);
    assert.ok(match, 'ALL_BOTS should be a bash array');
    const botsLine = match[1];
    assert.ok(botsLine.includes('echo-bot'), 'ALL_BOTS should include echo-bot');
    assert.ok(botsLine.includes('calculator-bot'), 'ALL_BOTS should include calculator-bot');
    assert.ok(botsLine.includes('file-assistant'), 'ALL_BOTS should include file-assistant');
  });

  test('ALL_BOTS matches actual demo bot directories', async () => {
    const { readdir } = await import('node:fs/promises');
    const botDirs = await readdir(join(DEMO_DIR, 'bots'));
    const actualBots = botDirs.sort();

    content = content || (await readTestScript());
    const match = content.match(/ALL_BOTS=\(([^)]+)\)/);
    assert.ok(match, 'Should define ALL_BOTS');

    const scriptBots = match[1].replace(/"/g, '').split(/\s+/).filter(Boolean).sort();

    assert.deepEqual(
      scriptBots,
      actualBots,
      'ALL_BOTS in test.sh should match demo/bots/ directories'
    );
  });
});

describe('test.sh test messages', () => {
  let content;

  test('defines test messages for each bot', async () => {
    content = content || (await readTestScript());
    assert.ok(content.includes('TEST_MESSAGES'), 'Should define TEST_MESSAGES');
    assert.ok(content.includes('TEST_MESSAGES[echo-bot]'), 'Should have message for echo-bot');
    assert.ok(
      content.includes('TEST_MESSAGES[calculator-bot]'),
      'Should have message for calculator-bot'
    );
    assert.ok(
      content.includes('TEST_MESSAGES[file-assistant]'),
      'Should have message for file-assistant'
    );
  });

  test('echo-bot test message is simple greeting', async () => {
    content = content || (await readTestScript());
    const match = content.match(/TEST_MESSAGES\[echo-bot\]='([^']+)'/);
    assert.ok(match, 'Should define echo-bot test message');
    assert.ok(match[1].length > 0, 'Echo-bot message should not be empty');
  });

  test('calculator-bot test message involves math', async () => {
    content = content || (await readTestScript());
    const match = content.match(/TEST_MESSAGES\[calculator-bot\]='([^']+)'/);
    assert.ok(match, 'Should define calculator-bot test message');
    // Should contain a number or math-related word
    assert.ok(
      /\d/.test(match[1]) || /math|calcul|times|plus|minus|divide/i.test(match[1]),
      'Calculator-bot message should involve math'
    );
  });

  test('file-assistant test message involves file operations', async () => {
    content = content || (await readTestScript());
    const match = content.match(/TEST_MESSAGES\[file-assistant\]='([^']+)'/);
    assert.ok(match, 'Should define file-assistant test message');
    assert.ok(
      /file|create|write|read/i.test(match[1]),
      'File-assistant message should involve file operations'
    );
  });
});

describe('test.sh REST API integration', () => {
  let content;

  test('uses curl to send messages', async () => {
    content = content || (await readTestScript());
    assert.ok(content.includes('curl'), 'Should use curl for HTTP requests');
  });

  test('sends POST to /api/bots/{botId}/message', async () => {
    content = content || (await readTestScript());
    assert.ok(content.includes('/api/bots/'), 'Should target /api/bots/ endpoint');
    assert.ok(content.includes('/message'), 'Should target /message endpoint');
    assert.ok(content.includes('-X POST'), 'Should use POST method');
  });

  test('sends Content-Type: application/json header', async () => {
    content = content || (await readTestScript());
    assert.ok(content.includes('Content-Type: application/json'), 'Should send JSON content type');
  });

  test('sends message in JSON body', async () => {
    content = content || (await readTestScript());
    assert.ok(
      content.includes('\\"message\\"') || content.includes('"message"'),
      'Should send message field in JSON body'
    );
  });

  test('includes sessionId in request', async () => {
    content = content || (await readTestScript());
    assert.ok(content.includes('sessionId'), 'Should include sessionId in request');
  });

  test('checks GET /api/bots endpoint', async () => {
    content = content || (await readTestScript());
    assert.ok(content.includes('/api/bots'), 'Should check /api/bots list endpoint');
  });

  test('handles HTTP response codes', async () => {
    content = content || (await readTestScript());
    assert.ok(content.includes('http_code'), 'Should extract HTTP status code');
    assert.ok(content.includes('200'), 'Should check for success status codes');
  });

  test('uses configurable timeout', async () => {
    content = content || (await readTestScript());
    assert.ok(content.includes('max-time'), 'Should use curl --max-time for timeout');
    assert.ok(content.includes('TIMEOUT'), 'Should use TIMEOUT variable');
  });
});

describe('test.sh server check', () => {
  let content;

  test('checks server connectivity before sending messages', async () => {
    content = content || (await readTestScript());
    assert.ok(content.includes('connect-timeout'), 'Should use connect-timeout for server check');
  });

  test('gracefully handles server not running', async () => {
    content = content || (await readTestScript());
    assert.ok(
      content.includes('Server not responding') || content.includes('server not running'),
      'Should report when server is not running'
    );
    assert.ok(content.includes('npm start'), 'Should suggest starting the server');
  });

  test('suggests --validate-only when server is down', async () => {
    content = content || (await readTestScript());
    assert.ok(
      content.includes('--validate-only'),
      'Should suggest --validate-only for offline testing'
    );
  });
});

describe('test.sh output format', () => {
  let content;

  test('uses PASS/FAIL/SKIP prefixes', async () => {
    content = content || (await readTestScript());
    assert.ok(content.includes('PASS:'), 'Should use PASS: prefix');
    assert.ok(content.includes('FAIL:'), 'Should use FAIL: prefix');
    assert.ok(content.includes('SKIP:'), 'Should use SKIP: prefix');
  });

  test('tracks pass/fail/skip counts', async () => {
    content = content || (await readTestScript());
    assert.ok(content.includes('PASSED='), 'Should track PASSED count');
    assert.ok(content.includes('FAILED='), 'Should track FAILED count');
    assert.ok(content.includes('SKIPPED='), 'Should track SKIPPED count');
  });

  test('prints summary with counts', async () => {
    content = content || (await readTestScript());
    assert.ok(content.includes('Results:'), 'Should print results summary');
    assert.ok(content.includes('passed'), 'Summary should include passed count');
    assert.ok(content.includes('failed'), 'Summary should include failed count');
    assert.ok(content.includes('skipped'), 'Summary should include skipped count');
  });

  test('exits with code 1 on failures', async () => {
    content = content || (await readTestScript());
    assert.ok(content.includes('exit 1'), 'Should exit 1 on failures');
    assert.ok(content.includes('exit 0'), 'Should exit 0 on success');
  });
});

describe('test.sh structure validation', () => {
  let content;

  test('checks config.json exists', async () => {
    content = content || (await readTestScript());
    assert.ok(content.includes('config.json'), 'Should check for config.json');
  });

  test('checks bot config.json files exist', async () => {
    content = content || (await readTestScript());
    assert.ok(
      content.includes('config.json') && content.includes('bots/'),
      'Should check bot config files'
    );
  });

  test('checks soul.md files exist', async () => {
    content = content || (await readTestScript());
    assert.ok(content.includes('soul.md'), 'Should check for soul.md files');
  });

  test('checks .env.example exists', async () => {
    content = content || (await readTestScript());
    assert.ok(content.includes('.env.example'), 'Should check for .env.example');
  });

  test('validates JSON syntax', async () => {
    content = content || (await readTestScript());
    assert.ok(content.includes('JSON.parse'), 'Should validate JSON syntax');
  });

  test('verifies bot id matches directory name', async () => {
    content = content || (await readTestScript());
    assert.ok(content.includes('.id') || content.includes('id'), 'Should verify bot id field');
  });

  test('runs config.test.js when available', async () => {
    content = content || (await readTestScript());
    assert.ok(content.includes('config.test.js'), 'Should run config.test.js');
    assert.ok(content.includes('node --test'), 'Should use node --test runner');
  });
});

describe('test.sh --validate-only execution', () => {
  test('runs successfully with --validate-only', () => {
    // Run the actual script in validate-only mode
    const result = execSync(`bash "${join(SCRIPTS_DIR, 'test.sh')}" --validate-only 2>&1`, {
      encoding: 'utf-8',
      cwd: DEMO_DIR,
    });
    assert.ok(result.includes('PASS:'), 'Should have passing tests');
    assert.ok(result.includes('Results:'), 'Should print summary');
    assert.ok(
      result.includes('Skipping message tests'),
      'Should skip message tests in validate-only mode'
    );
  });

  test('validate-only checks all 3 bots', () => {
    const result = execSync(`bash "${join(SCRIPTS_DIR, 'test.sh')}" --validate-only 2>&1`, {
      encoding: 'utf-8',
      cwd: DEMO_DIR,
    });
    assert.ok(result.includes('echo-bot'), 'Should test echo-bot');
    assert.ok(result.includes('calculator-bot'), 'Should test calculator-bot');
    assert.ok(result.includes('file-assistant'), 'Should test file-assistant');
  });

  test('validate-only includes all phases', () => {
    const result = execSync(`bash "${join(SCRIPTS_DIR, 'test.sh')}" --validate-only 2>&1`, {
      encoding: 'utf-8',
      cwd: DEMO_DIR,
    });
    assert.ok(result.includes('Phase 1'), 'Should run Phase 1');
    assert.ok(result.includes('Phase 2'), 'Should run Phase 2');
    assert.ok(result.includes('Phase 3'), 'Should run Phase 3');
  });

  test('validate-only exits with code 0 when all pass', () => {
    // Should not throw (exit 0)
    execSync(`bash "${join(SCRIPTS_DIR, 'test.sh')}" --validate-only 2>&1`, {
      encoding: 'utf-8',
      cwd: DEMO_DIR,
    });
  });

  test('validate-only reports zero failures', () => {
    const result = execSync(`bash "${join(SCRIPTS_DIR, 'test.sh')}" --validate-only 2>&1`, {
      encoding: 'utf-8',
      cwd: DEMO_DIR,
    });
    assert.ok(result.includes('0 failed'), 'Should have 0 failures');
  });
});

describe('test.sh --bot flag execution', () => {
  test('can test a single bot with --bot', () => {
    const result = execSync(
      `bash "${join(SCRIPTS_DIR, 'test.sh')}" --validate-only --bot echo-bot 2>&1`,
      { encoding: 'utf-8', cwd: DEMO_DIR }
    );
    assert.ok(result.includes('echo-bot'), 'Should test echo-bot');
    assert.ok(result.includes('PASS:'), 'Should have passing tests');
  });

  test('single bot mode only tests specified bot', () => {
    const result = execSync(
      `bash "${join(SCRIPTS_DIR, 'test.sh')}" --validate-only --bot echo-bot 2>&1`,
      { encoding: 'utf-8', cwd: DEMO_DIR }
    );
    // Should not contain other bot names in test output (except maybe in generic messages)
    const lines = result.split('\n').filter(l => l.includes('PASS:') || l.includes('FAIL:'));
    const otherBotLines = lines.filter(
      l => l.includes('calculator-bot') || l.includes('file-assistant')
    );
    assert.equal(otherBotLines.length, 0, 'Should not test other bots when --bot is specified');
  });
});

describe('test.sh consistency with demo project', () => {
  test('uses same port as REST API docs (3000)', async () => {
    const content = await readTestScript();
    assert.ok(content.includes('3000'), 'Should default to port 3000 matching REST API design');
  });

  test('test messages match bot capabilities', async () => {
    const content = await readTestScript();

    // Echo bot should get a simple message (no tools needed)
    const echoMatch = content.match(/TEST_MESSAGES\[echo-bot\]='([^']+)'/);
    assert.ok(echoMatch, 'Should have echo-bot message');

    // Calculator bot should get math (uses bash tool)
    const calcMatch = content.match(/TEST_MESSAGES\[calculator-bot\]='([^']+)'/);
    assert.ok(calcMatch, 'Should have calculator-bot message');
    assert.ok(/\d/.test(calcMatch[1]), 'Calculator message should contain numbers');

    // File assistant should get file operation (uses file tools)
    const fileMatch = content.match(/TEST_MESSAGES\[file-assistant\]='([^']+)'/);
    assert.ok(fileMatch, 'Should have file-assistant message');
    assert.ok(/file/i.test(fileMatch[1]), 'File assistant message should mention files');
  });

  test('endpoint matches REST API design: /api/bots/{botId}/message', async () => {
    const content = await readTestScript();
    assert.ok(
      content.includes('/api/bots/${bot_id}/message') ||
        (content.includes('/api/bots/') && content.includes('/message')),
      'Should use /api/bots/{botId}/message endpoint'
    );
  });
});
