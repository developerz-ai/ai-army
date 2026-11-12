/**
 * Unit tests for the repository's link checker (scripts/check-links.js).
 *
 * The checker is imported, never executed here: its `main()` entry sets
 * `process.exitCode` instead of calling `process.exit`, and the module-level
 * direct-run guard only fires when invoked as `node scripts/check-links.js`.
 * The `main` tests scan a synthetic fixture tree under the OS temp dir and
 * reset `process.exitCode` afterwards so they cannot fail the whole run.
 *
 * @module
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertPublicHost,
  classifyTarget,
  codeFreeLines,
  extractReferenceUsages,
  extractTargets,
  isBrokenStatus,
  isPrivateHost,
  main,
  normalizeLabel,
  PrivateHostError,
  referenceLabels,
} from '../../scripts/check-links.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOCS_DIR = path.join(REPO_ROOT, 'docs');
const DOCS_PAGE = path.join(DOCS_DIR, 'getting-started', 'first-bot.md');
const ROOT_README = path.join(REPO_ROOT, 'README.md');
const SIDEBAR = path.join(DOCS_DIR, '_sidebar.md');
const TEMPLATE_README = path.join(REPO_ROOT, 'templates', 'project', 'README.md');

/** Build a fixture tree and clean it up when the test ends. */
async function withFixture(build, run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'check-links-'));
  try {
    await build(root);
    await run(root);
  } finally {
    process.exitCode = undefined;
    await fs.rm(root, { recursive: true, force: true });
  }
}

describe('extractTargets', () => {
  test('finds inline links and images', () => {
    const source =
      'See [guide](guide.md), ![logo](img/logo.png "Logo") and [x](sub/page.md#anchor).';
    assert.deepStrictEqual(extractTargets([source]), [
      { line: 1, target: 'guide.md' },
      { line: 1, target: 'img/logo.png' },
      { line: 1, target: 'sub/page.md#anchor' },
    ]);
  });

  test('finds reference-style definitions', () => {
    const source = ['[docs]: ./docs/', '[site]: <https://example.com> "Site"', 'plain text'].join(
      '\n'
    );
    assert.deepStrictEqual(extractTargets(codeFreeLines(source)), [
      { line: 1, target: './docs/' },
      { line: 2, target: 'https://example.com' },
    ]);
  });

  test('ignores targets inside fenced code blocks and inline code', () => {
    const source = [
      'Before',
      '```bash',
      'git clone [repo](https://example.com/x.git)',
      '```',
      'Use `[a](b.md)` inline.',
      '',
    ].join('\n');
    assert.deepStrictEqual(extractTargets(codeFreeLines(source)), []);
  });
});

describe('reference-style usages', () => {
  test('finds full and collapsed usages', () => {
    const lines = codeFreeLines('Full [text][label] and collapsed [shortcut][] usages.');
    assert.deepStrictEqual(extractReferenceUsages(lines), [
      { line: 1, label: 'label' },
      { line: 1, label: 'shortcut' },
    ]);
  });

  test('collects definition labels, normalized like CommonMark', () => {
    const lines = codeFreeLines(['[My Label]: ./target.md', '[other]: ./other.md'].join('\n'));
    const labels = referenceLabels(lines);
    assert.equal(labels.has('my label'), true);
    assert.equal(labels.has(normalizeLabel('  my\nlabel ')), true);
    assert.equal(labels.size, 2);
  });

  test('a usage without a definition is detectable', () => {
    const withDef = codeFreeLines(['[missing][gone]', '', '[gone]: ./target.md'].join('\n'));
    const withoutDef = codeFreeLines(['[missing][gone]', '', '[other]: ./other.md'].join('\n'));
    assert.equal(referenceLabels(withDef).has('gone'), true);
    assert.equal(referenceLabels(withoutDef).has('gone'), false);
    assert.deepEqual(extractReferenceUsages(withoutDef), [{ line: 1, label: 'gone' }]);
  });

  test('usages inside fenced code are ignored', () => {
    const lines = codeFreeLines(['```md', '[skip][me]', '```', ''].join('\n'));
    assert.deepEqual(extractReferenceUsages(lines), []);
  });
});

