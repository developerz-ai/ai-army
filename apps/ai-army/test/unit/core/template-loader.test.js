/**
 * Unit tests for TemplateLoader - Filesystem-based YAML template loader
 *
 * Tests the full lifecycle:
 * - Loading templates from a directory of YAML files
 * - Retrieving templates by type/id
 * - Listing available templates
 * - Instantiating workers with overrides (deep merge)
 * - Error handling for missing dirs, invalid YAML, duplicate IDs, etc.
 *
 * Uses a mock filesystem for isolation (no real disk I/O).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TemplateLoader, TemplateLoaderError } from '../../../src/core/template-loader.js';

// =============================================================================
// Mock filesystem factory
// =============================================================================

/**
 * Create a mock filesystem that serves files from an in-memory map
 *
 * @param {Object} fileTree - Map of absolute path -> content string
 * @param {Object} [opts={}] - Options
 * @param {string[]} [opts.directories=[]] - Paths that should be treated as directories
 * @returns {Object} Mock fs module with readFile, readdir, stat
 */
function createMockFs(fileTree = {}, opts = {}) {
  const directories = new Set(opts.directories || []);

  return {
    async readFile(filePath, _encoding) {
      if (fileTree[filePath] !== undefined) {
        return fileTree[filePath];
      }
      const err = new Error(`ENOENT: no such file or directory, open '${filePath}'`);
      err.code = 'ENOENT';
      throw err;
    },

    async readdir(dirPath) {
      // Collect files that are direct children of dirPath
      const prefix = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;
      const entries = [];
      for (const fullPath of Object.keys(fileTree)) {
        if (fullPath.startsWith(prefix)) {
          const relative = fullPath.slice(prefix.length);
          // Only direct children (no sub-paths)
          if (!relative.includes('/')) {
            entries.push(relative);
          }
        }
      }
      if (directories.has(dirPath) || entries.length > 0) {
        return entries;
      }
      const err = new Error(`ENOENT: no such file or directory, scandir '${dirPath}'`);
      err.code = 'ENOENT';
      throw err;
    },

    async stat(filePath) {
      if (directories.has(filePath)) {
        return { isDirectory: () => true, isFile: () => false };
      }
      if (fileTree[filePath] !== undefined) {
        return { isDirectory: () => false, isFile: () => true };
      }
      const err = new Error(`ENOENT: no such file or directory, stat '${filePath}'`);
      err.code = 'ENOENT';
      throw err;
    },
  };
}

// =============================================================================
// Sample YAML content
// =============================================================================

const BACKEND_TEMPLATE = `
id: backend-developer
name: Backend Developer
description: Expert in Python and backend development
container:
  image: ai-army/backend-developer:latest
  cpus: 2
  memory: '4g'
expertise: |
  You are an expert backend developer.
tools:
  - bash
  - git
  - python
resources:
  cpu: '2'
  memory: '4Gi'
  storage: '20Gi'
deployment:
  replicas: 1
  strategy: round-robin
  healthCheck:
    interval: 30
    timeout: 10
    retries: 3
enabled: true
`;

const FRONTEND_TEMPLATE = `
id: frontend-developer
name: Frontend Developer
description: Expert in React and frontend development
container:
  image: ai-army/frontend-developer:latest
  cpus: 2
  memory: '4g'
expertise: |
  You are an expert frontend developer.
tools:
  - bash
  - git
  - npm
resources:
  cpu: '2'
  memory: '4Gi'
  storage: '20Gi'
deployment:
  replicas: 1
  strategy: round-robin
  healthCheck:
    interval: 30
    timeout: 10
    retries: 3
enabled: true
`;

const TEMPLATES_DIR = '/mock/templates/workers';

// =============================================================================
// Tests
// =============================================================================

