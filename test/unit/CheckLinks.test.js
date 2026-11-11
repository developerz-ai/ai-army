/**
 * Unit tests for the repository's link checker (scripts/check-links.js).
 *
 * The script is CI-gating logic whose pure helpers are exported precisely so they can
 * be pinned without touching the network or the filesystem. Importing the module is
 * safe: its auto-run guard compares `import.meta.url` against `process.argv[1]`, so it
 * only runs when invoked as `node scripts/check-links.js`, never when imported here.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  classifyTarget,
  codeFreeLines,
  extractTargets,
  isBrokenStatus,
} from '../../scripts/check-links.js';

/** Repository root, resolved from this file's URL so the suite works from any cwd. */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The docsify site root — where root-absolute targets of docs pages resolve from. */
const DOCS_ROOT = path.join(REPO_ROOT, 'docs');

/** A docs page path used as the containing file for classification tests. */
const DOCS_PAGE = path.join(DOCS_ROOT, 'getting-started', 'page.md');

describe('extractTargets', () => {
  test('keeps balanced-paren targets whole (wiki X_(y) style)', () => {
    // A parenthesised URL stays whole as a reference definition: its target is the
    // whitespace-delimited token, so the closing `)` remains part of the URL.
    assert.deepStrictEqual(extractTargets(['[wiki]: https://en.wikipedia.org/wiki/X_(y)']), [
      { line: 1, target: 'https://en.wikipedia.org/wiki/X_(y)' },
    ]);
  });

  test('a badge yields both of its targets', () => {
    // The image inside the link text and the link's own target are both checked;
    // the outer target is reported first, then the one nested in the link text.
    assert.deepStrictEqual(extractTargets(['[![a](img)](link)']), [
      { line: 1, target: 'link' },
      { line: 1, target: 'img' },
    ]);
  });

  test('extracts reference definitions', () => {
    assert.deepStrictEqual(extractTargets(['[label]: ./docs/x.md']), [
      { line: 1, target: './docs/x.md' },
    ]);
  });

  test('drops link titles and unwraps angled targets', () => {
    assert.deepStrictEqual(extractTargets(['[a](b.md "Title")']), [{ line: 1, target: 'b.md' }]);
    assert.deepStrictEqual(extractTargets(['[a](<sp ace.md>)']), [
      { line: 1, target: 'sp ace.md' },
    ]);
  });

  test('reports the line each target was found on', () => {
    assert.deepStrictEqual(extractTargets(['intro', '[l](x.md)']), [{ line: 2, target: 'x.md' }]);
  });
});

describe('classifyTarget', () => {
  test('skips anchors, mailto and placeholder hosts', () => {
    for (const target of [
      '#section',
      'mailto:user@example.com',
      'http://localhost:3000/health',
      'http://127.0.0.1:5984/',
      'http://[::1]:9200/',
      'https://example.com/',
      'https://sub.example.com/deep',
    ]) {
      assert.deepStrictEqual(classifyTarget(target, DOCS_PAGE), { kind: 'skip' });
    }
  });

  test('skips non-http(s) schemes', () => {
    for (const target of ['ftp://host/file.tar.gz', 'ssh://git@host/repo.git']) {
      assert.deepStrictEqual(classifyTarget(target, DOCS_PAGE), { kind: 'skip' });
    }
  });

  test('upgrades protocol-relative targets to https', () => {
    assert.deepStrictEqual(classifyTarget('//cdn.example.com/x.js', DOCS_PAGE), {
      kind: 'external',
      url: 'https://cdn.example.com/x.js',
    });
  });

  test('passes http(s) targets through as external', () => {
    assert.deepStrictEqual(classifyTarget('https://nodejs.org/api/', DOCS_PAGE), {
      kind: 'external',
      url: 'https://nodejs.org/api/',
    });
  });

  test('resolves relative targets from the file directory, then the repository root', () => {
    assert.deepStrictEqual(classifyTarget('./img/x.png', DOCS_PAGE), {
      kind: 'local',
      display: './img/x.png',
      candidates: [
        path.join(DOCS_ROOT, 'getting-started', 'img', 'x.png'),
        path.join(REPO_ROOT, 'img', 'x.png'),
      ],
    });
  });

  test('resolves root-absolute targets from the docsify site root, then the repository root', () => {
    assert.deepStrictEqual(classifyTarget('/architecture.md', DOCS_PAGE), {
      kind: 'local',
      display: '/architecture.md',
      candidates: [
        path.join(DOCS_ROOT, 'architecture.md'),
        path.join(REPO_ROOT, 'architecture.md'),
      ],
    });
  });

  test('strips the anchor and percent-decodes a local target before resolving', () => {
    const classified = classifyTarget('./my%20page.md#section', DOCS_PAGE);
    assert.equal(classified.kind, 'local');
    assert.deepStrictEqual(classified.candidates, [
      path.join(DOCS_ROOT, 'getting-started', 'my page.md'),
      path.join(REPO_ROOT, 'my page.md'),
    ]);
  });

  test('root-level files resolve root-absolute targets from the repository root only', () => {
    const classified = classifyTarget('/CONTRIBUTING.md', path.join(REPO_ROOT, 'README.md'));
    assert.equal(classified.kind, 'local');
    assert.deepStrictEqual(classified.candidates, [path.join(REPO_ROOT, 'CONTRIBUTING.md')]);
  });
});

describe('codeFreeLines', () => {
  test('blanks fenced blocks and strips inline code spans, one entry per input line', () => {
    const source = 'a `x](y.md)` b\n```js\n[skip](skip.md)\n```\n[real](real.md)';
    assert.deepStrictEqual(codeFreeLines(source), ['a  b', '', '', '', '[real](real.md)']);
  });

  test('handles tilde fences', () => {
    assert.deepStrictEqual(codeFreeLines('~~~sh\n[skip](skip.md)\n~~~'), ['', '', '']);
  });
});

describe('isBrokenStatus', () => {
  test('404, 410 and 5xx are broken', () => {
    for (const status of [404, 410, 500, 502, 503]) {
      assert.equal(isBrokenStatus(status), true);
    }
  });

  test('other statuses are alive', () => {
    for (const status of [200, 204, 301, 302, 403, 429]) {
      assert.equal(isBrokenStatus(status), false);
    }
  });
});