describe('classifyTarget', () => {
  test('skips anchors, empty targets, mailto and placeholder hosts', () => {
    assert.deepStrictEqual(classifyTarget('', DOCS_PAGE), { kind: 'skip' });
    assert.deepStrictEqual(classifyTarget('#anchor', DOCS_PAGE), { kind: 'skip' });
    assert.deepStrictEqual(classifyTarget('mailto:dev@example.com', DOCS_PAGE), { kind: 'skip' });
    assert.deepStrictEqual(classifyTarget('http://localhost:3000/health', DOCS_PAGE), {
      kind: 'skip',
    });
    assert.deepStrictEqual(classifyTarget('http://127.0.0.1:8080/', DOCS_PAGE), { kind: 'skip' });
    assert.deepStrictEqual(classifyTarget('https://example.com/', DOCS_PAGE), { kind: 'skip' });
    assert.deepStrictEqual(classifyTarget('http://sub.example.com/x', DOCS_PAGE), { kind: 'skip' });
  });

  test('skips non-http schemes', () => {
    assert.deepStrictEqual(classifyTarget('ftp://example.com/file', DOCS_PAGE), { kind: 'skip' });
    assert.deepStrictEqual(classifyTarget('ssh://git@github.com/x/y', DOCS_PAGE), { kind: 'skip' });
  });

  test('skips protocol-relative placeholder hosts before classifying external', () => {
    assert.deepStrictEqual(classifyTarget('//localhost:3000/health', DOCS_PAGE), { kind: 'skip' });
    assert.deepStrictEqual(classifyTarget('//example.com/logo.svg', DOCS_PAGE), { kind: 'skip' });
  });

  test('upgrades protocol-relative targets to https', () => {
    assert.deepStrictEqual(classifyTarget('//cdn.jsdelivr.net/npm/x', DOCS_PAGE), {
      kind: 'external',
      url: 'https://cdn.jsdelivr.net/npm/x',
    });
  });

  test('blocks non-public IP literals before they can be fetched', () => {
    assert.deepStrictEqual(classifyTarget('//169.254.169.254/latest/meta-data/', DOCS_PAGE), {
      kind: 'blocked',
      url: 'https://169.254.169.254/latest/meta-data/',
      reason: 'non-public host',
    });
    assert.deepStrictEqual(classifyTarget('http://10.0.0.1/internal', DOCS_PAGE), {
      kind: 'blocked',
      url: 'http://10.0.0.1/internal',
      reason: 'non-public host',
    });
  });

  test('passes https targets through as external', () => {
    assert.deepStrictEqual(classifyTarget('https://nodejs.org/docs', DOCS_PAGE), {
      kind: 'external',
      url: 'https://nodejs.org/docs',
    });
  });

  test('resolves docs/ page-relative targets inside the site only', () => {
    const classified = classifyTarget('./soul.md', DOCS_PAGE);
    assert.deepStrictEqual(classified, {
      kind: 'local',
      display: './soul.md',
      candidates: [path.join(DOCS_DIR, 'getting-started', 'soul.md')],
    });
  });

  test('resolves docs/ root-absolute targets from the site root only', () => {
    const classified = classifyTarget('/architecture.md', DOCS_PAGE);
    assert.deepStrictEqual(classified, {
      kind: 'local',
      display: '/architecture.md',
      candidates: [path.join(DOCS_DIR, 'architecture.md')],
    });
  });

  test('flags docs/ targets that escape the site, even though the file exists in the checkout', () => {
    const classified = classifyTarget('../../README.md', DOCS_PAGE);
    assert.equal(classified.kind, 'invalid');
    assert.equal(classified.reason, 'escapes-site');
    assert.equal(classified.resolved, path.join(REPO_ROOT, 'README.md'));
    assert.equal(classified.display, '../../README.md');
  });

  test('flags root-absolute docs/ targets that escape the site', () => {
    const classified = classifyTarget('/../CHANGELOG.md', DOCS_PAGE);
    assert.equal(classified.kind, 'invalid');
    assert.equal(classified.reason, 'escapes-site');
    assert.equal(classified.resolved, path.join(REPO_ROOT, 'CHANGELOG.md'));
  });

  test('decodes percent-encoded targets and keeps anchors out of the path', () => {
    const classified = classifyTarget('./soul%20file.md#anchor', DOCS_PAGE);
    assert.equal(classified.display, './soul%20file.md#anchor');
    assert.deepEqual(classified.candidates, [
      path.join(DOCS_DIR, 'getting-started', 'soul file.md'),
    ]);
  });

  test('flags page-relative targets in docsify nav files even when the target exists', () => {
    // docs/getting-started/installation.md exists on disk; docsify renders
    // _sidebar.md on every page and resolves this against the *current
    // page's* path, which 404s on nested pages. Only root-absolute is valid.
    const classified = classifyTarget('getting-started/installation.md', SIDEBAR);
    assert.equal(classified.kind, 'invalid');
    assert.equal(classified.reason, 'nav-relative');
    assert.equal(classified.display, 'getting-started/installation.md');
  });

  test('resolves root-absolute nav targets from the site root', () => {
    const classified = classifyTarget('/getting-started/installation.md', SIDEBAR);
    assert.deepStrictEqual(classified, {
      kind: 'local',
      display: '/getting-started/installation.md',
      candidates: [path.join(DOCS_DIR, 'getting-started', 'installation.md')],
    });
  });

  test('resolves repo-tree relative targets from the file directory, then the repository root', () => {
    const classified = classifyTarget('./example.md', TEMPLATE_README);
    assert.deepEqual(classified.candidates, [
      path.join(REPO_ROOT, 'templates', 'project', 'example.md'),
      path.join(REPO_ROOT, 'example.md'),
    ]);
  });

  test('resolves root-level root-absolute targets from the repository root only', () => {
    const classified = classifyTarget('/CONTRIBUTING.md', ROOT_README);
    assert.deepEqual(classified.candidates, [path.join(REPO_ROOT, 'CONTRIBUTING.md')]);
  });
});

