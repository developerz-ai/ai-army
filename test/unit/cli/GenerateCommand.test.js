/**
 * Unit tests for GenerateCommand
 *
 * Tests the generate command: worker generation with different types,
 * name validation, file existence checks, and template content.
 * Uses mock filesystem via dependency injection.
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  runGenerate,
  GenerateCommandError,
  loadWorkerTemplates,
  getFallbackPresets,
  generateWorkerYaml,
  generateExpertiseMd,
  formatName,
} from '../../../src/cli/GenerateCommand.js';

/**
 * Create a mock filesystem for testing
 * @param {Object} [options={}] - Options
 * @param {Set<string>} [options.existingFiles=new Set()] - Paths that already exist
 * @param {boolean} [options.writeShouldFail=false] - Whether writeFile should fail
 * @returns {Object} Mock fs module
 */
function createMockFs(options = {}) {
  const { existingFiles = new Set(), writeShouldFail = false, templateFiles = [] } = options;
  const writtenFiles = new Map();

  // Template YAML content for different worker types
  const templateContent = {
    'default.yml': `id: default
name: Default Worker
description: A general-purpose worker
container:
  image: ai-army/worker:latest
  cpus: 2
  memory: '4g'
tools:
  - bash
  - git
  - readFile
  - writeFile
deployment:
  replicas: 1
`,
    'gpu.yml': `id: gpu
name: GPU Worker
description: A GPU-accelerated worker for ML/AI tasks
container:
  image: ai-army/worker-gpu:latest
  cpus: 4
  memory: '16g'
tools:
  - bash
  - git
deployment:
  replicas: 1
`,
    'lightweight.yml': `id: lightweight
name: Lightweight Worker
description: A lightweight worker for simple tasks
container:
  image: ai-army/worker:latest
  cpus: 1
  memory: '1g'
tools:
  - bash
  - readFile
deployment:
  replicas: 1
`,
    'backend-developer.yml': `id: backend-developer
name: Backend Developer
description: A backend developer
container:
  image: ai-army/backend:latest
  cpus: 2
  memory: '4g'
tools:
  - bash
  - git
expertise: |
  You are a backend developer.
deployment:
  replicas: 1
`,
  };

  return {
    writtenFiles,
    access: mock.fn(async filePath => {
      if (!existingFiles.has(filePath)) {
        const err = new Error(`ENOENT: no such file or directory, access '${filePath}'`);
        err.code = 'ENOENT';
        throw err;
      }
    }),
    mkdir: mock.fn(async () => {}),
    writeFile: mock.fn(async (filePath, content) => {
      if (writeShouldFail) {
        throw new Error('Permission denied');
      }
      writtenFiles.set(filePath, content);
    }),
    readdir: mock.fn(async () => {
      if (templateFiles.length === 0) {
        // Default: return all template files
        return Object.keys(templateContent);
      }
      return templateFiles;
    }),
    readFile: mock.fn(async filePath => {
      const filename = filePath.split('/').pop();
      if (templateContent[filename]) {
        return templateContent[filename];
      }
      throw new Error('File not found');
    }),
  };
}

/**
 * Create a mock writable output stream
 * @returns {Object} Mock output with write() and captured lines
 */
function createMockOutput() {
  const lines = [];
  return {
    lines,
    write: mock.fn(msg => {
      lines.push(msg);
      return true;
    }),
  };
}

