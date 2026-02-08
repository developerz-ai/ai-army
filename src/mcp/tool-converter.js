/**
 * Tool Converter - Convert MCP tools to Vercel AI SDK format
 *
 * Bridges MCP tool definitions (JSON Schema) to Vercel AI SDK `tool()` objects
 * with Zod parameter validation. Routes tool execution through the MCPClient
 * and parses MCP result content into plain-text responses.
 *
 * MCP tools use JSON Schema for their `inputSchema`, while the Vercel AI SDK
 * expects Zod schemas for `parameters`. This module handles that conversion
 * and wires up `execute()` to call the MCP server via the client.
 *
 * @module mcp/tool-converter
 */

import { tool } from 'ai';
import { z } from 'zod';

/**
 * Custom error class for tool conversion failures
 *
 * @example
 * throw new ToolConverterError('Unsupported JSON Schema type: "tuple"', {
 *   operation: 'convertSchema',
 *   toolName: 'list_repos',
 *   serverId: 'github',
 * });
 */
export class ToolConverterError extends Error {
  /**
   * Create a ToolConverterError
   *
   * @param {string} message - Error message
   * @param {Object} [options={}] - Error options
   * @param {Error} [options.cause] - Original error that caused this error
   * @param {string} [options.operation] - The operation that failed
   * @param {string} [options.toolName] - Name of the MCP tool involved
   * @param {string} [options.serverId] - ID of the MCP server involved
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'ToolConverterError';
    this.operation = options.operation;
    this.toolName = options.toolName;
    this.serverId = options.serverId;
  }
}

/**
 * Convert a JSON Schema type definition to a Zod schema
 *
 * Handles the core JSON Schema types: string, number, integer, boolean,
 * array, and object. Supports `enum`, `description`, `default`, `items`,
 * `properties`, and `required` keywords.
 *
 * @param {Object} schema - JSON Schema definition
 * @returns {import('zod').ZodTypeAny} Corresponding Zod schema
 */
export function jsonSchemaToZod(schema) {
  if (!schema || typeof schema !== 'object') {
    return z.unknown();
  }

  // Handle anyOf / oneOf by converting to z.union
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    const schemas = schema.anyOf.map(s => jsonSchemaToZod(s));
    if (schemas.length === 1) {
      return schemas[0];
    }
    return z.union(schemas);
  }

  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    const schemas = schema.oneOf.map(s => jsonSchemaToZod(s));
    if (schemas.length === 1) {
      return schemas[0];
    }
    return z.union(schemas);
  }

  let zodSchema;

  switch (schema.type) {
    case 'string': {
      zodSchema = schema.enum ? z.enum(schema.enum) : z.string();
      break;
    }

    case 'number': {
      zodSchema = z.number();
      break;
    }

    case 'integer': {
      zodSchema = z.number().int();
      break;
    }

    case 'boolean': {
      zodSchema = z.boolean();
      break;
    }

    case 'null': {
      zodSchema = z.null();
      break;
    }

    case 'array': {
      const itemSchema = schema.items ? jsonSchemaToZod(schema.items) : z.unknown();
      zodSchema = z.array(itemSchema);
      break;
    }

    case 'object': {
      zodSchema = convertObjectSchema(schema);
      break;
    }

    default: {
      // No type specified but has properties — treat as object
      if (schema.properties) {
        zodSchema = convertObjectSchema(schema);
      } else {
        zodSchema = z.unknown();
      }
    }
  }

  // Apply description if present
  if (schema.description && typeof zodSchema.describe === 'function') {
    zodSchema = zodSchema.describe(schema.description);
  }

  return zodSchema;
}

/**
 * Convert a JSON Schema object type to a Zod object schema
 *
 * Iterates over `properties`, recursively converting each to a Zod field.
 * Fields not listed in `required` are marked as `.optional()`.
 *
 * @param {Object} schema - JSON Schema with type 'object'
 * @returns {import('zod').ZodObject} Zod object schema
 */