describe('codeFreeLines', () => {
  test('blanks fenced blocks and strips inline code spans', () => {
    const source = 'Before `code [x](y)` after\n```js\nconst a = "[skip](skip.md)";\n```\nAfter';
    assert.deepStrictEqual(codeFreeLines(source), ['Before  after', '', '', '', 'After']);
  });

  test('a closing fence must be at least as long as the opening run', () => {
    // The three-backtick line inside the four-backtick fence is content;
    // only the four-backtick run closes the fence.
    const source = [
      '````',
      '[skip](nope.md)',
      '```',
      '[still](hidden.md)',
      '````',
      '[real](shown.md)',
    ].join('\n');
    assert.deepStrictEqual(codeFreeLines(source), ['', '', '', '', '', '[real](shown.md)']);
  });

  test('a longer closing run closes the fence', () => {
    const source = ['~~~', '[skip](nope.md)', '~~~~', '[real](shown.md)'].join('\n');
    assert.deepStrictEqual(codeFreeLines(source), ['', '', '', '[real](shown.md)']);
  });

  test('a fence is not closed by a run of the other character', () => {
    const tilde = ['~~~', '```', '[skip](nope.md)', '~~~', '[real](shown.md)'].join('\n');
    assert.deepStrictEqual(codeFreeLines(tilde), ['', '', '', '', '[real](shown.md)']);
    const backtick = ['```', '~~~', '[skip](nope.md)', '```', '[real](shown.md)'].join('\n');
    assert.deepStrictEqual(codeFreeLines(backtick), ['', '', '', '', '[real](shown.md)']);
  });
});

describe('isPrivateHost', () => {
  test('identifies non-public IPv4 ranges', () => {
    for (const host of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '203.0.113.5',
      '198.51.100.7',
      '224.0.0.1',
      '240.0.0.1',
      '255.255.255.255',
    ]) {
      assert.equal(isPrivateHost(host), true, `${host} should be non-public`);
    }
  });

  test('identifies public IPv4 addresses', () => {
    for (const host of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '198.51.101.7']) {
      assert.equal(isPrivateHost(host), false, `${host} should be public`);
    }
  });

  test('identifies non-public IPv6 addresses', () => {
    for (const host of ['::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '::']) {
      assert.equal(isPrivateHost(host), true, `${host} should be non-public`);
    }
    assert.equal(isPrivateHost('2606:4700::1111'), false);
  });
});

describe('assertPublicHost', () => {
  test('rejects link-local and private IP literals without touching the network', async () => {
    await assert.rejects(
      assertPublicHost('http://169.254.169.254/latest/meta-data/'),
      PrivateHostError
    );
    await assert.rejects(assertPublicHost('http://10.0.0.1/internal'), PrivateHostError);
    await assert.rejects(assertPublicHost('http://[fd00::1]/'), PrivateHostError);
  });

  test('accepts public IP literals without DNS', async () => {
    await assert.doesNotReject(assertPublicHost('https://8.8.8.8/'));
  });
});

describe('docsify site config', () => {
  test('docs/index.html enables docsify relativePath mode', () => {
    // The whole checker's page-relative resolution for docs/ pages assumes
    // the site serves pages with relativePath: true; pin it so deleting the
    // line cannot turn every page-relative link back into a 404 silently.
    const html = readFileSync(path.join(REPO_ROOT, 'docs', 'index.html'), 'utf8');
    assert.match(html, /relativePath:\s*true/);
  });
});

