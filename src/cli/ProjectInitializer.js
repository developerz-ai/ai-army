/**
 * ProjectInitializer - Initialize new AI Army projects from templates
 *
 * Handles:
 * - Creating the full directory structure for a new project
 * - Writing template files (config.json, docker-compose.yml, etc.)
 * - Generating .env.example with required environment variables
 * - Writing helper files (CLAUDE.md and AGENT.md) for AI agent users
 *
 * All methods are static since no instance state is needed.
 * Users call `ProjectInitializer.initialize(path)` to scaffold a project.
 *
 * @module cli/ProjectInitializer
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * Custom error for project initialization failures
 */
export class ProjectInitializerError extends Error {
  /**
   * Create a ProjectInitializerError
   * @param {string} message - Error message
   * @param {Object} [options] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.targetPath] - Path where initialization was attempted
   * @param {string} [options.template] - Template name that was used
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'ProjectInitializerError';
    this.targetPath = options.targetPath;
    this.template = options.template;
  }
}

/**
 * Directories created for every new project
 * @type {string[]}
 */
const PROJECT_DIRECTORIES = ['bots', 'bots/assistant', 'data', 'migrations', 'skills'];

/**
 * Project initializer for scaffolding new AI Army projects
 *
 * Creates a complete project structure with configuration files,
 * example bot, and helper documentation for AI coding assistants.
 */
export class ProjectInitializer {
  /**
   * Initialize a new AI Army project at the given path
   *
   * Creates the full project structure including directories,
   * configuration files, example bot, and helper documentation.
   *
   * @param {string} targetPath - Directory to create the project in
   * @param {string} [template='basic'] - Template to use (currently only 'basic')
   * @returns {Promise<void>}
   * @throws {ProjectInitializerError} If targetPath is invalid or initialization fails
   */
  static async initialize(targetPath, template = 'basic') {
    if (!targetPath || typeof targetPath !== 'string') {
      throw new ProjectInitializerError('Target path must be a non-empty string', { targetPath });
    }

    if (typeof template !== 'string' || !template.trim()) {
      throw new ProjectInitializerError('Template must be a non-empty string', {
        targetPath,
        template,
      });
    }

    const resolved = path.resolve(targetPath);

    try {
      // Ensure the target directory exists
      await fs.mkdir(resolved, { recursive: true });

      // Create subdirectory structure
      await ProjectInitializer.createDirectoryStructure(resolved);

      // Write template config files
      await ProjectInitializer.writeTemplateFiles(resolved, template);

      // Generate .env.example
      await ProjectInitializer.generateEnvExample(resolved);

      // Write CLAUDE.md and AGENT.md
      await ProjectInitializer.writeHelperFiles(resolved);
    } catch (err) {
      if (err instanceof ProjectInitializerError) {
        throw err;
      }
      throw new ProjectInitializerError(
        `Failed to initialize project at ${resolved}: ${err.message}`,
        { cause: err, targetPath: resolved, template }
      );
    }
  }

  /**
   * Create the directory structure for a new project
   *
   * Creates: bots/, bots/assistant/, data/, migrations/, skills/
   *
   * @param {string} basePath - Absolute path to the project root
   * @returns {Promise<void>}
   * @throws {ProjectInitializerError} If basePath is invalid or directories cannot be created
   */
  static async createDirectoryStructure(basePath) {
    if (!basePath || typeof basePath !== 'string') {
      throw new ProjectInitializerError('Base path must be a non-empty string', {
        targetPath: basePath,
      });
    }

    for (const dir of PROJECT_DIRECTORIES) {
      const dirPath = path.join(basePath, dir);
      try {
        await fs.mkdir(dirPath, { recursive: true });
      } catch (err) {
        throw new ProjectInitializerError(`Failed to create directory ${dir}: ${err.message}`, {
          cause: err,
          targetPath: basePath,
        });
      }
    }
  }