function convertObjectSchema(schema) {
  const properties = schema.properties || {};
  const required = new Set(schema.required || []);
  const shape = {};

  for (const [key, propSchema] of Object.entries(properties)) {
    let fieldSchema = jsonSchemaToZod(propSchema);

    if (!required.has(key)) {
      fieldSchema = fieldSchema.optional();
    }

    shape[key] = fieldSchema;
  }

  return z.object(shape);
}

/**
 * Extract text content from an MCP result content array
 *
 * MCP tool results contain an array of content objects, each with a `type`
 * field. This extracts and joins all `text` content items.
 *
 * @param {Array<Object>} content - MCP content array
 * @returns {string} Combined text content
 */
function extractTextContent(content) {
  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .filter(item => item && item.type === 'text')
    .map(item => item.text)
    .join('\n');
}

/**
 * Parse an MCP tool result into a plain object suitable for the AI SDK
 *
 * Extracts text from MCP content array and returns it. If the result
 * contains an error, wraps it in an error-shaped response.
 *
 * @param {Object} result - Raw MCP tool call result
 * @returns {Object} Parsed result with text content
 */
function parseMCPResult(result) {
  if (!result || typeof result !== 'object') {
    return { content: '' };
  }

  const text = extractTextContent(result.content);

  if (result.isError) {
    return {
      error: true,
      content: text || 'Tool returned an error',
    };
  }

  return { content: text };
}

/**
 * Convert a single MCP tool definition to a Vercel AI SDK tool
 *
 * Takes an MCP tool (with JSON Schema `inputSchema`) and creates a Vercel AI
 * SDK `tool()` with Zod parameters and an `execute()` function that calls the
 * MCP server through the provided client.
 *
 * @param {Object} mcpTool - MCP tool definition from `listTools()`
 * @param {string} mcpTool.name - Tool name as reported by MCP server
 * @param {string} [mcpTool.description=''] - Tool description
 * @param {Object} [mcpTool.inputSchema] - JSON Schema for tool parameters
 * @param {string} serverId - Server ID for namespacing the tool name
 * @param {Object} mcpClient - MCPClient instance (or any object with `callTool()`)
 * @returns {Object} Object with `name` and Vercel AI SDK tool properties
 * @throws {ToolConverterError} If tool definition is invalid or conversion fails
 *
 * @example
 * const mcpTool = {
 *   name: 'list_repos',
 *   description: 'List GitHub repositories',
 *   inputSchema: {
 *     type: 'object',
 *     properties: {
 *       org: { type: 'string', description: 'Organization name' },
 *       limit: { type: 'number', description: 'Max results' },
 *     },
 *     required: ['org'],
 *   },
 * };
 * const result = convertMCPToolToAITool(mcpTool, 'github', mcpClient);
 * // result.name === 'github__list_repos'
 * // result.tool is a Vercel AI SDK tool object
 */
export function convertMCPToolToAITool(mcpTool, serverId, mcpClient) {
  if (!mcpTool || typeof mcpTool !== 'object') {
    throw new ToolConverterError('MCP tool definition must be a non-null object', {
      operation: 'convertMCPToolToAITool',
      serverId,
    });
  }

  if (!mcpTool.name || typeof mcpTool.name !== 'string') {
    throw new ToolConverterError('MCP tool must have a non-empty string "name"', {
      operation: 'convertMCPToolToAITool',
      serverId,
    });
  }

  if (!serverId || typeof serverId !== 'string') {
    throw new ToolConverterError('Server ID must be a non-empty string', {
      operation: 'convertMCPToolToAITool',
      toolName: mcpTool.name,
    });
  }

  if (!mcpClient || typeof mcpClient.callTool !== 'function') {
    throw new ToolConverterError('MCP client must have a callTool() method', {
      operation: 'convertMCPToolToAITool',
      toolName: mcpTool.name,
      serverId,
    });
  }

  const namespacedName = `${serverId}__${mcpTool.name}`;
  const description = mcpTool.description || `MCP tool: ${mcpTool.name}`;
  const originalToolName = mcpTool.name;

  // Convert inputSchema (JSON Schema) to Zod parameters
  let parameters;
  try {
    const inputSchema = mcpTool.inputSchema || { type: 'object', properties: {} };
    parameters = jsonSchemaToZod(inputSchema);
  } catch (err) {
    throw new ToolConverterError(
      `Failed to convert input schema for tool "${mcpTool.name}": ${err.message}`,
      {
        cause: err,
        operation: 'convertMCPToolToAITool',
        toolName: mcpTool.name,
        serverId,
      }
    );
  }

  // Create Vercel AI SDK tool with execute routed through MCPClient
  const aiTool = tool({
    description,
    parameters,
    execute: async params => {
      try {
        const result = await mcpClient.callTool(originalToolName, params);
        return parseMCPResult(result);
      } catch (err) {
        // Return error as result so the LLM can see it (don't throw)
        return {
          error: true,
          content: `MCP tool error: ${err.message}`,
        };
      }
    },
  });

  return {
    name: namespacedName,
    tool: aiTool,
  };
}

