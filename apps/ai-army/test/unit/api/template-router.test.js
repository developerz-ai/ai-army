/**
 * Unit tests for TemplateRouter
 *
 * Tests the template browsing and instantiation API endpoints:
 * - GET    /api/v1/templates               -> List all templates
 * - GET    /api/v1/templates/:type          -> Get template details
 * - POST   /api/v1/templates/instantiate    -> Create instance from template
 *
 * Also covers:
 * - Authentication (API key validation)
 * - Route matching (only handles /api/v1/templates paths)
 * - Error handling
 * - Constructor validation
 * - JSON body parsing for POST
 * - Search filtering
 * - Audit logging
 */

import { test, describe, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { TemplateRouter, TemplateRouterError } from '../../../src/api/routers/template-router.js';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock TemplateManager
 * @param {Object[]} [templates=[]] - Array of template objects
 * @param {Object[]} [instances=[]] - Array of instance objects
 * @returns {Object} Mock TemplateManager
 */
function createMockTemplateManager(templates = [], instances = []) {
  const templateMap = new Map(templates.map(t => [t.id, t]));
  const instanceMap = new Map(instances.map(i => [i.id, i]));

  return {
    listTemplates: mock.fn(async () => [...templateMap.values()]),
    getTemplate: mock.fn(async id => templateMap.get(id) || null),
    createTemplate: mock.fn(async config => {
      const t = {
        ...config,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      templateMap.set(t.id, t);
      return t;
    }),
    deleteTemplate: mock.fn(async id => templateMap.has(id)),
    createInstance: mock.fn(async (templateId, instanceConfig) => {
      const template = templateMap.get(templateId);
      if (!template) {
        throw new Error(`Template '${templateId}' not found`);
      }

      const existingInstance = instanceMap.get(instanceConfig.id);
      if (existingInstance) {
        throw new Error(`Instance '${instanceConfig.id}' already exists`);
      }

      return {
        id: instanceConfig.id,
        templateId,
        name: instanceConfig.name || instanceConfig.id,
        overrides: instanceConfig.overrides || {},
        status: 'stopped',
        resolvedConfig: { ...template.config, ...(instanceConfig.overrides || {}) },
        resolvedSoul: template.soulTemplate || null,
      };
    }),
    getInstance: mock.fn(async id => instanceMap.get(id) || null),
    listInstances: mock.fn(async () => [...instanceMap.values()]),
    updateInstanceStatus: mock.fn(async () => true),
    deleteInstance: mock.fn(async id => instanceMap.has(id)),
    resolveInstance: mock.fn(async id => {
      const instance = instanceMap.get(id);
      if (!instance) return null;
      const template = templateMap.get(instance.templateId);
      return {
        id: instance.id,
        templateId: instance.templateId,
        name: instance.name,
        status: instance.status,
        resolvedConfig: { ...template.config, ...(instance.overrides || {}) },
        resolvedSoul: template.soulTemplate || null,
      };
    }),
  };
}

/**
 * Create a mock HTTP request
 * @param {Object} options - Request options
 * @returns {Object} Mock request
 */
function createMockRequest({ method = 'GET', url = '/', headers = {}, body = null } = {}) {
  const readable = new Readable({ read() {} });
  readable.method = method;
  readable.url = url;
  readable.headers = {
    host: 'localhost:3000',
    ...headers,
  };
  readable.socket = { remoteAddress: '127.0.0.1' };

  if (body) {
    const json = JSON.stringify(body);
    process.nextTick(() => {
      readable.push(json);
      readable.push(null);
    });
  } else {
    process.nextTick(() => readable.push(null));
  }

  return readable;
}

/**
 * Create a mock HTTP response that captures output
 * @returns {{ res: Object, getResponse: () => { statusCode: number, headers: Object, body: Object }}}
 */
function createMockResponse() {
  let statusCode;
  let responseHeaders = {};
  const chunks = [];

  const res = {
    writeHead(code, hdrs) {
      statusCode = code;
      responseHeaders = hdrs;
    },
    end(data) {
      if (data) chunks.push(data);
    },
    headersSent: false,
  };

  return {
    res,
    getResponse() {
      const raw = chunks.join('');
      return {
        statusCode,
        headers: responseHeaders,
        body: raw ? JSON.parse(raw) : null,
      };
    },
  };
}

const sampleTemplates = [
  {
    id: 'support-bot',
    name: 'Customer Support Bot',
    description: 'A template for customer support bots with FAQ handling',
    config: {
      model: 'gpt-4',
      tools: ['faq-lookup', 'ticket-create'],
      variables: { companyName: '{{companyName}}' },
    },
    soulTemplate: 'You are a support agent for {{companyName}}.',
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
  },
  {
    id: 'sales-bot',
    name: 'Sales Assistant Bot',
    description: 'Template for sales outreach and lead qualification',
    config: {
      model: 'gpt-4',
      tools: ['crm-lookup', 'email-send'],
      variables: { territory: '{{territory}}' },
    },
    soulTemplate: 'You are a sales assistant covering {{territory}}.',
    version: 2,
    createdAt: '2026-01-15T00:00:00.000Z',
    updatedAt: '2026-02-05T00:00:00.000Z',
  },
  {
    id: 'devops-bot',
    name: 'DevOps Monitor Bot',
    description: null,
    config: {
      model: 'gpt-3.5-turbo',
      tools: ['log-query', 'alert-send'],
    },
    soulTemplate: null,
    version: 1,
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-10T00:00:00.000Z',
  },
];

// ============================================================================
// Tests
// ============================================================================

describe('TemplateRouter', () => {
  /** @type {Object} */
  let mockTemplateManager;
  /** @type {TemplateRouter} */
  let router;

  beforeEach(() => {
    mockTemplateManager = createMockTemplateManager(sampleTemplates);
    router = new TemplateRouter({ templateManager: mockTemplateManager });
  });

  // --------------------------------------------------------------------------
  // Constructor
  // --------------------------------------------------------------------------

  describe('constructor', () => {
    test('creates instance with templateManager', () => {
      const r = new TemplateRouter({ templateManager: mockTemplateManager });
      assert.equal(r.templateManager, mockTemplateManager);
    });

    test('throws without templateManager', () => {
      assert.throws(
        () => new TemplateRouter(),
        err => err instanceof TemplateRouterError && err.endpoint === 'constructor'
      );
    });

    test('throws with explicit null templateManager', () => {
      assert.throws(
        () => new TemplateRouter({ templateManager: null }),
        err => err instanceof TemplateRouterError
      );
    });

    test('accepts optional dependencies', () => {
      const logger = mock.fn();
      const auditLogger = { log: mock.fn(async () => {}) };
      const r = new TemplateRouter({
        templateManager: mockTemplateManager,
        logger,
        apiKey: 'test-key',
        auditLogger,
      });
      assert.equal(r.logger, logger);
      assert.equal(r.apiKey, 'test-key');
      assert.equal(r.auditLogger, auditLogger);
    });

    test('defaults logger to null', () => {
      const r = new TemplateRouter({ templateManager: mockTemplateManager });
      assert.equal(r.logger, null);
    });

    test('defaults apiKey to null', () => {
      const r = new TemplateRouter({ templateManager: mockTemplateManager });
      assert.equal(r.apiKey, null);
    });

    test('defaults auditLogger to null', () => {
      const r = new TemplateRouter({ templateManager: mockTemplateManager });
      assert.equal(r.auditLogger, null);
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/v1/templates
  // --------------------------------------------------------------------------

  describe('GET /api/v1/templates', () => {
    test('returns list of all templates', async () => {
      const req = createMockRequest({ method: 'GET', url: '/api/v1/templates' });
      const { res, getResponse } = createMockResponse();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.total, 3);
      assert.equal(response.body.templates.length, 3);
      assert.equal(response.body.templates[0].id, 'support-bot');
      assert.equal(response.body.templates[0].name, 'Customer Support Bot');
    });

    test('returns summary view without config/soul', async () => {
      const req = createMockRequest({ method: 'GET', url: '/api/v1/templates' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      const template = response.body.templates[0];
      // Summary should have these fields
      assert.ok('id' in template);
      assert.ok('name' in template);
      assert.ok('description' in template);
      assert.ok('version' in template);
      assert.ok('createdAt' in template);
      assert.ok('updatedAt' in template);
      // Summary should NOT have config/soul
      assert.equal(template.config, undefined);
      assert.equal(template.soulTemplate, undefined);
    });

    test('returns empty list when no templates', async () => {
      router = new TemplateRouter({
        templateManager: createMockTemplateManager([]),
      });
      const req = createMockRequest({ method: 'GET', url: '/api/v1/templates' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.total, 0);
      assert.deepEqual(response.body.templates, []);
    });

    test('filters by search on name', async () => {
      const req = createMockRequest({
        method: 'GET',
        url: '/api/v1/templates?search=support',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.total, 1);
      assert.equal(response.body.templates[0].id, 'support-bot');
    });

    test('filters by search on description', async () => {
      const req = createMockRequest({
        method: 'GET',
        url: '/api/v1/templates?search=lead%20qualification',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.total, 1);
      assert.equal(response.body.templates[0].id, 'sales-bot');
    });

    test('search is case-insensitive', async () => {
      const req = createMockRequest({
        method: 'GET',
        url: '/api/v1/templates?search=DEVOPS',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.total, 1);
      assert.equal(response.body.templates[0].id, 'devops-bot');
    });

    test('search returns empty when no match', async () => {
      const req = createMockRequest({
        method: 'GET',
        url: '/api/v1/templates?search=nonexistent',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.total, 0);
      assert.deepEqual(response.body.templates, []);
    });

    test('search handles templates with null description', async () => {
      const req = createMockRequest({
        method: 'GET',
        url: '/api/v1/templates?search=monitor',
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      // devops-bot has 'Monitor' in its name, null description
      assert.equal(response.body.total, 1);
      assert.equal(response.body.templates[0].id, 'devops-bot');
    });

    test('returns 500 when listTemplates fails', async () => {
      mockTemplateManager.listTemplates = mock.fn(async () => {
        throw new Error('Database unavailable');
      });
      router = new TemplateRouter({
        templateManager: mockTemplateManager,
        logger: mock.fn(),
      });

      const req = createMockRequest({ method: 'GET', url: '/api/v1/templates' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 500);
      assert.ok(response.body.message.includes('Database unavailable'));
    });
  });

  // --------------------------------------------------------------------------
  // GET /api/v1/templates/:type
  // --------------------------------------------------------------------------

  describe('GET /api/v1/templates/:type', () => {
    test('returns template details', async () => {
      const req = createMockRequest({ method: 'GET', url: '/api/v1/templates/support-bot' });
      const { res, getResponse } = createMockResponse();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.id, 'support-bot');
      assert.equal(response.body.name, 'Customer Support Bot');
      assert.equal(
        response.body.description,
        'A template for customer support bots with FAQ handling'
      );
      assert.deepEqual(response.body.config, sampleTemplates[0].config);
      assert.equal(response.body.soulTemplate, 'You are a support agent for {{companyName}}.');
      assert.equal(response.body.version, 1);
    });

    test('includes full config and soul template', async () => {
      const req = createMockRequest({ method: 'GET', url: '/api/v1/templates/sales-bot' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.ok(response.body.config);
      assert.equal(response.body.config.model, 'gpt-4');
      assert.deepEqual(response.body.config.tools, ['crm-lookup', 'email-send']);
      assert.ok(response.body.soulTemplate);
    });

    test('returns 404 for unknown template', async () => {
      const req = createMockRequest({ method: 'GET', url: '/api/v1/templates/unknown-bot' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 404);
      assert.equal(response.body.error, 'Not Found');
      assert.equal(response.body.code, 'TEMPLATE_NOT_FOUND');
      assert.equal(response.body.details.templateId, 'unknown-bot');
    });

    test('returns 500 when getTemplate throws', async () => {
      mockTemplateManager.getTemplate = mock.fn(async () => {
        throw new Error('DB read failed');
      });
      router = new TemplateRouter({
        templateManager: mockTemplateManager,
        logger: mock.fn(),
      });

      const req = createMockRequest({ method: 'GET', url: '/api/v1/templates/support-bot' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 500);
      assert.ok(response.body.message.includes('DB read failed'));
    });

    test('handles URL-encoded template IDs', async () => {
      const encoded = encodeURIComponent('support-bot');
      const req = createMockRequest({
        method: 'GET',
        url: `/api/v1/templates/${encoded}`,
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.id, 'support-bot');
    });
  });

  // --------------------------------------------------------------------------
  // POST /api/v1/templates/instantiate
  // --------------------------------------------------------------------------

  describe('POST /api/v1/templates/instantiate', () => {
    test('creates an instance from a template', async () => {
      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/templates/instantiate',
        headers: { 'content-type': 'application/json' },
        body: {
          templateId: 'support-bot',
          instanceId: 'acme-support',
          name: 'Acme Support Bot',
          overrides: {
            variables: { companyName: 'Acme Corp' },
          },
        },
      });
      const { res, getResponse } = createMockResponse();

      const handled = await router.handleRequest(req, res);

      assert.equal(handled, true);
      const response = getResponse();
      assert.equal(response.statusCode, 201);
      assert.equal(response.body.id, 'acme-support');
      assert.equal(response.body.templateId, 'support-bot');
      assert.equal(response.body.name, 'Acme Support Bot');
      assert.equal(response.body.status, 'stopped');
      assert.ok(response.body.resolvedConfig);
      assert.equal(mockTemplateManager.createInstance.mock.calls.length, 1);
    });

    test('creates instance with minimal fields', async () => {
      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/templates/instantiate',
        headers: { 'content-type': 'application/json' },
        body: {
          templateId: 'support-bot',
          instanceId: 'minimal-instance',
        },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 201);
      assert.equal(response.body.id, 'minimal-instance');
      assert.equal(response.body.templateId, 'support-bot');
    });

    test('returns 400 when templateId is missing', async () => {
      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/templates/instantiate',
        headers: { 'content-type': 'application/json' },
        body: { instanceId: 'no-template' },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.code, 'VALIDATION_ERROR');
      assert.ok(response.body.message.includes('templateId'));
    });

    test('returns 400 when instanceId is missing', async () => {
      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/templates/instantiate',
        headers: { 'content-type': 'application/json' },
        body: { templateId: 'support-bot' },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.code, 'VALIDATION_ERROR');
      assert.ok(response.body.message.includes('instanceId'));
    });

    test('returns 400 when templateId is not a string', async () => {
      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/templates/instantiate',
        headers: { 'content-type': 'application/json' },
        body: { templateId: 123, instanceId: 'bad-template-id' },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.code, 'VALIDATION_ERROR');
      assert.ok(response.body.message.includes('templateId'));
    });

    test('returns 400 when instanceId is not a string', async () => {
      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/templates/instantiate',
        headers: { 'content-type': 'application/json' },
        body: { templateId: 'support-bot', instanceId: 456 },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.code, 'VALIDATION_ERROR');
      assert.ok(response.body.message.includes('instanceId'));
    });

    test('returns 400 when overrides is not an object', async () => {
      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/templates/instantiate',
        headers: { 'content-type': 'application/json' },
        body: {
          templateId: 'support-bot',
          instanceId: 'bad-overrides',
          overrides: 'not-an-object',
        },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.code, 'VALIDATION_ERROR');
      assert.ok(response.body.message.includes('overrides'));
    });

    test('returns 400 when overrides is null', async () => {
      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/templates/instantiate',
        headers: { 'content-type': 'application/json' },
        body: {
          templateId: 'support-bot',
          instanceId: 'null-overrides',
          overrides: null,
        },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.code, 'VALIDATION_ERROR');
      assert.ok(response.body.message.includes('overrides'));
    });

    test('returns 404 when template not found', async () => {
      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/templates/instantiate',
        headers: { 'content-type': 'application/json' },
        body: {
          templateId: 'nonexistent-template',
          instanceId: 'some-instance',
        },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 404);
      assert.equal(response.body.code, 'TEMPLATE_NOT_FOUND');
      assert.equal(response.body.details.templateId, 'nonexistent-template');
    });

    test('returns 409 when instance already exists', async () => {
      // First call succeeds
      const req1 = createMockRequest({
        method: 'POST',
        url: '/api/v1/templates/instantiate',
        headers: { 'content-type': 'application/json' },
        body: {
          templateId: 'support-bot',
          instanceId: 'dup-instance',
        },
      });
      const { res: res1 } = createMockResponse();
      await router.handleRequest(req1, res1);

      // Second call with same instanceId
      mockTemplateManager.createInstance = mock.fn(async () => {
        throw new Error("Instance 'dup-instance' already exists");
      });
      router = new TemplateRouter({
        templateManager: mockTemplateManager,
        logger: mock.fn(),
      });

      const req2 = createMockRequest({
        method: 'POST',
        url: '/api/v1/templates/instantiate',
        headers: { 'content-type': 'application/json' },
        body: {
          templateId: 'support-bot',
          instanceId: 'dup-instance',
        },
      });
      const { res: res2, getResponse: getResponse2 } = createMockResponse();
      await router.handleRequest(req2, res2);

      const response = getResponse2();
      assert.equal(response.statusCode, 409);
      assert.equal(response.body.code, 'INSTANCE_ALREADY_EXISTS');
      assert.equal(response.body.details.instanceId, 'dup-instance');
    });

    test('returns 500 when createInstance throws unexpected error', async () => {
      mockTemplateManager.createInstance = mock.fn(async () => {
        throw new Error('Database write failed');
      });
      router = new TemplateRouter({
        templateManager: mockTemplateManager,
        logger: mock.fn(),
      });

      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/templates/instantiate',
        headers: { 'content-type': 'application/json' },
        body: {
          templateId: 'support-bot',
          instanceId: 'error-instance',
        },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 500);
      assert.equal(response.body.code, 'INSTANTIATION_FAILED');
    });

    test('passes overrides correctly to templateManager', async () => {
      const overrides = {
        variables: { companyName: 'Test Corp' },
        channels: ['slack'],
        model: 'gpt-4-turbo',
      };

      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/templates/instantiate',
        headers: { 'content-type': 'application/json' },
        body: {
          templateId: 'support-bot',
          instanceId: 'override-test',
          name: 'Override Test',
          overrides,
        },
      });
      const { res } = createMockResponse();

      await router.handleRequest(req, res);

      assert.equal(mockTemplateManager.createInstance.mock.calls.length, 1);
      const callArgs = mockTemplateManager.createInstance.mock.calls[0].arguments;
      assert.equal(callArgs[0], 'support-bot');
      assert.equal(callArgs[1].id, 'override-test');
      assert.equal(callArgs[1].name, 'Override Test');
      assert.deepEqual(callArgs[1].overrides, overrides);
    });
  });

  // --------------------------------------------------------------------------
  // Authentication
  // --------------------------------------------------------------------------

  describe('authentication', () => {
    test('rejects request when apiKey configured and no auth header', async () => {
      router = new TemplateRouter({
        templateManager: mockTemplateManager,
        apiKey: 'secret123',
      });
      const req = createMockRequest({ method: 'GET', url: '/api/v1/templates' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 401);
    });

    test('rejects request with wrong API key', async () => {
      router = new TemplateRouter({
        templateManager: mockTemplateManager,
        apiKey: 'secret123',
      });
      const req = createMockRequest({
        method: 'GET',
        url: '/api/v1/templates',
        headers: { authorization: 'Bearer wrong-key' },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 401);
    });

    test('allows request with correct API key', async () => {
      router = new TemplateRouter({
        templateManager: mockTemplateManager,
        apiKey: 'secret123',
      });
      const req = createMockRequest({
        method: 'GET',
        url: '/api/v1/templates',
        headers: { authorization: 'Bearer secret123' },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
    });

    test('allows all requests when no apiKey configured', async () => {
      const req = createMockRequest({ method: 'GET', url: '/api/v1/templates' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 200);
    });

    test('rejects non-Bearer auth schemes', async () => {
      router = new TemplateRouter({
        templateManager: mockTemplateManager,
        apiKey: 'secret123',
      });
      const req = createMockRequest({
        method: 'GET',
        url: '/api/v1/templates',
        headers: { authorization: 'Basic dXNlcjpwYXNz' },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 401);
    });
  });

  // --------------------------------------------------------------------------
  // Route matching
  // --------------------------------------------------------------------------

  describe('route matching', () => {
    test('returns false for non-matching paths', async () => {
      const req = createMockRequest({ method: 'GET', url: '/api/v1/workers' });
      const { res } = createMockResponse();

      const handled = await router.handleRequest(req, res);
      assert.equal(handled, false);
    });

    test('returns false for /api/v1/servers path', async () => {
      const req = createMockRequest({ method: 'GET', url: '/api/v1/servers' });
      const { res } = createMockResponse();

      const handled = await router.handleRequest(req, res);
      assert.equal(handled, false);
    });

    test('returns false for empty method', async () => {
      const req = createMockRequest({ method: '', url: '/api/v1/templates' });
      const { res } = createMockResponse();

      const handled = await router.handleRequest(req, res);
      assert.equal(handled, false);
    });

    test('returns false for PUT /api/v1/templates/:type (unregistered method)', async () => {
      const req = createMockRequest({
        method: 'PUT',
        url: '/api/v1/templates/support-bot',
      });
      const { res } = createMockResponse();

      const handled = await router.handleRequest(req, res);
      assert.equal(handled, false);
    });

    test('returns false for DELETE /api/v1/templates/:type (unregistered method)', async () => {
      const req = createMockRequest({
        method: 'DELETE',
        url: '/api/v1/templates/support-bot',
      });
      const { res } = createMockResponse();

      const handled = await router.handleRequest(req, res);
      assert.equal(handled, false);
    });

    test('handles malformed Host header gracefully', async () => {
      const req = createMockRequest({ method: 'GET', url: '/api/v1/templates' });
      req.headers.host = 'invalid host with spaces';
      const { res, getResponse } = createMockResponse();

      const handled = await router.handleRequest(req, res);
      assert.equal(handled, true);
      const response = getResponse();
      assert.equal(response.statusCode, 200);
    });

    test('POST /api/v1/templates/instantiate takes precedence over GET :type', async () => {
      // POST to /api/v1/templates/instantiate should NOT match GET :type
      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/templates/instantiate',
        headers: { 'content-type': 'application/json' },
        body: {
          templateId: 'support-bot',
          instanceId: 'route-test',
        },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      // Should be 201 (instantiate), not 200 (get template)
      assert.equal(response.statusCode, 201);
    });
  });

  // --------------------------------------------------------------------------
  // JSON body parsing
  // --------------------------------------------------------------------------

  describe('JSON body parsing', () => {
    test('returns 400 for invalid JSON body on POST', async () => {
      const readable = new Readable({ read() {} });
      readable.method = 'POST';
      readable.url = '/api/v1/templates/instantiate';
      readable.headers = { host: 'localhost:3000', 'content-type': 'application/json' };
      readable.socket = { remoteAddress: '127.0.0.1' };

      process.nextTick(() => {
        readable.push('not valid json{{{');
        readable.push(null);
      });

      const { res, getResponse } = createMockResponse();
      await router.handleRequest(readable, res);

      const response = getResponse();
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.error, 'Bad Request');
    });

    test('handles empty body as empty object', async () => {
      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/templates/instantiate',
        headers: { 'content-type': 'application/json' },
        // body: null -> empty body
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      // Should return 400 because templateId is missing, not crash
      assert.equal(response.statusCode, 400);
      assert.equal(response.body.code, 'VALIDATION_ERROR');
    });
  });

  // --------------------------------------------------------------------------
  // Audit logging
  // --------------------------------------------------------------------------

  describe('audit logging', () => {
    test('logs audit event on instantiate', async () => {
      const auditLogger = { log: mock.fn(async () => {}) };
      router = new TemplateRouter({
        templateManager: mockTemplateManager,
        auditLogger,
      });

      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/templates/instantiate',
        headers: { 'content-type': 'application/json' },
        body: {
          templateId: 'support-bot',
          instanceId: 'audited-instance',
          name: 'Audited Bot',
        },
      });
      const { res } = createMockResponse();

      await router.handleRequest(req, res);

      assert.equal(auditLogger.log.mock.calls.length, 1);
      const auditEvent = auditLogger.log.mock.calls[0].arguments[0];
      assert.equal(auditEvent.type, 'template.instantiated');
      assert.equal(auditEvent.resourceId, 'audited-instance');
      assert.equal(auditEvent.resourceType, 'template-instance');
      assert.equal(auditEvent.metadata.templateId, 'support-bot');
      assert.equal(auditEvent.metadata.name, 'Audited Bot');
    });

    test('does not log audit for read-only operations', async () => {
      const auditLogger = { log: mock.fn(async () => {}) };
      router = new TemplateRouter({
        templateManager: mockTemplateManager,
        auditLogger,
      });

      // GET list
      const req1 = createMockRequest({ method: 'GET', url: '/api/v1/templates' });
      const { res: res1 } = createMockResponse();
      await router.handleRequest(req1, res1);

      // GET details
      const req2 = createMockRequest({
        method: 'GET',
        url: '/api/v1/templates/support-bot',
      });
      const { res: res2 } = createMockResponse();
      await router.handleRequest(req2, res2);

      assert.equal(auditLogger.log.mock.calls.length, 0);
    });

    test('does not crash when auditLogger is not configured', async () => {
      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/templates/instantiate',
        headers: { 'content-type': 'application/json' },
        body: {
          templateId: 'support-bot',
          instanceId: 'no-audit-instance',
        },
      });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 201);
    });

    test('includes IP and user-agent in audit event', async () => {
      const auditLogger = { log: mock.fn(async () => {}) };
      router = new TemplateRouter({
        templateManager: mockTemplateManager,
        auditLogger,
      });

      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/templates/instantiate',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'TestClient/1.0',
          'x-forwarded-for': '10.0.0.1, 10.0.0.2',
        },
        body: {
          templateId: 'support-bot',
          instanceId: 'audit-meta-test',
        },
      });
      const { res } = createMockResponse();

      await router.handleRequest(req, res);

      const auditEvent = auditLogger.log.mock.calls[0].arguments[0];
      assert.equal(auditEvent.ipAddress, '10.0.0.1');
      assert.equal(auditEvent.userAgent, 'TestClient/1.0');
    });

    test('extracts actor from bearer token', async () => {
      const auditLogger = { log: mock.fn(async () => {}) };
      router = new TemplateRouter({
        templateManager: mockTemplateManager,
        auditLogger,
        apiKey: 'mysecretkey123',
      });

      const req = createMockRequest({
        method: 'POST',
        url: '/api/v1/templates/instantiate',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer mysecretkey123',
        },
        body: {
          templateId: 'support-bot',
          instanceId: 'actor-test',
        },
      });
      const { res } = createMockResponse();

      await router.handleRequest(req, res);

      const auditEvent = auditLogger.log.mock.calls[0].arguments[0];
      assert.equal(auditEvent.actor, 'api-key:mysecret***');
      assert.equal(auditEvent.actorType, 'api');
    });
  });

  // --------------------------------------------------------------------------
  // TemplateRouterError
  // --------------------------------------------------------------------------

  describe('TemplateRouterError', () => {
    test('creates error with correct name and fields', () => {
      const cause = new Error('root');
      const err = new TemplateRouterError('test error', {
        cause,
        endpoint: '/api/v1/templates',
        statusCode: 500,
      });
      assert.equal(err.name, 'TemplateRouterError');
      assert.equal(err.message, 'test error');
      assert.equal(err.endpoint, '/api/v1/templates');
      assert.equal(err.statusCode, 500);
      assert.equal(err.cause, cause);
    });

    test('creates error with defaults', () => {
      const err = new TemplateRouterError('simple error');
      assert.equal(err.name, 'TemplateRouterError');
      assert.equal(err.endpoint, undefined);
      assert.equal(err.statusCode, undefined);
    });
  });

  // --------------------------------------------------------------------------
  // Error handling in route handlers
  // --------------------------------------------------------------------------

  describe('error handling', () => {
    test('catches and returns 500 for unhandled handler errors', async () => {
      mockTemplateManager.listTemplates = mock.fn(async () => {
        throw new Error('Unexpected crash');
      });
      router = new TemplateRouter({
        templateManager: mockTemplateManager,
        logger: mock.fn(),
      });

      const req = createMockRequest({ method: 'GET', url: '/api/v1/templates' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 500);
      assert.ok(response.body.message.includes('Unexpected crash'));
    });

    test('handler error with statusCode uses that code via outer catch', async () => {
      // Override the handler to throw directly (bypassing inner try/catch)
      // This tests the outer catch path in handleRequest
      router._handleListTemplates = async () => {
        const err = new Error('Service unavailable');
        err.statusCode = 503;
        throw err;
      };

      const req = createMockRequest({ method: 'GET', url: '/api/v1/templates' });
      const { res, getResponse } = createMockResponse();

      await router.handleRequest(req, res);

      const response = getResponse();
      assert.equal(response.statusCode, 503);
      assert.ok(response.body.message.includes('Service unavailable'));
    });
  });
});