  /**
   * Write template configuration files to the project
   *
   * Creates: package.json, config.json, docker-compose.yml,
   * .gitignore, README.md, bots/assistant/config.json, bots/assistant/soul.md
   *
   * @param {string} basePath - Absolute path to the project root
   * @param {string} [template='basic'] - Template name (currently only 'basic')
   * @returns {Promise<void>}
   * @throws {ProjectInitializerError} If files cannot be written
   */
  static async writeTemplateFiles(basePath, template = 'basic') {
    if (!basePath || typeof basePath !== 'string') {
      throw new ProjectInitializerError('Base path must be a non-empty string', {
        targetPath: basePath,
      });
    }

    const projectName = path.basename(basePath);
    const files = ProjectInitializer._getTemplateFiles(projectName, template);

    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = path.join(basePath, relativePath);
      const fileDir = path.dirname(filePath);

      try {
        await fs.mkdir(fileDir, { recursive: true });
        await fs.writeFile(filePath, content, 'utf8');
      } catch (err) {
        throw new ProjectInitializerError(
          `Failed to write template file ${relativePath}: ${err.message}`,
          { cause: err, targetPath: basePath, template }
        );
      }
    }
  }

  /**
   * Generate .env.example file with required environment variables
   *
   * Lists all environment variables the project needs with descriptions.
   *
   * @param {string} basePath - Absolute path to the project root
   * @returns {Promise<void>}
   * @throws {ProjectInitializerError} If the file cannot be written
   */
  static async generateEnvExample(basePath) {
    if (!basePath || typeof basePath !== 'string') {
      throw new ProjectInitializerError('Base path must be a non-empty string', {
        targetPath: basePath,
      });
    }

    const content = [
      '# AI Army - Environment Variables',
      '# Copy this file to .env and fill in your values',
      '',
      '# === AI Provider API Keys ===',
      '# At least one provider is required',
      'ANTHROPIC_API_KEY=',
      'OPENAI_API_KEY=',
      '',
      '# === Database ===',
      'DATABASE_URL=postgresql://localhost:5432/ai_army',
      '',
      '# === Slack (optional) ===',
      'SLACK_BOT_TOKEN=',
      'SLACK_APP_TOKEN=',
      '',
      '# === Discord (optional) ===',
      'DISCORD_BOT_TOKEN=',
      '',
      '# === MCP Servers (optional) ===',
      'GITHUB_TOKEN=',
      '',
    ].join('\n');

    const filePath = path.join(basePath, '.env.example');

    try {
      await fs.writeFile(filePath, content, 'utf8');
    } catch (err) {
      throw new ProjectInitializerError(`Failed to write .env.example: ${err.message}`, {
        cause: err,
        targetPath: basePath,
      });
    }
  }

  /**
   * Write helper files for AI coding assistants (CLAUDE.md and AGENT.md)
   *
   * CLAUDE.md provides Claude Code-specific instructions for working
   * with the project. AGENT.md provides generic AI agent instructions.
   *
   * @param {string} basePath - Absolute path to the project root
   * @returns {Promise<void>}
   * @throws {ProjectInitializerError} If files cannot be written
   */
  static async writeHelperFiles(basePath) {
    if (!basePath || typeof basePath !== 'string') {
      throw new ProjectInitializerError('Base path must be a non-empty string', {
        targetPath: basePath,
      });
    }

    const claudeMd = ProjectInitializer._getClaudeMdContent();
    const agentMd = ProjectInitializer._getAgentMdContent();

    try {
      await fs.writeFile(path.join(basePath, 'CLAUDE.md'), claudeMd, 'utf8');
      await fs.writeFile(path.join(basePath, 'AGENT.md'), agentMd, 'utf8');
    } catch (err) {
      throw new ProjectInitializerError(`Failed to write helper files: ${err.message}`, {
        cause: err,
        targetPath: basePath,
      });
    }
  }