describe('GenerateCommand', () => {
  let mockFs;
  let mockOutput;

  beforeEach(() => {
    mockFs = createMockFs();
    mockOutput = createMockOutput();
  });

  // ============================================================================
  // generate worker
  // ============================================================================

  describe('generate worker', () => {
    test('creates worker YAML and expertise markdown files', async () => {
      const result = await runGenerate('worker', {
        name: 'my-worker',
        output: mockOutput,
        fs: mockFs,
      });

      assert.equal(result.success, true);
      assert.equal(result.name, 'my-worker');
      assert.equal(result.type, 'default');
      assert.ok(result.files.worker);
      assert.ok(result.files.expertise);

      // Verify files were written
      assert.equal(mockFs.writtenFiles.size, 2);
    });

    test('writes correct worker YAML content', async () => {
      await runGenerate('worker', {
        name: 'code-reviewer',
        type: 'default',
        output: mockOutput,
        fs: mockFs,
      });

      const workerContent = [...mockFs.writtenFiles.values()][0];
      assert.match(workerContent, /id: code-reviewer/);
      assert.match(workerContent, /name: Code Reviewer/);
      assert.match(workerContent, /expertise\/code-reviewer\.md/);
      assert.match(workerContent, /ai-army\/worker:latest/);
    });

    test('writes correct expertise markdown content', async () => {
      await runGenerate('worker', {
        name: 'code-reviewer',
        output: mockOutput,
        fs: mockFs,
      });

      const expertiseContent = [...mockFs.writtenFiles.values()][1];
      assert.match(expertiseContent, /# Code Reviewer/);
      assert.match(expertiseContent, /AI worker running inside the AI Army/);
      assert.match(expertiseContent, /Guidelines/);
      assert.match(expertiseContent, /Constraints/);
    });

    test('ensures directories exist before writing', async () => {
      await runGenerate('worker', {
        name: 'my-worker',
        output: mockOutput,
        fs: mockFs,
      });

      assert.equal(mockFs.mkdir.mock.calls.length, 2);
      // First call for workers dir
      assert.match(mockFs.mkdir.mock.calls[0].arguments[0], /workers/);
      // Second call for expertise dir
      assert.match(mockFs.mkdir.mock.calls[1].arguments[0], /expertise/);
    });

    test('uses recursive mkdir', async () => {
      await runGenerate('worker', {
        name: 'my-worker',
        output: mockOutput,
        fs: mockFs,
      });

      assert.deepEqual(mockFs.mkdir.mock.calls[0].arguments[1], { recursive: true });
    });

    test('writes success output with next steps', async () => {
      await runGenerate('worker', {
        name: 'my-worker',
        output: mockOutput,
        fs: mockFs,
      });

      const output = mockOutput.lines.join('');
      assert.match(output, /Generated worker 'my-worker'/);
      assert.match(output, /workers\/my-worker\.yml/);
      assert.match(output, /expertise\/my-worker\.md/);
      assert.match(output, /Next steps/);
      assert.match(output, /ai-army\.yml/);
      assert.match(output, /validate/);
    });

    test('uses project path for file locations', async () => {
      await runGenerate('worker', {
        name: 'my-worker',
        projectPath: '/my/project',
        output: mockOutput,
        fs: mockFs,
      });

      const workerPath = [...mockFs.writtenFiles.keys()][0];
      assert.match(workerPath, /\/my\/project\/workers\/my-worker\.yml/);
    });
  });

  // ============================================================================
  // worker types
  // ============================================================================

  describe('worker types', () => {
    test('uses default type when not specified', async () => {
      const result = await runGenerate('worker', {
        name: 'my-worker',
        output: mockOutput,
        fs: mockFs,
      });

      assert.equal(result.type, 'default');
    });

    test('generates gpu worker', async () => {
      await runGenerate('worker', {
        name: 'ml-worker',
        type: 'gpu',
        output: mockOutput,
        fs: mockFs,
      });

      const workerContent = [...mockFs.writtenFiles.values()][0];
      assert.match(workerContent, /ai-army\/worker-gpu:latest/);
      assert.match(workerContent, /cpus: 4/);
      assert.match(workerContent, /memory: '16g'/);

      const output = mockOutput.lines.join('');
      assert.match(output, /type: gpu/);
    });

    test('generates lightweight worker', async () => {
      await runGenerate('worker', {
        name: 'simple-worker',
        type: 'lightweight',
        output: mockOutput,
        fs: mockFs,
      });

      const workerContent = [...mockFs.writtenFiles.values()][0];
      assert.match(workerContent, /cpus: 1/);
      assert.match(workerContent, /memory: '1g'/);
    });

    test('rejects invalid worker type', async () => {
      await assert.rejects(
        () =>
          runGenerate('worker', {
            name: 'my-worker',
            type: 'super-heavy',
            output: mockOutput,
            fs: mockFs,
          }),
        err => {
          assert.equal(err.name, 'GenerateCommandError');
          assert.match(err.message, /Invalid worker type 'super-heavy'/);
          assert.match(err.message, /Valid types/);
          return true;
        }
      );
    });
  });

  // ============================================================================
  // name validation
  // ============================================================================

  describe('name validation', () => {
    test('accepts valid kebab-case names', async () => {
      const result = await runGenerate('worker', {
        name: 'my-cool-worker-2',
        output: mockOutput,
        fs: mockFs,
      });

      assert.equal(result.success, true);
    });

    test('accepts single-word names', async () => {
      const result = await runGenerate('worker', {
        name: 'worker',
        output: mockOutput,
        fs: mockFs,
      });

      assert.equal(result.success, true);
    });

    test('rejects names starting with numbers', async () => {
      await assert.rejects(
        () =>
          runGenerate('worker', {
            name: '2bad',
            output: mockOutput,
            fs: mockFs,
          }),
        err => {
          assert.equal(err.name, 'GenerateCommandError');
          assert.match(err.message, /Invalid worker name/);
          return true;
        }
      );
    });

    test('rejects names with uppercase letters', async () => {
      await assert.rejects(
        () =>
          runGenerate('worker', {
            name: 'MyWorker',
            output: mockOutput,
            fs: mockFs,
          }),
        err => {
          assert.match(err.message, /Invalid worker name/);
          assert.match(err.message, /kebab-case/);
          return true;
        }
      );
    });

    test('rejects names with spaces', async () => {
      await assert.rejects(
        () =>
          runGenerate('worker', {
            name: 'my worker',
            output: mockOutput,
            fs: mockFs,
          }),
        err => {
          assert.match(err.message, /Invalid worker name/);
          return true;
        }
      );
    });

    test('rejects names with underscores', async () => {
      await assert.rejects(
        () =>
          runGenerate('worker', {
            name: 'my_worker',
            output: mockOutput,
            fs: mockFs,
          }),
        err => {
          assert.match(err.message, /Invalid worker name/);
          return true;
        }
      );
    });

    test('throws when name is missing', async () => {
      await assert.rejects(
        () =>
          runGenerate('worker', {
            output: mockOutput,
            fs: mockFs,
          }),
        err => {
          assert.equal(err.name, 'GenerateCommandError');
          assert.match(err.message, /Worker name is required/);
          assert.equal(err.operation, 'worker');
          return true;
        }
      );
    });
  });

  // ============================================================================
  // file existence checks
  // ============================================================================

  describe('file existence checks', () => {
    test('rejects when worker file already exists', async () => {
      const fsWithExisting = createMockFs({
        existingFiles: new Set([`${process.cwd()}/workers/existing-worker.yml`]),
      });

      await assert.rejects(
        () =>
          runGenerate('worker', {
            name: 'existing-worker',
            output: mockOutput,
            fs: fsWithExisting,
          }),
        err => {
          assert.equal(err.name, 'GenerateCommandError');
          assert.match(err.message, /already exists.*workers\/existing-worker\.yml/);
          return true;
        }
      );
    });

    test('rejects when expertise file already exists', async () => {
      const fsWithExisting = createMockFs({
        existingFiles: new Set([`${process.cwd()}/expertise/existing-worker.md`]),
      });

      await assert.rejects(
        () =>
          runGenerate('worker', {
            name: 'existing-worker',
            output: mockOutput,
            fs: fsWithExisting,
          }),
        err => {
          assert.equal(err.name, 'GenerateCommandError');
          assert.match(err.message, /already exists.*expertise\/existing-worker\.md/);
          return true;
        }
      );
    });

    test('does not write any files when worker exists', async () => {
      const fsWithExisting = createMockFs({
        existingFiles: new Set([`${process.cwd()}/workers/existing-worker.yml`]),
      });

      try {
        await runGenerate('worker', {
          name: 'existing-worker',
          output: mockOutput,
          fs: fsWithExisting,
        });
      } catch (_err) {
        // Expected
      }

      assert.equal(fsWithExisting.writeFile.mock.calls.length, 0);
    });
  });

  // ============================================================================
  // write failures
  // ============================================================================

  describe('write failures', () => {
    test('throws when file writing fails', async () => {
      const failingFs = createMockFs({ writeShouldFail: true });

      await assert.rejects(
        () =>
          runGenerate('worker', {
            name: 'fail-worker',
            output: mockOutput,
            fs: failingFs,
          }),
        err => {
          assert.equal(err.name, 'GenerateCommandError');
          assert.match(err.message, /Failed to write files/);
          assert.ok(err.cause);
          return true;
        }
      );
    });
  });

  // ============================================================================
  // unknown resource type
  // ============================================================================

  describe('unknown resource', () => {
    test('throws for unknown resource type', async () => {
      await assert.rejects(
        () =>
          runGenerate('database', {
            name: 'my-db',
            output: mockOutput,
            fs: mockFs,
          }),
        err => {
          assert.equal(err.name, 'GenerateCommandError');
          assert.match(err.message, /Unknown resource type: 'database'/);
          assert.match(err.message, /Valid types: worker/);
          return true;
        }
      );
    });
  });
});

// =============================================================================
// Exported helpers
// =============================================================================

describe('GenerateCommand helpers', () => {
  describe('formatName', () => {
    test('converts kebab-case to title case', () => {
      assert.equal(formatName('my-worker'), 'My Worker');
    });

    test('handles single word', () => {
      assert.equal(formatName('worker'), 'Worker');
    });

    test('handles multiple dashes', () => {
      assert.equal(formatName('my-super-cool-worker'), 'My Super Cool Worker');
    });
  });

  describe('generateWorkerYaml', () => {
    const mockTemplate = {
      id: 'test',
      description: 'A test worker',
      container: { image: 'ai-army/worker:latest', cpus: 2, memory: '4g' },
      tools: ['bash', 'git', 'readFile', 'writeFile'],
      deployment: { replicas: 1, strategy: 'round-robin', healthCheck: { interval: 30 } },
    };

    test('includes worker id', () => {
      const yaml = generateWorkerYaml('test-worker', mockTemplate);
      assert.match(yaml, /id: test-worker/);
    });

    test('includes expertise file reference', () => {
      const yaml = generateWorkerYaml('test-worker', mockTemplate);
      assert.match(yaml, /file: expertise\/test-worker\.md/);
    });

    test('includes container config from template', () => {
      const template = {
        ...mockTemplate,
        container: { image: 'ai-army/worker-gpu:latest', cpus: 4, memory: '16g' },
      };
      const yaml = generateWorkerYaml('gpu-worker', template);
      assert.match(yaml, /ai-army\/worker-gpu:latest/);
      assert.match(yaml, /cpus: 4/);
    });

    test('includes tools from template', () => {
      const yaml = generateWorkerYaml('test-worker', mockTemplate);
      assert.match(yaml, /- bash/);
      assert.match(yaml, /- git/);
      assert.match(yaml, /- readFile/);
      assert.match(yaml, /- writeFile/);
    });

    test('includes deployment section', () => {
      const yaml = generateWorkerYaml('test-worker', mockTemplate);
      assert.match(yaml, /deployment:/);
      assert.match(yaml, /strategy: round-robin/);
      assert.match(yaml, /healthCheck:/);
    });
  });

  describe('generateExpertiseMd', () => {
    const mockTemplate = {
      id: 'test',
      description: 'A general worker',
      container: { image: 'ai-army/worker:latest', cpus: 2, memory: '4g' },
      tools: ['bash'],
      deployment: { replicas: 1 },
    };

    test('includes formatted name', () => {
      const md = generateExpertiseMd('code-reviewer', mockTemplate);
      assert.match(md, /# Code Reviewer/);
    });

    test('uses inline expertise if provided', () => {
      const template = { ...mockTemplate, expertise: 'You are a GPU-accelerated worker' };
      const md = generateExpertiseMd('ml-worker', template);
      assert.match(md, /GPU-accelerated/);
    });

    test('includes guidelines section when no inline expertise', () => {
      const md = generateExpertiseMd('test-worker', mockTemplate);
      assert.match(md, /## Guidelines/);
      assert.match(md, /Be thorough/);
    });

    test('includes constraints section', () => {
      const md = generateExpertiseMd('test-worker', mockTemplate);
      assert.match(md, /## Constraints/);
      assert.match(md, /secrets/);
    });
  });

  describe('loadWorkerTemplates', () => {
    test('loads templates from filesystem', async () => {
      const mockFs = createMockFs({
        templateFiles: ['backend-developer.yml'],
      });
      const templates = await loadWorkerTemplates(mockFs);
      assert.ok(templates['backend-developer']);
      assert.equal(templates['backend-developer'].id, 'backend-developer');
    });

    test('returns fallback presets when templates dir not found', async () => {
      const mockFs = createMockFs({
        templateFiles: [], // Will trigger ENOENT
      });
      const templates = await loadWorkerTemplates(mockFs);
      assert.ok(templates.default);
      assert.ok(templates.default.description);
    });

    test('each template has required fields', async () => {
      const mockFs = createMockFs({
        templateFiles: ['backend-developer.yml'],
      });
      const templates = await loadWorkerTemplates(mockFs);
      for (const [type, template] of Object.entries(templates)) {
        assert.ok(template.description, `${type} should have description`);
        assert.ok(template.container, `${type} should have container`);
        assert.ok(template.container.image, `${type} should have container.image`);
      }
    });
  });

  describe('getFallbackPresets', () => {
    test('returns default preset', () => {
      const presets = getFallbackPresets();
      assert.ok(presets.default);
      assert.equal(presets.default.id, 'default');
      assert.ok(presets.default.description);
      assert.ok(presets.default.container);
      assert.ok(presets.default.tools);
    });
  });
});

// =============================================================================
// GenerateCommandError
// =============================================================================

describe('GenerateCommandError', () => {
  test('is an instance of Error', () => {
    const error = new GenerateCommandError('Test error');
    assert.ok(error instanceof Error);
  });

  test('has correct name', () => {
    const error = new GenerateCommandError('Test error');
    assert.equal(error.name, 'GenerateCommandError');
  });

  test('stores operation', () => {
    const error = new GenerateCommandError('Test', { operation: 'worker' });
    assert.equal(error.operation, 'worker');
  });

  test('stores resourceName', () => {
    const error = new GenerateCommandError('Test', { resourceName: 'my-worker' });
    assert.equal(error.resourceName, 'my-worker');
  });

  test('stores cause', () => {
    const cause = new Error('Original');
    const error = new GenerateCommandError('Test', { cause });
    assert.equal(error.cause, cause);
  });

  test('has correct message', () => {
    const error = new GenerateCommandError('Something went wrong');
    assert.equal(error.message, 'Something went wrong');
  });
});
