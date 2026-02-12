/**
 * Unit tests for worker template YAML definitions
 *
 * Validates that all worker templates in templates/workers/ are:
 * - Valid YAML files
 * - Conforming to the WorkerConfigSchema
 * - Containing all required fields (id, name, description, expertise, tools, etc.)
 * - Internally consistent (unique IDs, proper types, meaningful defaults)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { ProjectValidator } from '../../../src/config/project-validator.js';

// =============================================================================
// Constants
// =============================================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.resolve(__dirname, '../../../templates/workers');

/**
 * All expected worker template files
 */
const EXPECTED_TEMPLATES = [
  'frontend-developer.yml',
  'backend-developer.yml',
  'devops-engineer.yml',
  'data-scientist.yml',
  'qa-engineer.yml',
];

/**
 * Required top-level fields per the implementation plan
 */
const REQUIRED_FIELDS = ['id', 'name', 'description', 'expertise', 'tools', 'resources'];

/**
 * Common tools expected in every worker template
 */
const COMMON_TOOLS = ['bash', 'git', 'readFile', 'writeFile'];

// =============================================================================
// Helpers
// =============================================================================

/**
 * Load and parse a single YAML template
 * @param {string} filename - Template filename
 * @returns {Promise<Object>} Parsed YAML content
 */
const loadTemplate = async filename => {
  const filePath = path.join(TEMPLATES_DIR, filename);
  const content = await fs.readFile(filePath, 'utf8');
  return yaml.load(content);
};

/**
 * Load all worker templates
 * @returns {Promise<Array<{filename: string, data: Object}>>}
 */
const loadAllTemplates = async () => {
  const templates = [];
  for (const filename of EXPECTED_TEMPLATES) {
    const data = await loadTemplate(filename);
    templates.push({ filename, data });
  }
  return templates;
};

// =============================================================================
// Tests
// =============================================================================