  /**
   * Get template file contents for a given project name and template
   * @param {string} projectName - Name of the project directory
   * @param {string} _template - Template name (reserved for future use)
   * @returns {Object<string, string>} Map of relative path to file content
   * @private
   */
  static _getTemplateFiles(projectName, _template) {
    return {
      'package.json': `${JSON.stringify(
        {
          name: projectName,
          version: '1.0.0',
          description: 'My AI Army project',
          type: 'module',
          scripts: {
            start: 'npx ai-army start',
            dev: 'npx ai-army dev',
            validate: 'npx ai-army validate',
            migrate: 'npx ai-army migrate',
          },
          dependencies: {
            'ai-army': '^0.1.0',
          },
        },
        null,
        2
      )}\n`,

      'config.json': `${JSON.stringify(
        {
          defaults: {
            model: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
            sandbox: { type: 'incus', image: 'ai-army-base' },
          },
          providers: {
            anthropic: {
              type: 'anthropic',
              apiKey: '${ANTHROPIC_API_KEY}',
            },
          },
          channels: {},
          mcpServers: {},
        },
        null,
        2
      )}\n`,

      'docker-compose.yml': [
        'version: "3.8"',
        '',
        'services:',
        '  postgres:',
        '    image: postgres:16',
        '    environment:',
        '      POSTGRES_DB: ai_army',
        '      POSTGRES_USER: ai_army',
        '      POSTGRES_PASSWORD: ai_army_dev',
        '    ports:',
        '      - "5432:5432"',
        '    volumes:',
        '      - pgdata:/var/lib/postgresql/data',
        '',
        'volumes:',
        '  pgdata:',
        '',
      ].join('\n'),

      '.gitignore': ['node_modules/', '.env', 'data/', '*.log', '.DS_Store', ''].join('\n'),

      'README.md': [
        `# ${projectName}`,
        '',
        'An AI Army project powered by the [ai-army](https://github.com/developerz-ai/ai-army) framework.',
        '',
        '## Quick Start',
        '',
        '```bash',
        'npm install',
        'npx ai-army validate',
        'docker-compose up -d',
        'npx ai-army migrate',
        'npx ai-army start',
        '```',
        '',
        '## Bots',
        '',
        '- **assistant** - A general-purpose AI assistant',
        '',
        '## Documentation',
        '',
        'See the [ai-army documentation](https://github.com/developerz-ai/ai-army) for guides.',
        '',
      ].join('\n'),

      'bots/assistant/config.json': `${JSON.stringify(
        {
          id: 'assistant',
          soul: './soul.md',
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          tools: ['bash', 'readFile', 'writeFile'],
        },
        null,
        2
      )}\n`,

      'bots/assistant/soul.md': [
        '# Assistant',
        '',
        'You are a helpful AI assistant.',
        '',
        '## Core Values',
        '',
        '- Be accurate and helpful',
        '- Ask for clarification when needed',
        '- Provide clear, actionable responses',
        '',
        '## Capabilities',
        '',
        '- Answer questions',
        '- Help with code and technical tasks',
        '- Execute bash commands when needed',
        '',
      ].join('\n'),
    };
  }

  /**
   * Get CLAUDE.md template content
   * @returns {string} CLAUDE.md content
   * @private
   */
  static _getClaudeMdContent() {
    return [
      '# AI Army Project',
      '',
      'Use Claude Code to build and deploy your bot army.',
      '',
      '## Quick Start',
      '',
      '```bash',
      'npm install',
      'npx ai-army validate',
      'docker-compose up -d',
      '```',
      '',
      '## Create New Bot',
      '',
      'Ask Claude: "Create a new bot called \'my-bot\' that helps with..."',
      '',
      'Claude will:',
      '1. Create bots/my-bot/ directory',
      '2. Write config.json',
      '3. Write soul.md personality',
      '4. Update config.json to include it',
      '5. Validate and reload',
      '',
      '## Common Tasks',
      '',
      '- "Add a new tool to support-bot"',
      '- "Update the personality of work-bot"',
      '- "Fix the error in bot-manager"',
      '- "Add tests for SessionManager"',
      '',
    ].join('\n');
  }

  /**
   * Get AGENT.md template content
   * @returns {string} AGENT.md content
   * @private
   */
  static _getAgentMdContent() {
    return [
      '# Building Your AI Army',
      '',
      'This project uses the ai-army framework. Each bot is independent with its own:',
      '- Personality (soul.md)',
      '- Workspace (persistent directory)',
      '- Tools (bash, files, web search)',
      '- Channel (Slack, Discord, REST)',
      '',
      '## Architecture',
      '',
      '- src/core/ - Orchestration',
      '- src/adapters/ - Channels, secrets, storage',
      '- src/execution/ - Container management',
      '- bots/*/ - Your bot definitions',
      '',
      '## Conventions',
      '',
      '- One bot = one directory in bots/',
      '- Each bot has config.json + soul.md',
      '- All configs use ${ENV_VAR} for secrets',
      '- Sessions stored in PostgreSQL',
      '',
      '## Testing',
      '',
      '```bash',
      'npm run test:unit        # Fast unit tests',
      'npm run test:integration # With containers/DB',
      'npm test                 # All tests',
      '```',
      '',
    ].join('\n');
  }
}

export default ProjectInitializer;