describe('isBrokenStatus', () => {
  test('flags 404, 410 and 5xx as broken', () => {
    assert.equal(isBrokenStatus(404), true);
    assert.equal(isBrokenStatus(410), true);
    assert.equal(isBrokenStatus(500), true);
    assert.equal(isBrokenStatus(503), true);
  });

  test('accepts 2xx and 3xx statuses', () => {
    assert.equal(isBrokenStatus(200), false);
    assert.equal(isBrokenStatus(204), false);
    assert.equal(isBrokenStatus(301), false);
    assert.equal(isBrokenStatus(302), false);
  });
});

describe('main', () => {
  test('a tree with one missing relative link exits non-zero', async () => {
    await withFixture(
      async root => {
        await fs.mkdir(path.join(root, 'docs'), { recursive: true });
        await fs.writeFile(
          path.join(root, 'docs', 'README.md'),
          '[index](index.md)\n[missing](missing.md)\n'
        );
        await fs.writeFile(path.join(root, 'docs', 'index.md'), '# Index\n');
      },
      async root => {
        await main({ root });
        assert.equal(process.exitCode, 1);
      }
    );
  });

  test('a tree with only resolvable links exits zero', async () => {
    await withFixture(
      async root => {
        await fs.mkdir(path.join(root, 'docs', 'getting-started'), { recursive: true });
        await fs.writeFile(
          path.join(root, 'docs', 'README.md'),
          '[index](index.md)\n[tutorial](getting-started/installation.md)\n'
        );
        await fs.writeFile(path.join(root, 'docs', 'index.md'), '# Index\n');
        await fs.writeFile(
          path.join(root, 'docs', 'getting-started', 'installation.md'),
          '# Installation\n'
        );
      },
      async root => {
        await main({ root });
        assert.equal(process.exitCode, undefined);
      }
    );
  });

  test('a page-relative sidebar target fails even though the target file exists', async () => {
    await withFixture(
      async root => {
        await fs.mkdir(path.join(root, 'docs', 'getting-started'), { recursive: true });
        await fs.writeFile(
          path.join(root, 'docs', '_sidebar.md'),
          '- [Tutorial](getting-started/installation.md)\n'
        );
        await fs.writeFile(
          path.join(root, 'docs', 'getting-started', 'installation.md'),
          '# Installation\n'
        );
      },
      async root => {
        await main({ root });
        assert.equal(process.exitCode, 1);
      }
    );
  });

  test('a docs page linking outside the docs site fails even though the file exists', async () => {
    await withFixture(
      async root => {
        await fs.writeFile(path.join(root, 'README.md'), '# Repo\n');
        await fs.mkdir(path.join(root, 'docs'), { recursive: true });
        await fs.writeFile(
          path.join(root, 'docs', 'README.md'),
          '[repo readme](../../README.md)\n'
        );
      },
      async root => {
        await main({ root });
        assert.equal(process.exitCode, 1);
      }
    );
  });

  test('external: false never fetches external links', async () => {
    await withFixture(
      async root => {
        await fs.mkdir(path.join(root, 'docs'), { recursive: true });
        await fs.writeFile(
          path.join(root, 'docs', 'README.md'),
          '[dead](https://ai-army-link-check.invalid/missing)\n'
        );
      },
      async root => {
        const realFetch = globalThis.fetch;
        let fetched = 0;
        globalThis.fetch = async () => {
          fetched += 1;
          return new globalThis.Response(null, { status: 404 });
        };
        try {
          await main({ root, external: false });
        } finally {
          globalThis.fetch = realFetch;
        }
        assert.equal(fetched, 0);
        assert.equal(process.exitCode, undefined);
      }
    );
  });
});

describe('repository documentation (CI gate)', () => {
  // This is how `npm run check:links` runs in CI: the unit-tests job in
  // .github/workflows/ci.yml runs `npm run test:unit`, so every local and
  // reference link in the real tree is checked on every push and PR.
  // External links are not fetched here (CI runners may lack outbound
  // access); run `npm run check:links` for the full check.
  test('every local and reference link in the repository resolves', async () => {
    const errors = [];
    const realError = console.error;
    const realLog = console.log;
    console.error = (...args) => errors.push(args.join(' '));
    console.log = () => {};
    try {
      await main({ external: false });
      assert.equal(process.exitCode, undefined, `broken links:\n${errors.join('\n')}`);
    } finally {
      console.error = realError;
      console.log = realLog;
      process.exitCode = undefined;
    }
  });
});
