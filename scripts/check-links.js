#!/usr/bin/env node
/**
 * Dependency-free markdown link checker for the repository documentation.
 *
 * Scans the root markdown files plus every `*.md` under `docs/` and verifies:
 *
 * 1. Relative and root-absolute targets resolve to an existing file or
 *    directory on disk. Relative targets resolve from the containing file's
 *    directory first — docsify runs with `relativePath: true`, so page-relative
 *    links stay page-relative — and fall back to the repository root. The
 *    docs site serves only `docs/`, so a target that lives above it cannot
 *    resolve page-locally in the browser (`relativePath` resolves it against
 *    the containing page's own path); the fallback verifies such a target
 *    against the checkout instead. A target that only resolves through that
 *    fallback is reported as a non-fatal note, never as broken. Root-absolute
 *    targets (`/getting-started/x.md`)
 *    resolve from the docsify site root (`docs/`, where `index.html` lives)
 *    for files under `docs/`, and from the repository root otherwise — the
 *    same semantics the docs site runs with `relativePath: true`, which is
 *    what makes `_sidebar.md`/`_navbar.md` targets resolve from any page.
 * 2. External `http(s)` links respond without a 404, 410 or 5xx status.
 *
 * Fenced code blocks and inline code spans are stripped before extraction, so
 * link syntax inside code samples is never checked. Anchor-only targets,
 * `mailto:` and other URI schemes, and placeholder hosts (localhost,
 * 127.0.0.1, example.com and its subdomains) are skipped.
 *
 * Usage: `node scripts/check-links.js` — exits 1 when any link is broken.
 *
 * @module
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Repository root (the checkout containing this script). */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Root-level markdown files that are always scanned. */
const ROOT_FILES = [
  'README.md',
  'CONTRIBUTING.md',
  'CHANGELOG.md',
  'CLAUDE.md',
  'AGENT.md',
  'AGENTS.md',
];

/** Timeout for one external link request, in milliseconds. */
const HTTP_TIMEOUT_MS = 15000;

/** Attempts per external URL before reporting a network error. */
const FETCH_ATTEMPTS = 3;

/** How many external URLs are fetched at the same time. */
const FETCH_CONCURRENCY = 6;

/**
 * Inline link or image, tolerating one nesting level in the text (e.g. badge
 * images) and one balanced-paren level in the destination — a bare `[^)\s]*`
 * would cut `[x](https://host/Page_(Section))` at the first `)` and fetch a
 * truncated, non-existent URL.
 */
const INLINE_LINK = /\[((?:[^[\]]|\[[^[\]]*\])*)]\(\s*(<[^>]*>|(?:[^()\s]|\([^()\s]*\))*)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;

/** Reference-style definition at the start of a line: `[label]: target`. */
const REFERENCE_DEF = /^ {0,3}\[[^\]]+]:\s*(.*)$/;

/** Opening code fence: three or more backticks or tildes, optional info string. */
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

/** Closing code fence: the fence run alone on its line. */
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/;

