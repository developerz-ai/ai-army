/**
 * Dependency-free markdown link checker for the repository documentation.
 *
 * Scans the root markdown files plus every `*.md` under `docs/`, `skills/`,
 * `.claude/`, `mcp-servers/` and `templates/`, and verifies:
 *
 * 1. Local targets resolve inside the scope the reader's viewer serves.
 *    Files under `docs/` are the docsify site GitHub Pages deploys, and
 *    Pages serves `docs/` only: a `docs/` page's target must resolve to a
 *    file inside `docs/`. Page-relative targets resolve from the page's own
 *    directory (`relativePath: true` in `docs/index.html`), root-absolute
 *    targets (`/getting-started/x.md`) resolve from the site root (`docs/`);
 *    a target that would land outside `docs/` is reported as broken, even
 *    though the file exists in the checkout, because the site 404s it.
 *    `docs/_sidebar.md` and `docs/_navbar.md` are rendered on every page, so
 *    docsify resolves their targets against the *current page's* path: only
 *    root-absolute targets are valid there, and a page-relative target is
 *    reported as broken even though it exists when resolved from the nav
 *    file's own directory. The repo's other markdown trees (root files,
 *    `skills/`, `.claude/`, `mcp-servers/`, `templates/`) are checked
 *    against the checkout: a relative target resolves from the containing
 *    file's directory first, then the repository root; a target that only
 *    resolves through the repository root is reported as a non-fatal note.
 * 2. Reference-style usages (`[text][label]`, `[label][]`) have a
 *    `[label]: target` definition in the same file — without one the usage
 *    renders as literal text.
 * 3. External `http(s)` links respond without a 404, 410 or 5xx status.
 *    Placeholder hosts (localhost, 127.0.0.1, ::1, example.com and its
 *    subdomains) are skipped. Non-public addresses (loopback, private,
 *    link-local, CGNAT, multicast, reserved — IPv4 and IPv6) are never
 *    fetched: requests use manual redirects and every hop's host is
 *    range-checked (DNS-resolved for names) before it is contacted, so a
 *    link can never point the runner at a private address, and no redirect
 *    is followed blind.
 *
 * Fenced code blocks and inline code spans are stripped before extraction,
 * so link syntax inside code samples is never checked. A fenced block is
 * only closed by a fence run at least as long as its opening run.
 * Anchor-only targets, `mailto:` and other URI schemes are skipped.
 *
 * Usage: `node scripts/check-links.js` — exits 1 when any link is broken.
 * Network errors (DNS failure, timeout, no outbound access) are reported
 * separately and are not fatal: a runner without outbound access fails on
 * its environment, not on phantom dead links.
 *
 * @module
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import dns from 'node:dns/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Repository root (the checkout that contains this script). */
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

/** Markdown trees scanned in addition to {@link ROOT_FILES}. */
const SCAN_TREES = ['docs', 'skills', '.claude', 'mcp-servers', 'templates'];

/** Timeout for one external link request, in milliseconds. */
const HTTP_TIMEOUT_MS = 15000;

/** Attempts per external URL before reporting a network error. */
const FETCH_ATTEMPTS = 3;

/** How many external URLs are fetched at the same time. */
const FETCH_CONCURRENCY = 6;

/** Redirect statuses that {@link fetchStatus} follows manually. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Maximum number of redirects followed per external URL. */
const MAX_REDIRECTS = 5;

/** User agent sent with every external request. */
const USER_AGENT = 'ai-army-link-checker (repository docs validation)';

/** Inline link or image: `[text](target)` — the text may contain one nesting level. */
const INLINE_LINK = /\[((?:[^[\]]|\[[^\]]*\])*)\]\(\s*([^)\s]*)(?:\s+"[^"]*")?\s*\)/g;

/** Reference-style definition at the start of a line: `[label]: target`. */
const REFERENCE_DEF = /^ {0,3}\[([^\]]+)]:\s*(.*)$/;

/** Reference-style usage: full `[text][label]` or collapsed `[label][]`. */
const REFERENCE_USAGE = /\[((?:[^[\]]|\[[^\]]*\])*)\]\[([^\]]*)\]/g;

/** Opening code fence: three or more backticks or tildes, optional info string. */
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