describe('Worker Template YAML Definitions', () => {
  // ---------------------------------------------------------------------------
  // File existence
  // ---------------------------------------------------------------------------

  describe('template files exist', () => {
    for (const filename of EXPECTED_TEMPLATES) {
      test(`${filename} exists and is readable`, async () => {
        const filePath = path.join(TEMPLATES_DIR, filename);
        const stat = await fs.stat(filePath);
        assert.ok(stat.isFile(), `${filename} should be a file`);
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Valid YAML parsing
  // ---------------------------------------------------------------------------

  describe('valid YAML syntax', () => {
    for (const filename of EXPECTED_TEMPLATES) {
      test(`${filename} parses as valid YAML`, async () => {
        const data = await loadTemplate(filename);
        assert.ok(data !== null && data !== undefined, 'YAML should parse to a truthy value');
        assert.equal(typeof data, 'object', 'YAML should parse to an object');
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Required fields present
  // ---------------------------------------------------------------------------

  describe('required fields', () => {
    for (const filename of EXPECTED_TEMPLATES) {
      test(`${filename} has all required fields`, async () => {
        const data = await loadTemplate(filename);
        for (const field of REQUIRED_FIELDS) {
          assert.ok(data[field] !== undefined, `${filename} is missing required field '${field}'`);
        }
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Schema validation (WorkerConfigSchema)
  // ---------------------------------------------------------------------------

  describe('WorkerConfigSchema validation', () => {
    const validator = new ProjectValidator();

    for (const filename of EXPECTED_TEMPLATES) {
      test(`${filename} passes WorkerConfigSchema validation`, async () => {
        const data = await loadTemplate(filename);
        const result = validator.validateWorkerConfig(data);
        assert.ok(result.valid, `${filename} failed validation: ${JSON.stringify(result.errors)}`);
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Field types
  // ---------------------------------------------------------------------------

  describe('field types', () => {
    for (const filename of EXPECTED_TEMPLATES) {
      test(`${filename} has correct field types`, async () => {
        const data = await loadTemplate(filename);

        assert.equal(typeof data.id, 'string', 'id should be a string');
        assert.equal(typeof data.name, 'string', 'name should be a string');
        assert.equal(typeof data.description, 'string', 'description should be a string');
        assert.ok(Array.isArray(data.tools), 'tools should be an array');
        assert.ok(Array.isArray(data.mcpServers), 'mcpServers should be an array');
        assert.equal(typeof data.resources, 'object', 'resources should be an object');
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Expertise field
  // ---------------------------------------------------------------------------

  describe('expertise content', () => {
    for (const filename of EXPECTED_TEMPLATES) {
      test(`${filename} has inline expertise string`, async () => {
        const data = await loadTemplate(filename);
        assert.equal(typeof data.expertise, 'string', 'expertise should be an inline string');
        assert.ok(data.expertise.length > 50, 'expertise should be a meaningful description');
      });
    }
  });

  // ---------------------------------------------------------------------------
  // ID matches filename
  // ---------------------------------------------------------------------------

  describe('id matches filename', () => {
    for (const filename of EXPECTED_TEMPLATES) {
      test(`${filename} id matches the filename`, async () => {
        const data = await loadTemplate(filename);
        const expectedId = filename.replace('.yml', '');
        assert.equal(data.id, expectedId, `id '${data.id}' should match filename '${expectedId}'`);
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Unique IDs
  // ---------------------------------------------------------------------------

  test('all templates have unique IDs', async () => {
    const templates = await loadAllTemplates();
    const ids = templates.map(t => t.data.id);
    const uniqueIds = new Set(ids);
    assert.equal(uniqueIds.size, ids.length, `Duplicate IDs found: ${ids.join(', ')}`);
  });

  // ---------------------------------------------------------------------------
  // Tools contain common tools
  // ---------------------------------------------------------------------------

  describe('common tools included', () => {
    for (const filename of EXPECTED_TEMPLATES) {
      test(`${filename} includes common tools (${COMMON_TOOLS.join(', ')})`, async () => {
        const data = await loadTemplate(filename);
        for (const tool of COMMON_TOOLS) {
          assert.ok(data.tools.includes(tool), `${filename} is missing common tool '${tool}'`);
        }
      });
    }
  });

  // ---------------------------------------------------------------------------
  // MCP servers
  // ---------------------------------------------------------------------------

  describe('mcpServers', () => {
    for (const filename of EXPECTED_TEMPLATES) {
      test(`${filename} has at least one MCP server`, async () => {
        const data = await loadTemplate(filename);
        assert.ok(data.mcpServers.length > 0, 'mcpServers should have at least one entry');
      });

      test(`${filename} mcpServers includes filesystem and github`, async () => {
        const data = await loadTemplate(filename);
        assert.ok(
          data.mcpServers.includes('filesystem'),
          `${filename} should include 'filesystem' MCP server`
        );
        assert.ok(
          data.mcpServers.includes('github'),
          `${filename} should include 'github' MCP server`
        );
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Resources
  // ---------------------------------------------------------------------------

  describe('resources', () => {
    for (const filename of EXPECTED_TEMPLATES) {
      test(`${filename} resources has cpu, memory, and storage`, async () => {
        const data = await loadTemplate(filename);
        assert.ok(data.resources.cpu, 'resources should have cpu');
        assert.ok(data.resources.memory, 'resources should have memory');
        assert.ok(data.resources.storage, 'resources should have storage');
      });

      test(`${filename} resources memory ends with Gi`, async () => {
        const data = await loadTemplate(filename);
        assert.match(data.resources.memory, /^\d+Gi$/, 'memory should be in Gi format');
      });

      test(`${filename} resources storage ends with Gi`, async () => {
        const data = await loadTemplate(filename);
        assert.match(data.resources.storage, /^\d+Gi$/, 'storage should be in Gi format');
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Container configuration
  // ---------------------------------------------------------------------------

  describe('container configuration', () => {
    for (const filename of EXPECTED_TEMPLATES) {
      test(`${filename} has container with image`, async () => {
        const data = await loadTemplate(filename);
        assert.ok(data.container, 'should have container config');
        assert.ok(data.container.image, 'container should have an image');
        assert.match(
          data.container.image,
          /^ai-army\//,
          'container image should use ai-army/ prefix'
        );
      });

      test(`${filename} container image matches id`, async () => {
        const data = await loadTemplate(filename);
        const expectedImage = `ai-army/${data.id}:latest`;
        assert.equal(
          data.container.image,
          expectedImage,
          `container image should be '${expectedImage}'`
        );
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Deployment settings
  // ---------------------------------------------------------------------------

  describe('deployment settings', () => {
    for (const filename of EXPECTED_TEMPLATES) {
      test(`${filename} has deployment with healthCheck`, async () => {
        const data = await loadTemplate(filename);
        assert.ok(data.deployment, 'should have deployment config');
        assert.ok(data.deployment.healthCheck, 'deployment should have healthCheck');
        assert.equal(typeof data.deployment.healthCheck.interval, 'number');
        assert.equal(typeof data.deployment.healthCheck.timeout, 'number');
        assert.equal(typeof data.deployment.healthCheck.retries, 'number');
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Enabled flag
  // ---------------------------------------------------------------------------

  describe('enabled flag', () => {
    for (const filename of EXPECTED_TEMPLATES) {
      test(`${filename} is enabled by default`, async () => {
        const data = await loadTemplate(filename);
        assert.equal(data.enabled, true, 'template should be enabled by default');
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Individual template specifics
  // ---------------------------------------------------------------------------

  describe('frontend-developer specifics', () => {
    test('has npm tool', async () => {
      const data = await loadTemplate('frontend-developer.yml');
      assert.ok(data.tools.includes('npm'), 'should include npm tool');
    });

    test('expertise mentions React', async () => {
      const data = await loadTemplate('frontend-developer.yml');
      assert.ok(data.expertise.includes('React'), 'expertise should mention React');
    });

    test('expertise mentions TypeScript', async () => {
      const data = await loadTemplate('frontend-developer.yml');
      assert.ok(data.expertise.includes('TypeScript'), 'expertise should mention TypeScript');
    });

    test('mcpServers includes npm', async () => {
      const data = await loadTemplate('frontend-developer.yml');
      assert.ok(data.mcpServers.includes('npm'), 'should include npm MCP server');
    });
  });

  describe('backend-developer specifics', () => {
    test('has python tool', async () => {
      const data = await loadTemplate('backend-developer.yml');
      assert.ok(data.tools.includes('python'), 'should include python tool');
    });

    test('has pip tool', async () => {
      const data = await loadTemplate('backend-developer.yml');
      assert.ok(data.tools.includes('pip'), 'should include pip tool');
    });

    test('expertise mentions Python 3.11', async () => {
      const data = await loadTemplate('backend-developer.yml');
      assert.ok(data.expertise.includes('Python 3.11'), 'expertise should mention Python 3.11');
    });

    test('expertise mentions FastAPI', async () => {
      const data = await loadTemplate('backend-developer.yml');
      assert.ok(data.expertise.includes('FastAPI'), 'expertise should mention FastAPI');
    });

    test('mcpServers includes postgres', async () => {
      const data = await loadTemplate('backend-developer.yml');
      assert.ok(data.mcpServers.includes('postgres'), 'should include postgres MCP server');
    });
  });

  describe('devops-engineer specifics', () => {
    test('has kubectl tool', async () => {
      const data = await loadTemplate('devops-engineer.yml');
      assert.ok(data.tools.includes('kubectl'), 'should include kubectl tool');
    });

    test('has terraform tool', async () => {
      const data = await loadTemplate('devops-engineer.yml');
      assert.ok(data.tools.includes('terraform'), 'should include terraform tool');
    });

    test('has docker tool', async () => {
      const data = await loadTemplate('devops-engineer.yml');
      assert.ok(data.tools.includes('docker'), 'should include docker tool');
    });

    test('expertise mentions Kubernetes', async () => {
      const data = await loadTemplate('devops-engineer.yml');
      assert.ok(data.expertise.includes('Kubernetes'), 'expertise should mention Kubernetes');
    });

    test('expertise mentions Terraform', async () => {
      const data = await loadTemplate('devops-engineer.yml');
      assert.ok(data.expertise.includes('Terraform'), 'expertise should mention Terraform');
    });
  });

  describe('data-scientist specifics', () => {
    test('has jupyter tool', async () => {
      const data = await loadTemplate('data-scientist.yml');
      assert.ok(data.tools.includes('jupyter'), 'should include jupyter tool');
    });

    test('has python tool', async () => {
      const data = await loadTemplate('data-scientist.yml');
      assert.ok(data.tools.includes('python'), 'should include python tool');
    });

    test('expertise mentions Pandas', async () => {
      const data = await loadTemplate('data-scientist.yml');
      assert.ok(data.expertise.includes('Pandas'), 'expertise should mention Pandas');
    });

    test('expertise mentions NumPy', async () => {
      const data = await loadTemplate('data-scientist.yml');
      assert.ok(data.expertise.includes('NumPy'), 'expertise should mention NumPy');
    });

    test('has higher resource limits', async () => {
      const data = await loadTemplate('data-scientist.yml');
      const cpuNum = parseInt(data.resources.cpu, 10);
      assert.ok(cpuNum >= 4, 'data-scientist should have at least 4 CPUs');
      const memNum = parseInt(data.resources.memory, 10);
      assert.ok(memNum >= 8, 'data-scientist should have at least 8Gi memory');
    });
  });

  describe('qa-engineer specifics', () => {
    test('has playwright tool', async () => {
      const data = await loadTemplate('qa-engineer.yml');
      assert.ok(data.tools.includes('playwright'), 'should include playwright tool');
    });

    test('has npm tool', async () => {
      const data = await loadTemplate('qa-engineer.yml');
      assert.ok(data.tools.includes('npm'), 'should include npm tool');
    });

    test('expertise mentions Playwright', async () => {
      const data = await loadTemplate('qa-engineer.yml');
      assert.ok(data.expertise.includes('Playwright'), 'expertise should mention Playwright');
    });

    test('expertise mentions testing', async () => {
      const data = await loadTemplate('qa-engineer.yml');
      assert.ok(data.expertise.toLowerCase().includes('test'), 'expertise should mention testing');
    });

    test('mcpServers includes playwright', async () => {
      const data = await loadTemplate('qa-engineer.yml');
      assert.ok(data.mcpServers.includes('playwright'), 'should include playwright MCP server');
    });
  });
});
