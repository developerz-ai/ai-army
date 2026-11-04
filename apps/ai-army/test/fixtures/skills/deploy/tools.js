/**
 * Example skill tools for deploy skill (test fixture)
 */

export const deployTool = {
  description: 'Deploy application to an environment',
  parameters: {
    type: 'object',
    properties: {
      environment: { type: 'string', enum: ['staging', 'production'] },
      version: { type: 'string' },
    },
    required: ['environment', 'version'],
  },
  execute: async ({ environment, version }) => ({
    status: 'deployed',
    environment,
    version,
  }),
};

export const rollbackTool = {
  description: 'Rollback to a previous deployment version',
  parameters: {
    type: 'object',
    properties: {
      environment: { type: 'string' },
      version: { type: 'string' },
    },
    required: ['environment', 'version'],
  },
  execute: async ({ environment, version }) => ({
    status: 'rolled-back',
    environment,
    version,
  }),
};