/** Inline code span: a backtick run, its content, and a closing backtick run. */
const CODE_SPAN = /`+[^`]*`+/g;

/**
 * Recursively collect every markdown file under `docs/`.
 * @returns {string[]} Absolute file paths, sorted.
 */
function listDocsFiles() {
  const files = [];
  const docsDir = path.join(ROOT, 'docs');
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.name.endsWith('.md')) files.push(abs);
    }
  };
  if (existsSync(docsDir)) walk(docsDir);
  return files.sort();
}

/**
 * Split source into lines with fenced code blocks and inline code spans
 * removed. The result keeps one entry per input line, so the line numbers
 * reported for broken links stay accurate.
 * @param {string} source Raw file content.
 * @returns {string[]} Code-free lines.
 */
export function codeFreeLines(source) {
  let fenceChar = null;
  return source.split('\n').map((line) => {
    if (fenceChar) {
      if (FENCE_CLOSE.test(line) && line.trimStart()[0] === fenceChar) fenceChar = null;
      return '';
    }
    const fence = FENCE_OPEN.exec(line);
    if (fence) {
      fenceChar = fence[1][0];
      return '';
    }
    return line.replace(CODE_SPAN, '');
  });
}

/**
 * Extract every link target written in a file's code-free lines: inline links
 * and images (`[text](target)`), targets nested one level deep inside link
 * text (badge images), and reference definitions (`[label]: target`).
 * @param {string[]} lines Code-free lines of one file.
 * @returns {Array<{line: number, target: string}>} Targets with line numbers.
 */
export function extractTargets(lines) {
  const found = [];
  const scan = (text, lineNo, depth) => {
    for (const match of text.matchAll(INLINE_LINK)) {
      const raw = match[2].trim();
      const target = raw.startsWith('<') && raw.endsWith('>') ? raw.slice(1, -1) : raw;
      if (target) found.push({ line: lineNo, target });
      if (depth < 3) scan(match[1], lineNo, depth + 1);
    }
    const ref = REFERENCE_DEF.exec(text);
    if (ref) {
      const rest = ref[1].trim();
      const angled = /^<([^>]*)>/.exec(rest);
      const target = angled ? angled[1] : rest.split(/\s+/)[0];
      if (target) found.push({ line: lineNo, target });
    }
  };
  lines.forEach((text, index) => scan(text, index + 1, 0));
  return found;
}

/**
 * Decode a percent-encoded target without failing on stray `%` characters.
 * @param {string} target Raw link target.
 * @returns {string} Decoded target, or the raw target when decoding fails.
 */
const safeDecode = (target) => {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
};

/**
 * The directory that root-absolute targets resolve from: the docsify site
 * root (`docs/`) for files under it, the repository root for the root-level
 * markdown files.
 * @param {string} file Absolute path of the markdown file containing the link.
 * @returns {string} Absolute directory path.
 */
const absoluteBase = (file) => {
  const docsDir = path.join(ROOT, 'docs');
  return path.relative(docsDir, file).startsWith('..') ? ROOT : docsDir;
};

/**
 * Whether a URL hostname is a documentation placeholder that must never be
 * fetched: localhost, 127.0.0.1, ::1, example.com and its subdomains.
 * @param {string} hostname Hostname from `new URL(...)` (IPv6 keeps brackets).
 * @returns {boolean}
 */
const isPlaceholderHost = (hostname) => {
  const bare = hostname.replace(/^\[|]$/g, '').toLowerCase();
  return (
    bare === 'localhost' ||
    bare === '127.0.0.1' ||
    bare === '::1' ||
    bare === 'example.com' ||
    bare.endsWith('.example.com')
  );
};

/**
 * Classify one raw link target found in a markdown file.
 * @param {string} rawTarget Target exactly as written in the markdown.
 * @param {string} file Absolute path of the file containing the target.
 * @returns {{kind: 'skip'}|{kind: 'external', url: string}
 *   |{kind: 'local', candidates: string[], display: string}} Verdict per target.
 *   `candidates` lists the absolute paths to try in order: the docsify site
 *   root (root-absolute targets) or the file's own directory (relative
 *   targets) first, then the repository root as a fallback.
 */
export const classifyTarget = (rawTarget, file) => {
  const target = rawTarget.trim();
  if (!target || target.startsWith('#') || /^mailto:/i.test(target)) return { kind: 'skip' };
  if (target.startsWith('//')) return { kind: 'external', url: `https:${target}` };

  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(target);
  if (scheme) {
    if (!/^https?$/i.test(scheme[1])) return { kind: 'skip' };
    let hostname = null;
    try {
      hostname = new URL(target).hostname;
    } catch {
      hostname = null; // malformed URL: fetchStatus reports it as a failure
    }
    if (hostname !== null && isPlaceholderHost(hostname)) return { kind: 'skip' };
    return { kind: 'external', url: target };
  }

  const decoded = safeDecode(target.split('#', 1)[0]);
  const bases = decoded.startsWith('/')
    ? [absoluteBase(file), ROOT]
    : [path.dirname(file), ROOT];
  const candidates = [
    ...new Set(bases.map((base) => path.resolve(base, decoded.replace(/^\/+/, '')))),
  ];
  return { kind: 'local', candidates, display: target };
};

/**
 * Fetch one URL and return its final HTTP status, retrying transient network
 * errors a couple of times before giving up.
 * @param {string} url Absolute http(s) URL.
 * @returns {Promise<number>} Final HTTP status code after redirects.
 */
async function fetchStatus(url) {
  let lastError = null;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
        headers: { 'user-agent': 'ai-army-link-checker (repository documentation validation)' },
      });
      try {
        await response.body?.cancel(); // release the connection without reading the body
      } catch {
        // draining the body is best-effort
      }
      return response.status;
    } catch (error) {
      lastError = error;
      if (attempt < FETCH_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }
  }
  throw lastError;
}

/**
 * Whether an HTTP status means the link is broken: not found, gone, or a
 * server error. Other 4xx (403 bot blocks, 429 rate limits) count as alive.
 * @param {number} status Final HTTP status code.
 * @returns {boolean}
 */
export const isBrokenStatus = (status) => status === 404 || status === 410 || status >= 500;

/**
 * Run `worker` over `items` with at most `limit` promises in flight.
 * @param {unknown[]} items Items to process.
 * @param {number} limit Maximum number of concurrent workers.
 * @param {(item: unknown) => Promise<void>} worker Per-item work.
 * @returns {Promise<void>} Resolves when every item has been processed.
 */
async function mapWithLimit(items, limit, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

/**
 * Scan every scoped markdown file, check local targets against the checkout,
 * fetch external URLs, and print one line per broken link.
 * @returns {Promise<void>} Resolves with `process.exitCode` set on failures.
 */
export async function main() {
  const files = ROOT_FILES.map((name) => path.join(ROOT, name)).filter((file) => {
    if (existsSync(file)) return true;
    process.stderr.write(`note: ${path.relative(ROOT, file)} not found, skipped\n`);
    return false;
  });
  files.push(...listDocsFiles());

  /** @type {Array<{file: string, line: number, display: string, tried: string[]}>} */
  const brokenLocal = [];
  /** @type {Array<{file: string, line: number, display: string, resolved: string}>} */
  const rootResolved = [];
  /** @type {Map<string, Array<{file: string, line: number}>>} */
  const external = new Map();
  let localCount = 0;

  for (const file of files) {
    const lines = codeFreeLines(readFileSync(file, 'utf8'));
    for (const { line, target } of extractTargets(lines)) {
      const classified = classifyTarget(target, file);
      if (classified.kind === 'skip') continue;
      if (classified.kind === 'external') {
        const spots = external.get(classified.url) ?? [];
        spots.push({ file, line });
        external.set(classified.url, spots);
        continue;
      }
      localCount += 1;
      const hit = classified.candidates.findIndex((candidate) => existsSync(candidate));
      if (hit === -1) {
        brokenLocal.push({ display: classified.display, tried: classified.candidates, file, line });
      } else if (hit > 0) {
        rootResolved.push({
          display: classified.display,
          resolved: classified.candidates[hit],
          file,
          line,
        });
      }
    }
  }

  /** @type {Array<{url: string, detail: string}>} */
  const brokenExternal = [];
  await mapWithLimit([...external.keys()], FETCH_CONCURRENCY, async (url) => {
    try {
      const status = await fetchStatus(url);
      if (isBrokenStatus(status)) brokenExternal.push({ url, detail: `HTTP ${status}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      brokenExternal.push({ url, detail: `network error: ${message}` });
    }
  });

  for (const { file, line, display, tried } of brokenLocal) {
    const missing = tried.map((candidate) => path.relative(ROOT, candidate) || '.').join(' and ');
    console.error(
      `${path.relative(ROOT, file)}:${line}: broken relative link '${display}' ` +
        `(no such file or directory: ${missing})`,
    );
  }
  for (const { file, line, display, resolved } of rootResolved) {
    console.log(
      `${path.relative(ROOT, file)}:${line}: note '${display}' resolves from the repository ` +
        `root (${path.relative(ROOT, resolved)}), not from the file's own directory`,
    );
  }
  brokenExternal.sort((a, b) => a.url.localeCompare(b.url));
  for (const { url, detail } of brokenExternal) {
    const spots = (external.get(url) ?? [])
      .map(({ file, line }) => `${path.relative(ROOT, file)}:${line}`)
      .join(', ');
    console.error(`${url} -> ${detail} (referenced at ${spots})`);
  }

  const broken = brokenLocal.length + brokenExternal.length;
  console.log(
    `checked ${files.length} markdown files: ${localCount} local links ` +
      `(${rootResolved.length} via repository-root fallback), ` +
      `${external.size} external links, ${broken} broken`,
  );
  if (broken > 0) process.exitCode = 1;
}

export default main;

/* Run the check only when executed directly: `node scripts/check-links.js`. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  });
}