/** Inline code span: one or more backticks around text without that run inside. */
const CODE_SPAN = /`+[^`]*`+/g;

/** Percent-encoded path targets are decoded before they are resolved. */
const safeDecode = target => {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
};

/**
 * Normalize a link label the way CommonMark does for matching: casefold,
 * trim, and collapse internal whitespace.
 * @param {string} label Label as written in the markdown.
 * @returns {string} Normalized label.
 */
export const normalizeLabel = label => label.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Replace fenced code blocks and inline code spans with empty lines, so
 * that targets found in the returned lines are prose-only. A fence is
 * opened by a run of three or more backticks or tildes and closed by a run
 * of the same character that is at least as long as the opening run — a
 * shorter run inside stays content.
 * @param {string} source Full markdown source.
 * @returns {string[]} One entry per source line; content lines are kept,
 *   code lines come back empty.
 */
export function codeFreeLines(source) {
  let fence = null;
  return source.split('\n').map(line => {
    if (fence) {
      const closes = new RegExp(`^ {0,3}\\${fence.char}{${fence.length},}\\s*$`).test(line);
      if (closes) fence = null;
      return '';
    }
    const opened = FENCE_OPEN.exec(line);
    if (opened) {
      fence = { char: opened[1][0], length: opened[1].length };
      return '';
    }
    return line.replace(CODE_SPAN, '');
  });
}

/**
 * Extract every link target from code-free lines: inline links, images and
 * reference-style definitions.
 * @param {string[]} lines Lines as returned by {@link codeFreeLines}.
 * @returns {{line: number, target: string}[]} Targets with their line numbers.
 */
export function extractTargets(lines) {
  const found = [];
  lines.forEach((text, index) => {
    const lineNo = index + 1;
    for (const match of text.matchAll(INLINE_LINK)) {
      found.push({ line: lineNo, target: match[2] });
    }
    const def = REFERENCE_DEF.exec(text);
    if (def) {
      const rest = def[2].trim();
      const angled = /^<([^>]*)>/.exec(rest);
      const target = angled ? angled[1] : rest.split(/\s+/)[0];
      if (target) found.push({ line: lineNo, target });
    }
  });
  return found;
}

/**
 * Collect the labels of every reference-style definition in a file.
 * @param {string[]} lines Lines as returned by {@link codeFreeLines}.
 * @returns {Set<string>} Normalized labels (see {@link normalizeLabel}).
 */
export function referenceLabels(lines) {
  const labels = new Set();
  for (const text of lines) {
    const def = REFERENCE_DEF.exec(text);
    if (def) labels.add(normalizeLabel(def[1]));
  }
  return labels;
}

/**
 * Extract reference-style usages from code-free lines: full
 * (`[text][label]`) and collapsed (`[label][]`). A usage without a
 * definition renders as literal text, so usages are checked against
 * {@link referenceLabels}.
 * @param {string[]} lines Lines as returned by {@link codeFreeLines}.
 * @returns {{line: number, label: string}[]} Usages with their line numbers.
 */
export function extractReferenceUsages(lines) {
  const usages = [];
  lines.forEach((text, index) => {
    for (const match of text.matchAll(REFERENCE_USAGE)) {
      const label = match[2] ? match[2] : match[1];
      if (label.trim()) usages.push({ line: index + 1, label });
    }
  });
  return usages;
}

/**
 * Whether a URL hostname is a documentation placeholder that must never be
 * fetched: localhost, 127.0.0.1, ::1, example.com and its subdomains.
 * @param {string} hostname Hostname from `new URL(...)` (IPv6 keeps brackets).
 * @returns {boolean}
 */
const isPlaceholderHost = hostname => {
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
 * Parse one dotted-quad IPv4 address into an unsigned 32-bit integer.
 * @param {string} dotted Address like `192.168.0.1`.
 * @returns {number} The address as an unsigned 32-bit integer.
 */
const ipv4ToInt = dotted => {
  const [a, b, c, d] = dotted.split('.').map(part => Number.parseInt(part, 10));
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
};

/** Netmask for a prefix length, as an unsigned 32-bit integer. */
const netmaskFor = bits => (bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0);

/**
 * Non-public IPv4 ranges that must never be fetched: this-network, private,
 * CGNAT, loopback, link-local, IETF protocol, documentation, benchmarking,
 * multicast and reserved space.
 * @type {Array<[number, number]>} [network address, prefix bits]
 */
const PRIVATE_V4_RANGES = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
].map(([base, bits]) => [ipv4ToInt(base), bits]);

/**
 * Whether a bare hostname is a non-public IP address that must never be
 * fetched: IPv4/IPv6 literals in loopback, private, link-local, CGNAT,
 * multicast or reserved ranges, and IPv6-mapped IPv4. Named hosts are not
 * decided here — {@link assertPublicHost} resolves them first.
 * @param {string} bare Hostname without brackets, lowercased.
 * @returns {boolean}
 */
export const isPrivateHost = bare => {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(bare)) {
    const address = ipv4ToInt(bare);
    return PRIVATE_V4_RANGES.some(
      ([base, bits]) => (address & netmaskFor(bits)) === (base & netmaskFor(bits))
    );
  }
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(bare);
  if (mapped) return isPrivateHost(mapped[1]);
  if (bare === '::' || bare === '::1') return true;
  if (/^f[cd][0-9a-f]{2}:/.test(bare)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(bare)) return true;
  return false;
};

/**
 * Error thrown when a URL would make the runner contact a non-public
 * address. It carries the offending URL (the original one for a redirect
 * hop) so the caller can report the refusal without a stack trace.
 */
export class PrivateHostError extends Error {
  /** @param {string} url The URL whose host is not publicly routable. */
  constructor(url) {
    super(`refusing to fetch non-public host: ${url}`);
    this.name = 'PrivateHostError';
    this.url = url;
  }
}

/**
 * Ensure a URL's host is publicly routable before it is fetched. IP
 * literals are range-checked directly; named hosts are resolved and every
 * returned address is range-checked, so a DNS name pointing into a private
 * range is refused too.
 * @param {string|URL} url The URL about to be fetched.
 * @returns {Promise<void>} Resolves, or rejects with {@link PrivateHostError}.
 */
export async function assertPublicHost(url) {
  const { hostname } = url instanceof URL ? url : new URL(url);
  const bare = hostname.replace(/^\[|]$/g, '').toLowerCase();
  if (bare.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(bare)) {
    if (isPrivateHost(bare)) throw new PrivateHostError(String(url));
    return;
  }
  const addresses = await dns.lookup(bare, { all: true });
  if (addresses.some(({ address }) => isPrivateHost(address.toLowerCase()))) {
    throw new PrivateHostError(String(url));
  }
}

/**
 * The directory that root-absolute targets resolve from: the docsify site
 * root (`docs/`) for files under it, the repository root otherwise.
 * @param {string} file Absolute path of the file containing the target.
 * @param {string} root Repository root the file lives in.
 * @returns {string} Absolute base directory.
 */
const absoluteBase = (file, root) => {
  const docsDir = path.join(root, 'docs');
  return path.relative(docsDir, file).startsWith('..') ? root : docsDir;
};

/**
 * Classify one raw link target found in a markdown file.
 * @param {string} rawTarget Target exactly as written in the markdown.
 * @param {string} file Absolute path of the file containing the target.
 * @param {string} [root] Repository root the file lives in (defaults to the
 *   checkout; pass a fixture root when scanning a synthetic tree).
 * @returns {{kind: 'skip'}
 *   | {kind: 'external', url: string}
 *   | {kind: 'blocked', url: string, reason: string}
 *   | {kind: 'local', display: string, candidates: string[]}
 *   | {kind: 'invalid', display: string, reason: string, resolved?: string}}
 *   Verdict per target. `candidates` lists absolute paths to try in order;
 *   `blocked` marks an external URL whose host is non-public (never
 *   fetched); `invalid` marks a target that is broken by construction in
 *   its scope (a nav file's page-relative target, or a docs target that
 *   leaves the site Pages serves).
 */
export const classifyTarget = (rawTarget, file, root = ROOT) => {
  const target = rawTarget.trim();
  if (!target || target.startsWith('#') || /^mailto:/i.test(target)) return { kind: 'skip' };

  const classifyExternal = url => {
    const parsed = URL.canParse(url) ? new URL(url) : null;
    const hostname = parsed ? parsed.hostname : null;
    if (hostname !== null && isPlaceholderHost(hostname)) return { kind: 'skip' };
    if (hostname !== null && isPrivateHost(hostname.replace(/^\[|]$/g, '').toLowerCase())) {
      return { kind: 'blocked', url, reason: 'non-public host' };
    }
    return { kind: 'external', url };
  };

  if (target.startsWith('//')) return classifyExternal(`https:${target}`);

  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(target);
  if (scheme) {
    if (!/^https?$/i.test(scheme[1])) return { kind: 'skip' };
    return classifyExternal(target);
  }

  const docsDir = path.join(root, 'docs');
  const inSite = !path.relative(docsDir, file).startsWith('..');
  const inNav = inSite && ['_sidebar.md', '_navbar.md'].includes(path.basename(file));
  const decoded = safeDecode(target.split('#', 1)[0]);
  const stripped = decoded.replace(/^\/+/, '');
  const resolved = path.resolve(
    decoded.startsWith('/') ? absoluteBase(file, root) : path.dirname(file),
    stripped
  );
  if (inNav && !decoded.startsWith('/')) {
    return { kind: 'invalid', display: target, reason: 'nav-relative' };
  }
  if (inSite && path.relative(docsDir, resolved).startsWith('..')) {
    return { kind: 'invalid', display: target, reason: 'escapes-site', resolved };
  }
  if (inSite) return { kind: 'local', display: target, candidates: [resolved] };
  const bases = decoded.startsWith('/')
    ? [absoluteBase(file, root), root]
    : [path.dirname(file), root];
  const candidates = [...new Set(bases.map(base => path.resolve(base, stripped)))];
  return { kind: 'local', display: target, candidates };
};

/**
 * Whether an external HTTP status counts the link as broken.
 * @param {number} status HTTP status code.
 * @returns {boolean}
 */
export const isBrokenStatus = status => status === 404 || status === 410 || status >= 500;

/**
 * Fetch one URL and return its final HTTP status. Redirects are followed
 * manually and every hop — the original URL included — is host-checked
 * with {@link assertPublicHost} before it is contacted, so a redirect can
 * never point the runner at a private address. Transient network errors
 * are retried; {@link PrivateHostError} is not.
 * @param {string} url Absolute http(s) URL.
 * @returns {Promise<number>} Final HTTP status code after redirects.
 */
async function fetchStatus(url) {
  let lastError = null;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt += 1) {
    try {
      let current = new URL(url);
      for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
        await assertPublicHost(current);
        const response = await fetch(current, {
          redirect: 'manual',
          signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
          headers: { 'user-agent': USER_AGENT },
        });
        const { status } = response;
        const location = REDIRECT_STATUSES.has(status) ? response.headers.get('location') : null;
        try {
          await response.body?.cancel();
        } catch {
          // Releasing the body is best-effort; the status is already read.
        }
        if (!location) return status;
        if (hop === MAX_REDIRECTS) {
          throw new Error(`too many redirects (more than ${MAX_REDIRECTS})`);
        }
        current = new URL(location, current);
      }
      throw new Error(`too many redirects (more than ${MAX_REDIRECTS})`);
    } catch (error) {
      if (error instanceof PrivateHostError) throw error;
      lastError = error;
      if (attempt < FETCH_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, attempt * 1000));
      }
    }
  }
  throw lastError;
}

/**
 * Run `mapper` over `items` with at most `limit` in flight at once.
 * @template T
 * @param {T[]} items Items to process.
 * @param {number} limit Maximum concurrent mappers.
 * @param {(item: T) => Promise<void>} mapper Async worker per item.
 * @returns {Promise<void>} Resolves once every item is processed.
 */
async function mapWithLimit(items, limit, mapper) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await mapper(item);
    }
  });
  await Promise.all(workers);
}

/**
 * Recursively collect every markdown file under a directory. Hidden
 * entries are skipped (an explicitly named tree root such as `.claude` is
 * still walked).
 * @param {string} dir Absolute directory to walk.
 * @returns {string[]} Absolute file paths, sorted.
 */
function listMarkdownFiles(dir) {
  const files = [];
  const walk = current => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.name.endsWith('.md')) files.push(abs);
    }
  };
  walk(dir);
  return files.sort();
}

/**
 * Run the link check over a repository tree and report the results. Every
 * broken local target, missing reference usage, broken external link and
 * non-public-host refusal is printed with the file and line it came from;
 * network failures are reported separately and do not fail the run.
 * @param {{root?: string, external?: boolean}} [options] `root` overrides the
 *   repository root (used by tests to scan a fixture tree); `external: false`
 *   skips fetching external links (the offline check the unit-test CI job
 *   runs on the real tree via `test/unit/CheckLinks.test.js`).
 * @returns {Promise<void>} Sets `process.exitCode` to 1 when anything is broken.
 */
export async function main(options = {}) {
  const root = options.root ?? ROOT;
  const checkExternal = options.external ?? true;
  const files = ROOT_FILES.map(name => path.join(root, name)).filter(file => {
    if (existsSync(file)) return true;
    process.stderr.write(`note: ${path.relative(root, file) || file} not found, skipped\n`);
    return false;
  });
  for (const tree of SCAN_TREES) {
    const dir = path.join(root, tree);
    if (existsSync(dir)) files.push(...listMarkdownFiles(dir));
  }

  const rel = file => path.relative(root, file);
  const brokenLocal = [];
  const missingRefs = [];
  const skippedPrivate = [];
  const rootResolved = [];
  const externals = new Map();
  let localCount = 0;

  for (const file of files) {
    const lines = codeFreeLines(readFileSync(file, 'utf8'));
    const definitions = referenceLabels(lines);
    for (const { line, target } of extractTargets(lines)) {
      const classified = classifyTarget(target, file, root);
      if (classified.kind === 'skip') continue;
      if (classified.kind === 'external') {
        if (!externals.has(classified.url)) externals.set(classified.url, []);
        externals.get(classified.url).push({ file: rel(file), line });
        continue;
      }
      if (classified.kind === 'blocked') {
        skippedPrivate.push(
          `note: skipping ${classified.url} (${classified.reason}) — ${rel(file)}:${line}`
        );
        continue;
      }
      if (classified.kind === 'invalid') {
        brokenLocal.push({ file: rel(file), line, ...classified });
        continue;
      }
      localCount += 1;
      const hit = classified.candidates.findIndex(candidate => existsSync(candidate));
      if (hit === -1) {
        brokenLocal.push({
          file: rel(file),
          line,
          display: classified.display,
          tried: classified.candidates,
        });
      } else if (hit > 0) {
        rootResolved.push(
          `${rel(file)}:${line} '${classified.display}' -> ${classified.candidates[hit]}`
        );
      }
    }
    for (const { line, label } of extractReferenceUsages(lines)) {
      if (!definitions.has(normalizeLabel(label))) {
        missingRefs.push({ file: rel(file), line, label: label.trim() });
      }
    }
  }

  const brokenExternal = [];
  const networkErrors = [];
  const toFetch = checkExternal ? [...externals.keys()] : [];
  await mapWithLimit(toFetch, FETCH_CONCURRENCY, async url => {
    try {
      const status = await fetchStatus(url);
      if (isBrokenStatus(status)) {
        brokenExternal.push({ url, detail: `HTTP ${status}`, spots: externals.get(url) });
      }
    } catch (error) {
      if (error instanceof PrivateHostError) {
        skippedPrivate.push(`note: ${url} -> ${error.message}`);
      } else {
        const reason =
          error && error.name === 'TimeoutError' ? 'timed out' : (error?.message ?? String(error));
        networkErrors.push({ url, detail: reason, spots: externals.get(url) });
      }
    }
  });

  for (const { file, line, display, reason, resolved, tried } of brokenLocal) {
    if (reason === 'nav-relative') {
      console.error(
        `${file}:${line}: broken relative link '${display}' (_sidebar.md/_navbar.md render on every page — use a root-absolute target like '/getting-started/x.md')`
      );
    } else if (reason === 'escapes-site') {
      console.error(
        `${file}:${line}: broken site link '${display}' (resolves to ${rel(resolved)}, outside docs/ — GitHub Pages serves only the docs site)`
      );
    } else {
      console.error(
        `${file}:${line}: broken relative link '${display}' (no such file or directory: ${tried[0]})`
      );
    }
  }
  for (const { file, line, label } of missingRefs) {
    console.error(
      `${file}:${line}: broken reference link '[${label}]' (no '[${label}]: target' definition in this file; it renders as literal text)`
    );
  }
  for (const { url, detail, spots } of brokenExternal) {
    const at = spots.map(({ file: f, line }) => `${f}:${line}`).join(', ');
    console.error(`${url} -> ${detail} (referenced at ${at})`);
  }
  for (const { url, detail, spots } of networkErrors) {
    const at = spots.map(({ file: f, line }) => `${f}:${line}`).join(', ');
    console.error(
      `${url} -> network error, not counted as broken: ${detail} (referenced at ${at})`
    );
  }
  for (const note of skippedPrivate) console.log(note);

  const broken = brokenLocal.length + missingRefs.length + brokenExternal.length;
  let summary =
    `checked ${files.length} markdown files: ` +
    `${localCount} local links (${rootResolved.length} via repository-root fallback), ` +
    `${externals.size} external links${checkExternal ? '' : ' (not fetched)'}, ${broken} broken`;
  if (networkErrors.length > 0) {
    summary += `, ${networkErrors.length} network error(s) not counted as broken`;
  }
  console.log(summary);
  if (broken > 0) process.exitCode = 1;
}

/* Run the check only when executed directly: `node scripts/check-links.js`. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
