import { $module } from "alepha";
import { $prompt } from "./primitives/$prompt.ts";
import { $resource } from "./primitives/$resource.ts";
import { $tool } from "./primitives/$tool.ts";
import { McpServerProvider } from "./providers/McpServerProvider.ts";
import { SseMcpTransport } from "./transports/SseMcpTransport.ts";
import { StdioMcpTransport } from "./transports/StdioMcpTransport.ts";

// ---------------------------------------------------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------------------------------------------------

export type { PromptPrimitiveOptions } from "./primitives/$prompt.ts";
export { $prompt, PromptPrimitive } from "./primitives/$prompt.ts";
export type { ResourcePrimitiveOptions } from "./primitives/$resource.ts";
export { $resource, ResourcePrimitive } from "./primitives/$resource.ts";
export type { ToolPrimitiveOptions } from "./primitives/$tool.ts";
export { $tool, ToolPrimitive } from "./primitives/$tool.ts";

// ---------------------------------------------------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------------------------------------------------

export { McpServerProvider } from "./providers/McpServerProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------------------------------------------------

export { SseMcpTransport } from "./transports/SseMcpTransport.ts";
export { StdioMcpTransport } from "./transports/StdioMcpTransport.ts";

// ---------------------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------------------

export {
  createErrorResponse,
  createInternalError,
  createInvalidParamsError,
  createInvalidRequestError,
  createMethodNotFoundError,
  createNotification,
  createParseError,
  createResponse,
  isNotification,
  isValidJsonRpcRequest,
  JSONRPC_VERSION,
  JsonRpcErrorCodes,
  JsonRpcParseError,
  MCP_PROTOCOL_VERSION,
  parseMessage,
} from "./helpers/jsonrpc.ts";

// ---------------------------------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------------------------------

export {
  McpError,
  McpInvalidParamsError,
  McpMethodNotFoundError,
  McpPromptNotFoundError,
  McpResourceNotFoundError,
  McpToolNotFoundError,
} from "./errors/McpError.ts";

// ---------------------------------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------------------------------

export type {
  JsonRpcError,
  JsonRpcNotification,
  // JSON-RPC types
  JsonRpcRequest,
  JsonRpcResponse,
  // MCP protocol types
  McpCapabilities,
  McpClientInfo,
  McpContent,
  // Context type for auth/headers
  McpContext,
  McpInitializeParams,
  McpInitializeResult,
  McpJsonSchema,
  McpPromptArgument,
  McpPromptContent,
  // Prompt types
  McpPromptDescriptor,
  McpPromptGetParams,
  McpPromptGetResult,
  McpPromptMessage,
  McpResourceContent,
  // Resource types
  McpResourceDescriptor,
  McpResourceReadParams,
  McpResourceReadResult,
  McpServerInfo,
  McpToolCallParams,
  McpToolCallResult,
  // Tool types
  McpToolDescriptor,
  PromptHandler,
  PromptHandlerArgs,
  PromptMessage,
  ResourceContent,
  ResourceHandler,
  ResourceHandlerArgs,
  ToolHandler,
  ToolHandlerArgs,
  ToolHandlerResult,
  // Handler types
  ToolPrimitiveSchema,
} from "./interfaces/McpTypes.ts";

// ---------------------------------------------------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Core MCP module with primitives and server provider.
 *
 * This module registers the $tool, $resource, and $prompt primitives
 * and the McpServerProvider. You need to add a transport module
 * (AlephaMcpStdio or AlephaMcpSse) for actual communication.
 *
 * @example
 * ```ts
 * import { Alepha, run } from "alepha";
 * import { AlephaMcp, AlephaMcpStdio, $tool, t } from "alepha/mcp";
 *
 * class MyMcpServer {
 *   add = $tool({
 *     description: "Add two numbers",
 *     schema: {
 *       params: t.object({ a: t.number(), b: t.number() }),
 *       result: t.number(),
 *     },
 *     handler: async ({ params }) => params.a + params.b,
 *   });
 * }
 *
 * run(
 *   Alepha.create()
 *     .with(AlephaMcp)
 *     .with(AlephaMcpStdio)
 *     .with(MyMcpServer)
 * );
 * ```
 */
export const AlephaMcp = $module({
  name: "alepha.mcp",
  primitives: [$tool, $resource, $prompt],
  services: [McpServerProvider],
});

/**
 * Stdio transport module for MCP.
 *
 * Use this for local MCP servers that communicate via stdin/stdout.
 * This is the standard transport for CLI-based MCP servers.
 */
export const AlephaMcpStdio = $module({
  name: "alepha.mcp.stdio",
  services: [StdioMcpTransport],
});

/**
 * SSE transport module for MCP.
 *
 * Use this for HTTP-based MCP servers that communicate via
 * Server-Sent Events (SSE) for server-to-client messages
 * and POST requests for client-to-server messages.
 *
 * Requires the AlephaServer module.
 */
export const AlephaMcpSse = $module({
  name: "alepha.mcp.sse",
  services: [SseMcpTransport],
});