/**
 * Convert all MCP tools from a server to Vercel AI SDK tools
 *
 * Takes an array of MCP tool definitions (as returned by `MCPClient.listTools()`)
 * and converts each one to a Vercel AI SDK tool. Tool names are namespaced
 * as `{serverId}__{toolName}` to avoid collisions across servers.
 *
 * @param {Array<Object>} mcpTools - Array of MCP tool definitions
 * @param {string} serverId - Server ID for namespacing tool names
 * @param {Object} mcpClient - MCPClient instance for routing tool calls
 * @returns {Array<Object>} Array of `{ name, tool }` objects
 * @throws {ToolConverterError} If arguments are invalid
 *
 * @example
 * const mcpTools = await mcpClient.listTools();
 * const aiTools = convertMCPToolsToAITools(mcpTools, 'github', mcpClient);
 * // aiTools = [
 * //   { name: 'github__list_repos', tool: { description, parameters, execute } },
 * //   { name: 'github__create_issue', tool: { description, parameters, execute } },
 * // ]
 */
export function convertMCPToolsToAITools(mcpTools, serverId, mcpClient) {
  if (!Array.isArray(mcpTools)) {
    throw new ToolConverterError('mcpTools must be an array', {
      operation: 'convertMCPToolsToAITools',
      serverId,
    });
  }

  if (!serverId || typeof serverId !== 'string') {
    throw new ToolConverterError('Server ID must be a non-empty string', {
      operation: 'convertMCPToolsToAITools',
    });
  }

  if (!mcpClient || typeof mcpClient.callTool !== 'function') {
    throw new ToolConverterError('MCP client must have a callTool() method', {
      operation: 'convertMCPToolsToAITools',
      serverId,
    });
  }

  return mcpTools.map(mcpTool => convertMCPToolToAITool(mcpTool, serverId, mcpClient));
}

/**
 * Convert MCP tools to a flat object keyed by namespaced tool name
 *
 * Convenience function that returns an object suitable for spreading
 * directly into a Vercel AI SDK `generateText()` tools parameter.
 *
 * @param {Array<Object>} mcpTools - Array of MCP tool definitions
 * @param {string} serverId - Server ID for namespacing tool names
 * @param {Object} mcpClient - MCPClient instance for routing tool calls
 * @returns {Object} Object mapping namespaced tool names to AI SDK tools
 *
 * @example
 * const toolsMap = convertMCPToolsToToolMap(mcpTools, 'github', mcpClient);
 * const result = await generateText({
 *   model,
 *   messages,
 *   tools: { ...builtinTools, ...toolsMap },
 * });
 */
export function convertMCPToolsToToolMap(mcpTools, serverId, mcpClient) {
  const converted = convertMCPToolsToAITools(mcpTools, serverId, mcpClient);
  const toolMap = {};

  for (const { name, tool: aiTool } of converted) {
    toolMap[name] = aiTool;
  }

  return toolMap;
}