describe('TemplateLoader', () => {
  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  describe('constructor', () => {
    test('creates instance with default options', () => {
      const loader = new TemplateLoader();
      assert.ok(loader.templates instanceof Map);
      assert.equal(loader.loaded, false);
    });

    test('accepts custom fs module', () => {
      const mockFs = createMockFs({});
      const loader = new TemplateLoader({ fs: mockFs });
      assert.equal(loader._fs, mockFs);
    });
  });

  // ---------------------------------------------------------------------------
  // TemplateLoaderError
  // ---------------------------------------------------------------------------

  describe('TemplateLoaderError', () => {
    test('has correct name and properties', () => {
      const cause = new Error('root cause');
      const err = new TemplateLoaderError('something failed', {
        cause,
        operation: 'loadTemplates',
        templateId: 'test-tpl',
        filePath: '/some/path.yml',
      });

      assert.equal(err.name, 'TemplateLoaderError');
      assert.equal(err.message, 'something failed');
      assert.equal(err.operation, 'loadTemplates');
      assert.equal(err.templateId, 'test-tpl');
      assert.equal(err.filePath, '/some/path.yml');
      assert.equal(err.cause, cause);
    });

    test('extends Error', () => {
      const err = new TemplateLoaderError('test');
      assert.ok(err instanceof Error);
    });
  });

  // ---------------------------------------------------------------------------
  // loadTemplates
  // ---------------------------------------------------------------------------

  describe('loadTemplates', () => {
    test('loads YAML templates from a directory', async () => {
      const mockFs = createMockFs(
        {
          [`${TEMPLATES_DIR}/backend-developer.yml`]: BACKEND_TEMPLATE,
          [`${TEMPLATES_DIR}/frontend-developer.yml`]: FRONTEND_TEMPLATE,
        },
        { directories: [TEMPLATES_DIR] }
      );

      const loader = new TemplateLoader({ fs: mockFs });
      const result = await loader.loadTemplates(TEMPLATES_DIR);

      assert.equal(result.size, 2);
      assert.ok(result.has('backend-developer'));
      assert.ok(result.has('frontend-developer'));
      assert.equal(loader.loaded, true);
    });

    test('returns the templates map', async () => {
      const mockFs = createMockFs(
        {
          [`${TEMPLATES_DIR}/backend-developer.yml`]: BACKEND_TEMPLATE,
        },
        { directories: [TEMPLATES_DIR] }
      );

      const loader = new TemplateLoader({ fs: mockFs });
      const result = await loader.loadTemplates(TEMPLATES_DIR);

      assert.equal(result, loader.templates);
    });

    test('parses template fields correctly', async () => {
      const mockFs = createMockFs(
        {
          [`${TEMPLATES_DIR}/backend-developer.yml`]: BACKEND_TEMPLATE,
        },
        { directories: [TEMPLATES_DIR] }
      );

      const loader = new TemplateLoader({ fs: mockFs });
      await loader.loadTemplates(TEMPLATES_DIR);

      const tpl = loader.templates.get('backend-developer');
      assert.equal(tpl.id, 'backend-developer');
      assert.equal(tpl.name, 'Backend Developer');
      assert.equal(tpl.description, 'Expert in Python and backend development');
      assert.deepEqual(tpl.tools, ['bash', 'git', 'python']);
      assert.equal(tpl.container.image, 'ai-army/backend-developer:latest');
      assert.equal(tpl.enabled, true);
    });

    test('stores _filePath on each template', async () => {
      const mockFs = createMockFs(
        {
          [`${TEMPLATES_DIR}/backend-developer.yml`]: BACKEND_TEMPLATE,
        },
        { directories: [TEMPLATES_DIR] }
      );

      const loader = new TemplateLoader({ fs: mockFs });
      await loader.loadTemplates(TEMPLATES_DIR);

      const tpl = loader.templates.get('backend-developer');
      assert.equal(tpl._filePath, `${TEMPLATES_DIR}/backend-developer.yml`);
    });

    test('ignores non-.yml files', async () => {
      const mockFs = createMockFs(
        {
          [`${TEMPLATES_DIR}/backend-developer.yml`]: BACKEND_TEMPLATE,
          [`${TEMPLATES_DIR}/README.md`]: '# Templates',
          [`${TEMPLATES_DIR}/.gitkeep`]: '',
        },
        { directories: [TEMPLATES_DIR] }
      );

      const loader = new TemplateLoader({ fs: mockFs });
      await loader.loadTemplates(TEMPLATES_DIR);

      assert.equal(loader.templates.size, 1);
      assert.ok(loader.templates.has('backend-developer'));
    });

    test('handles empty directory', async () => {
      const mockFs = createMockFs({}, { directories: [TEMPLATES_DIR] });

      const loader = new TemplateLoader({ fs: mockFs });
      await loader.loadTemplates(TEMPLATES_DIR);

      assert.equal(loader.templates.size, 0);
      assert.equal(loader.loaded, true);
    });

    test('clears old templates on reload', async () => {
      const mockFs = createMockFs(
        {
          [`${TEMPLATES_DIR}/backend-developer.yml`]: BACKEND_TEMPLATE,
          [`${TEMPLATES_DIR}/frontend-developer.yml`]: FRONTEND_TEMPLATE,
        },
        { directories: [TEMPLATES_DIR] }
      );

      const loader = new TemplateLoader({ fs: mockFs });

      // First load
      await loader.loadTemplates(TEMPLATES_DIR);
      assert.equal(loader.templates.size, 2);

      // Simulate removing a file from the mock fs
      const mockFs2 = createMockFs(
        {
          [`${TEMPLATES_DIR}/backend-developer.yml`]: BACKEND_TEMPLATE,
        },
        { directories: [TEMPLATES_DIR] }
      );
      loader._fs = mockFs2;

      // Reload
      await loader.loadTemplates(TEMPLATES_DIR);
      assert.equal(loader.templates.size, 1);
      assert.ok(loader.templates.has('backend-developer'));
      assert.ok(!loader.templates.has('frontend-developer'));
    });

    test('sorts files for deterministic order', async () => {
      const mockFs = createMockFs(
        {
          [`${TEMPLATES_DIR}/z-worker.yml`]: 'id: z-worker\nname: Z Worker',
          [`${TEMPLATES_DIR}/a-worker.yml`]: 'id: a-worker\nname: A Worker',
        },
        { directories: [TEMPLATES_DIR] }
      );

      const loader = new TemplateLoader({ fs: mockFs });
      await loader.loadTemplates(TEMPLATES_DIR);

      const ids = [...loader.templates.keys()];
      assert.deepEqual(ids, ['a-worker', 'z-worker']);
    });

    // Error cases

    test('throws if directory does not exist', async () => {
      const mockFs = createMockFs({});
      const loader = new TemplateLoader({ fs: mockFs });

      await assert.rejects(
        () => loader.loadTemplates('/nonexistent/path'),
        err => {
          assert.equal(err.name, 'TemplateLoaderError');
          assert.equal(err.operation, 'loadTemplates');
          assert.ok(err.message.includes('not found'));
          return true;
        }
      );
    });

    test('throws if path is not a directory', async () => {
      const mockFs = createMockFs({
        '/some/file.yml': 'id: test',
      });
      const loader = new TemplateLoader({ fs: mockFs });

      await assert.rejects(
        () => loader.loadTemplates('/some/file.yml'),
        err => {
          assert.equal(err.name, 'TemplateLoaderError');
          assert.ok(err.message.includes('Not a directory'));
          return true;
        }
      );
    });

    test('throws on invalid YAML syntax', async () => {
      const mockFs = createMockFs(
        {
          [`${TEMPLATES_DIR}/bad.yml`]: ':\n  :\n  - [invalid',
        },
        { directories: [TEMPLATES_DIR] }
      );

      const loader = new TemplateLoader({ fs: mockFs });

      await assert.rejects(
        () => loader.loadTemplates(TEMPLATES_DIR),
        err => {
          assert.equal(err.name, 'TemplateLoaderError');
          assert.equal(err.operation, 'loadTemplates');
          assert.ok(err.message.includes('Failed to parse YAML'));
          return true;
        }
      );
    });

    test('throws if template is missing id field', async () => {
      const mockFs = createMockFs(
        {
          [`${TEMPLATES_DIR}/no-id.yml`]: 'name: No ID Worker\ndescription: Missing id',
        },
        { directories: [TEMPLATES_DIR] }
      );

      const loader = new TemplateLoader({ fs: mockFs });

      await assert.rejects(
        () => loader.loadTemplates(TEMPLATES_DIR),
        err => {
          assert.equal(err.name, 'TemplateLoaderError');
          assert.ok(err.message.includes("missing a valid 'id' field"));
          return true;
        }
      );
    });

    test('throws on duplicate template ids', async () => {
      const mockFs = createMockFs(
        {
          [`${TEMPLATES_DIR}/a-worker.yml`]: 'id: same-id\nname: Worker A',
          [`${TEMPLATES_DIR}/b-worker.yml`]: 'id: same-id\nname: Worker B',
        },
        { directories: [TEMPLATES_DIR] }
      );

      const loader = new TemplateLoader({ fs: mockFs });

      await assert.rejects(
        () => loader.loadTemplates(TEMPLATES_DIR),
        err => {
          assert.equal(err.name, 'TemplateLoaderError');
          assert.ok(err.message.includes("Duplicate template id 'same-id'"));
          return true;
        }
      );
    });

    test('throws if YAML parses to a non-object (e.g., string)', async () => {
      const mockFs = createMockFs(
        {
          [`${TEMPLATES_DIR}/scalar.yml`]: 'just a string',
        },
        { directories: [TEMPLATES_DIR] }
      );

      const loader = new TemplateLoader({ fs: mockFs });

      await assert.rejects(
        () => loader.loadTemplates(TEMPLATES_DIR),
        err => {
          assert.equal(err.name, 'TemplateLoaderError');
          assert.ok(err.message.includes('did not parse to an object'));
          return true;
        }
      );
    });

    test('throws if file cannot be read', async () => {
      const mockFs = createMockFs({}, { directories: [TEMPLATES_DIR] });
      // Override readdir to return a file that doesn't actually exist in the fileTree
      const originalReaddir = mockFs.readdir;
      mockFs.readdir = async dirPath => {
        const entries = await originalReaddir(dirPath);
        entries.push('ghost.yml');
        return entries;
      };

      const loader = new TemplateLoader({ fs: mockFs });

      await assert.rejects(
        () => loader.loadTemplates(TEMPLATES_DIR),
        err => {
          assert.equal(err.name, 'TemplateLoaderError');
          assert.ok(err.message.includes('Failed to read template file'));
          return true;
        }
      );
    });
  });

  // ---------------------------------------------------------------------------
  // getTemplate
  // ---------------------------------------------------------------------------

  describe('getTemplate', () => {
    test('returns a copy of the template', async () => {
      const mockFs = createMockFs(
        {
          [`${TEMPLATES_DIR}/backend-developer.yml`]: BACKEND_TEMPLATE,
        },
        { directories: [TEMPLATES_DIR] }
      );

      const loader = new TemplateLoader({ fs: mockFs });
      await loader.loadTemplates(TEMPLATES_DIR);

      const tpl = loader.getTemplate('backend-developer');
      assert.equal(tpl.id, 'backend-developer');
      assert.equal(tpl.name, 'Backend Developer');

      // Verify it's a copy (modifying it shouldn't affect the stored template)
      tpl.name = 'Modified';
      const tpl2 = loader.getTemplate('backend-developer');
      assert.equal(tpl2.name, 'Backend Developer');
    });

    test('returns null for non-existent template', async () => {
      const mockFs = createMockFs(
        {
          [`${TEMPLATES_DIR}/backend-developer.yml`]: BACKEND_TEMPLATE,
        },
        { directories: [TEMPLATES_DIR] }
      );

      const loader = new TemplateLoader({ fs: mockFs });
      await loader.loadTemplates(TEMPLATES_DIR);

      const result = loader.getTemplate('nonexistent');
      assert.equal(result, null);
    });

    test('throws if templates not loaded', () => {
      const loader = new TemplateLoader();

      assert.throws(
        () => loader.getTemplate('backend-developer'),
        err => {
          assert.equal(err.name, 'TemplateLoaderError');
          assert.ok(err.message.includes('not been loaded'));
          assert.equal(err.operation, 'getTemplate');
          return true;
        }
      );
    });

    test('throws if type is empty string', async () => {
      const mockFs = createMockFs({}, { directories: [TEMPLATES_DIR] });
      const loader = new TemplateLoader({ fs: mockFs });
      await loader.loadTemplates(TEMPLATES_DIR);

      assert.throws(
        () => loader.getTemplate(''),
        err => {
          assert.equal(err.name, 'TemplateLoaderError');
          assert.ok(err.message.includes('non-empty string'));
          return true;
        }
      );
    });

    test('throws if type is not a string', async () => {
      const mockFs = createMockFs({}, { directories: [TEMPLATES_DIR] });
      const loader = new TemplateLoader({ fs: mockFs });
      await loader.loadTemplates(TEMPLATES_DIR);

      assert.throws(
        () => loader.getTemplate(123),
        err => {
          assert.equal(err.name, 'TemplateLoaderError');
          assert.ok(err.message.includes('non-empty string'));
          return true;
        }
      );
    });
  });

  // ---------------------------------------------------------------------------
  // listTemplates
  // ---------------------------------------------------------------------------

  describe('listTemplates', () => {
    test('returns array of template summaries', async () => {
      const mockFs = createMockFs(
        {
          [`${TEMPLATES_DIR}/backend-developer.yml`]: BACKEND_TEMPLATE,
          [`${TEMPLATES_DIR}/frontend-developer.yml`]: FRONTEND_TEMPLATE,
        },
        { directories: [TEMPLATES_DIR] }
      );

      const loader = new TemplateLoader({ fs: mockFs });
      await loader.loadTemplates(TEMPLATES_DIR);

      const list = loader.listTemplates();
      assert.equal(list.length, 2);

      // Check structure
      for (const item of list) {
        assert.ok(item.id);
        assert.ok(item.name);
        assert.equal(typeof item.enabled, 'boolean');
        assert.ok(Array.isArray(item.tools));
      }
    });

    test('includes correct fields in summary', async () => {
      const mockFs = createMockFs(
        {
          [`${TEMPLATES_DIR}/backend-developer.yml`]: BACKEND_TEMPLATE,
        },
        { directories: [TEMPLATES_DIR] }
      );

      const loader = new TemplateLoader({ fs: mockFs });
      await loader.loadTemplates(TEMPLATES_DIR);

      const [item] = loader.listTemplates();
      assert.equal(item.id, 'backend-developer');
      assert.equal(item.name, 'Backend Developer');
      assert.equal(item.description, 'Expert in Python and backend development');
      assert.equal(item.enabled, true);
      assert.deepEqual(item.tools, ['bash', 'git', 'python']);
      assert.deepEqual(item.container, {
        image: 'ai-army/backend-developer:latest',
        cpus: 2,
        memory: '4g',
      });
    });

    test('returns empty array when no templates loaded', async () => {
      const mockFs = createMockFs({}, { directories: [TEMPLATES_DIR] });
      const loader = new TemplateLoader({ fs: mockFs });
      await loader.loadTemplates(TEMPLATES_DIR);

      const list = loader.listTemplates();
      assert.deepEqual(list, []);
    });

    test('defaults name to id when name is missing', async () => {
      const mockFs = createMockFs(
        {
          [`${TEMPLATES_DIR}/minimal.yml`]: 'id: minimal\ndescription: Minimal worker',
        },
        { directories: [TEMPLATES_DIR] }
      );

      const loader = new TemplateLoader({ fs: mockFs });
      await loader.loadTemplates(TEMPLATES_DIR);

      const [item] = loader.listTemplates();
      assert.equal(item.name, 'minimal');
    });

    test('shows enabled=false for disabled templates', async () => {
      const mockFs = createMockFs(
        {
          [`${TEMPLATES_DIR}/disabled.yml`]: 'id: disabled\nname: Disabled\nenabled: false',
        },
        { directories: [TEMPLATES_DIR] }
      );

      const loader = new TemplateLoader({ fs: mockFs });
      await loader.loadTemplates(TEMPLATES_DIR);

      const [item] = loader.listTemplates();
      assert.equal(item.enabled, false);
    });

    test('throws if templates not loaded', () => {
      const loader = new TemplateLoader();

      assert.throws(
        () => loader.listTemplates(),
        err => {
          assert.equal(err.name, 'TemplateLoaderError');
          assert.ok(err.message.includes('not been loaded'));
          assert.equal(err.operation, 'listTemplates');
          return true;
        }
      );
    });
  });

  // ---------------------------------------------------------------------------
  // instantiateWorker
  // ---------------------------------------------------------------------------

  describe('instantiateWorker', () => {
    test('returns merged config with overrides', async () => {
      const mockFs = createMockFs(
        {
          [`${TEMPLATES_DIR}/backend-developer.yml`]: BACKEND_TEMPLATE,
        },
        { directories: [TEMPLATES_DIR] }
      );

      const loader = new TemplateLoader({ fs: mockFs });
      await loader.loadTemplates(TEMPLATES_DIR);

      const result = loader.instantiateWorker('backend-developer', {
        deployment: { replicas: 3 },
      });

      assert.equal(result.id, 'backend-developer');
      assert.equal(result.deployment.replicas, 3);
      // Other deployment fields preserved from template
      assert.equal(result.deployment.strategy, 'round-robin');
      assert.equal(result.deployment.healthCheck.interval, 30);
    });

    test('returns template as-is when no overrides', async () => {
      const mockFs = createMockFs(
        {
          [`${TEMPLATES_DIR}/backend-developer.yml`]: BACKEND_TEMPLATE,
        },
        { directories: [TEMPLATES_DIR] }
      );

      const loader = new TemplateLoader({ fs: mockFs });
      await loader.loadTemplates(TEMPLATES_DIR);

      const result = loader.instantiateWorker('backend-developer');

      assert.equal(result.id, 'backend-developer');
      assert.equal(result.name, 'Backend Developer');
      assert.equal(result.deployment.replicas, 1);
    });

    test('overrides replace arrays entirely', async () => {
      const mockFs = createMockFs(
        {
          [`${TEMPLATES_DIR}/backend-developer.yml`]: BACKEND_TEMPLATE,
        },
        { directories: [TEMPLATES_DIR] }
      );

      const loader = new TemplateLoader({ fs: mockFs });
      await loader.loadTemplates(TEMPLATES_DIR);

      const result = loader.instantiateWorker('backend-developer', {
        tools: ['bash', 'git', 'python', 'pip'],
      });

      assert.deepEqual(result.tools, ['bash', 'git', 'python', 'pip']);
    });

    test('deep merges nested objects', async () => {
      const mockFs = createMockFs(
        {
          [`${TEMPLATES_DIR}/backend-developer.yml`]: BACKEND_TEMPLATE,
        },
        { directories: [TEMPLATES_DIR] }
      );

      const loader = new TemplateLoader({ fs: mockFs });
      await loader.loadTemplates(TEMPLATES_DIR);

      const result = loader.instantiateWorker('backend-developer', {
        container: { memory: '8g' },
      });

      // Overridden field
      assert.equal(result.container.memory, '8g');
      // Preserved fields
      assert.equal(result.container.image, 'ai-army/backend-developer:latest');
      assert.equal(result.container.cpus, 2);
    });

    test('can add new top-level fields via overrides', async () => {
      const mockFs = createMockFs(
        {
          [`${TEMPLATES_DIR}/backend-developer.yml`]: BACKEND_TEMPLATE,
        },
        { directories: [TEMPLATES_DIR] }
      );

      const loader = new TemplateLoader({ fs: mockFs });
      await loader.loadTemplates(TEMPLATES_DIR);

      const result = loader.instantiateWorker('backend-developer', {
        customField: 'custom-value',
        repo: { url: 'git@github.com:org/repo.git', branch: 'main' },
      });

      assert.equal(result.customField, 'custom-value');
      assert.deepEqual(result.repo, { url: 'git@github.com:org/repo.git', branch: 'main' });
    });

    test('strips internal fields (starting with _)', async () => {
      const mockFs = createMockFs(
        {
          [`${TEMPLATES_DIR}/backend-developer.yml`]: BACKEND_TEMPLATE,
        },
        { directories: [TEMPLATES_DIR] }
      );

      const loader = new TemplateLoader({ fs: mockFs });
      await loader.loadTemplates(TEMPLATES_DIR);

      const result = loader.instantiateWorker('backend-developer');

      // _filePath should be stripped
      assert.equal(result._filePath, undefined);
    });

    test('does not mutate the original template', async () => {
      const mockFs = createMockFs(
        {
          [`${TEMPLATES_DIR}/backend-developer.yml`]: BACKEND_TEMPLATE,
        },
        { directories: [TEMPLATES_DIR] }
      );

      const loader = new TemplateLoader({ fs: mockFs });
      await loader.loadTemplates(TEMPLATES_DIR);

      loader.instantiateWorker('backend-developer', {
        deployment: { replicas: 10 },
      });

      // Original template should be unchanged
      const original = loader.templates.get('backend-developer');
      assert.equal(original.deployment.replicas, 1);
    });

    test('throws if template not found', async () => {
      const mockFs = createMockFs(
        {
          [`${TEMPLATES_DIR}/backend-developer.yml`]: BACKEND_TEMPLATE,
        },
        { directories: [TEMPLATES_DIR] }
      );

      const loader = new TemplateLoader({ fs: mockFs });
      await loader.loadTemplates(TEMPLATES_DIR);

      assert.throws(
        () => loader.instantiateWorker('nonexistent'),
        err => {
          assert.equal(err.name, 'TemplateLoaderError');
          assert.equal(err.operation, 'instantiateWorker');
          assert.equal(err.templateId, 'nonexistent');
          assert.ok(err.message.includes("'nonexistent' not found"));
          return true;
        }
      );
    });

    test('throws if type is empty', async () => {
      const mockFs = createMockFs({}, { directories: [TEMPLATES_DIR] });
      const loader = new TemplateLoader({ fs: mockFs });
      await loader.loadTemplates(TEMPLATES_DIR);

      assert.throws(
        () => loader.instantiateWorker(''),
        err => {
          assert.equal(err.name, 'TemplateLoaderError');
          assert.ok(err.message.includes('non-empty string'));
          return true;
        }
      );
    });

    test('throws if templates not loaded', () => {
      const loader = new TemplateLoader();

      assert.throws(
        () => loader.instantiateWorker('backend-developer'),
        err => {
          assert.equal(err.name, 'TemplateLoaderError');
          assert.ok(err.message.includes('not been loaded'));
          return true;
        }
      );
    });
  });

  // ---------------------------------------------------------------------------
  // _deepMerge (tested indirectly via instantiateWorker, plus edge cases)
  // ---------------------------------------------------------------------------

  describe('_deepMerge edge cases', () => {
    test('returns target when source is null', () => {
      const loader = new TemplateLoader();
      const target = { a: 1 };
      const result = loader._deepMerge(target, null);
      assert.deepEqual(result, { a: 1 });
    });

    test('returns target when source is an array', () => {
      const loader = new TemplateLoader();
      const target = { a: 1 };
      const result = loader._deepMerge(target, [1, 2, 3]);
      assert.deepEqual(result, { a: 1 });
    });

    test('returns source when target is null', () => {
      const loader = new TemplateLoader();
      const source = { a: 1 };
      const result = loader._deepMerge(null, source);
      assert.deepEqual(result, { a: 1 });
    });

    test('returns source when target is an array', () => {
      const loader = new TemplateLoader();
      const source = { a: 1 };
      const result = loader._deepMerge([1, 2], source);
      assert.deepEqual(result, { a: 1 });
    });

    test('source null values override target', () => {
      const loader = new TemplateLoader();
      const result = loader._deepMerge({ a: 1, b: 2 }, { a: null });
      assert.equal(result.a, null);
      assert.equal(result.b, 2);
    });
  });

  // ---------------------------------------------------------------------------
  // _stripInternal
  // ---------------------------------------------------------------------------

  describe('_stripInternal', () => {
    test('removes keys starting with _', () => {
      const loader = new TemplateLoader();
      const result = loader._stripInternal({
        id: 'test',
        _filePath: '/some/path',
        _internal: true,
        name: 'Test',
      });

      assert.deepEqual(result, { id: 'test', name: 'Test' });
    });

    test('strips from nested objects', () => {
      const loader = new TemplateLoader();
      const result = loader._stripInternal({
        id: 'test',
        nested: {
          _hidden: true,
          visible: 'yes',
        },
      });

      assert.deepEqual(result, { id: 'test', nested: { visible: 'yes' } });
    });

    test('preserves arrays', () => {
      const loader = new TemplateLoader();
      const result = loader._stripInternal({
        tools: ['bash', 'git'],
        _filePath: '/path',
      });

      assert.deepEqual(result, { tools: ['bash', 'git'] });
    });

    test('returns non-objects as-is', () => {
      const loader = new TemplateLoader();
      assert.equal(loader._stripInternal(null), null);
      assert.equal(loader._stripInternal('string'), 'string');
      assert.deepEqual(loader._stripInternal([1, 2]), [1, 2]);
    });
  });

  // ---------------------------------------------------------------------------
  // Integration: loadTemplates + getTemplate + listTemplates + instantiateWorker
  // ---------------------------------------------------------------------------

  describe('full lifecycle', () => {
    test('load → list → get → instantiate', async () => {
      const mockFs = createMockFs(
        {
          [`${TEMPLATES_DIR}/backend-developer.yml`]: BACKEND_TEMPLATE,
          [`${TEMPLATES_DIR}/frontend-developer.yml`]: FRONTEND_TEMPLATE,
        },
        { directories: [TEMPLATES_DIR] }
      );

      const loader = new TemplateLoader({ fs: mockFs });

      // Load
      await loader.loadTemplates(TEMPLATES_DIR);

      // List
      const list = loader.listTemplates();
      assert.equal(list.length, 2);
      const ids = list.map(t => t.id).sort();
      assert.deepEqual(ids, ['backend-developer', 'frontend-developer']);

      // Get
      const backend = loader.getTemplate('backend-developer');
      assert.equal(backend.name, 'Backend Developer');
      assert.deepEqual(backend.tools, ['bash', 'git', 'python']);

      // Instantiate
      const worker = loader.instantiateWorker('frontend-developer', {
        deployment: { replicas: 2, server: 'vps-2' },
        id: 'my-frontend',
      });
      assert.equal(worker.id, 'my-frontend');
      assert.equal(worker.deployment.replicas, 2);
      assert.equal(worker.deployment.server, 'vps-2');
      assert.equal(worker.deployment.strategy, 'round-robin');
      assert.deepEqual(worker.tools, ['bash', 'git', 'npm']);
      assert.equal(worker._filePath, undefined); // stripped
    });
  });

  // ---------------------------------------------------------------------------
  // Integration with real templates on disk
  // ---------------------------------------------------------------------------

  describe('real templates directory', () => {
    test('loads actual templates/workers/ from project', async () => {
      const loader = new TemplateLoader();
      const templatesDir = new URL('../../../templates/workers', import.meta.url).pathname;

      await loader.loadTemplates(templatesDir);

      // Should have at least the 5 known templates
      assert.ok(
        loader.templates.size >= 5,
        `Expected at least 5 templates, got ${loader.templates.size}`
      );
      assert.ok(loader.templates.has('backend-developer'));
      assert.ok(loader.templates.has('frontend-developer'));
      assert.ok(loader.templates.has('devops-engineer'));
      assert.ok(loader.templates.has('data-scientist'));
      assert.ok(loader.templates.has('qa-engineer'));
    });

    test('all real templates have required fields', async () => {
      const loader = new TemplateLoader();
      const templatesDir = new URL('../../../templates/workers', import.meta.url).pathname;

      await loader.loadTemplates(templatesDir);

      for (const [id, tpl] of loader.templates) {
        assert.ok(tpl.id, `${id} should have id`);
        assert.ok(tpl.name, `${id} should have name`);
        assert.ok(tpl.description, `${id} should have description`);
        assert.ok(Array.isArray(tpl.tools), `${id} should have tools array`);
      }
    });

    test('instantiateWorker works with real templates', async () => {
      const loader = new TemplateLoader();
      const templatesDir = new URL('../../../templates/workers', import.meta.url).pathname;

      await loader.loadTemplates(templatesDir);

      const worker = loader.instantiateWorker('backend-developer', {
        id: 'my-custom-backend',
        deployment: { replicas: 5 },
      });

      assert.equal(worker.id, 'my-custom-backend');
      assert.equal(worker.deployment.replicas, 5);
      assert.equal(worker._filePath, undefined);
    });
  });
});
