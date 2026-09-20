import { $module } from "alepha";

import type { McpContext } from "./interfaces/McpTypes.ts";
import { $prompt } from "./primitives/$prompt.ts";
import { $resource } from "./primitives/$resource.ts";
import { $resourceTemplate } from "./primitives/$resourceTemplate.ts";
import { $tool } from "./primitives/$tool.ts";
import { McpServerProvider } from "./providers/McpServerProvider.ts";
import { StdioMcpTransport } from "./transports/StdioMcpTransport.ts";
import { StreamableHttpMcpTransport } from "./transports/StreamableHttpMcpTransport.ts";

// ---------------------------------------------------------------------------------------------------------------------

export {
  McpError,
  McpErrorCodes,
  McpForbiddenError,
  McpHeaderMismatchError,
  McpInvalidParamsError,
  McpMethodNotFoundError,
  McpPromptNotFoundError,
  McpResourceNotFoundError,
  McpToolNotFoundError,
  McpToolOutputError,
  McpUnauthorizedError,
  McpUnsupportedProtocolVersionError,
} from "./errors/McpError.ts";
export {
  createErrorResponse,
  createInternalError,
  createInvalidParamsError,
  createInvalidRequestError,
  createMethodNotFoundError,
  createNotification,
  createParseError,
  createResponse,
  isLegacyProtocolVersion,
  isNotification,
  isSupportedProtocolVersion,
  isValidJsonRpcRequest,
  JSONRPC_VERSION,
  JsonRpcErrorCodes,
  JsonRpcParseError,
  LEGACY_PROTOCOL_VERSIONS,
  MCP_LEGACY_PROTOCOL_VERSION,
  MCP_PROTOCOL_VERSION,
  McpProtocolErrorCodes,
  MODERN_PROTOCOL_VERSIONS,
  parseMessage,
  SUPPORTED_PROTOCOL_VERSIONS,
  type SupportedProtocolVersion,
} from "./helpers/jsonrpc.ts";
export type {
  // Completion types
  CompletionHandler,
  CompletionHandlerArgs,
  JsonRpcError,
  JsonRpcNotification,
  // JSON-RPC types
  JsonRpcRequest,
  JsonRpcResponse,
  McpAnnotations,
  McpCacheHints,
  McpCacheScope,
  // MCP protocol types
  McpCapabilities,
  McpClientInfo,
  McpCompletionArgument,
  McpCompletionRef,
  McpCompletionResult,
  McpContent,
  // Context type for auth/headers
  McpContext,
  McpDiscoverResult,
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
  McpRequestMeta,
  McpResourceContent,
  // Resource types
  McpResourceDescriptor,
  McpResourceReadParams,
  McpResourceReadResult,
  McpResourceTemplateDescriptor,
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
export type { PromptPrimitiveOptions } from "./primitives/$prompt.ts";
export { $prompt, PromptPrimitive } from "./primitives/$prompt.ts";
export type { ResourcePrimitiveOptions } from "./primitives/$resource.ts";
export { $resource, ResourcePrimitive } from "./primitives/$resource.ts";
export type {
  ResourceTemplateHandlerArgs,
  ResourceTemplatePrimitiveOptions,
} from "./primitives/$resourceTemplate.ts";
export {
  $resourceTemplate,
  ResourceTemplatePrimitive,
} from "./primitives/$resourceTemplate.ts";
export type { ToolPrimitiveOptions } from "./primitives/$tool.ts";
export { $tool, ToolPrimitive } from "./primitives/$tool.ts";
export { McpServerProvider } from "./providers/McpServerProvider.ts";
export { StdioMcpTransport } from "./transports/StdioMcpTransport.ts";
export {
  mcpSseOptions,
  mcpStreamableHttpOptions,
  StreamableHttpMcpTransport,
} from "./transports/StreamableHttpMcpTransport.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Model Context Protocol for AI tool integration.
 *
 * **Features:**
 * - MCP resource definitions (fixed URIs and RFC 6570 templates)
 * - MCP tool definitions
 * - MCP prompt definitions
 * - JSON-RPC protocol
 * - Streamable HTTP transport (spec 2025-03-26+)
 * - stdio transport (local servers: Claude Desktop, Claude Code)
 *
 * @module alepha.mcp
 */
declare module "alepha" {
  interface Hooks {
    /**
     * A `tools/call` finished, however it finished.
     *
     * Emitted once per call by {@link McpServerProvider}, after the result is
     * in hand and before it reaches the caller, so an application can count
     * what its MCP surface is actually asked for. A tool call leaves no trace
     * anywhere else: a write may end up in an audit log, but a READ passes
     * through and vanishes, and reads are most of the traffic on a server
     * whose primary consumer is an agent.
     *
     * `outcome` keeps the two failure kinds apart, because they mean
     * different things to whoever wrote the tool. `refused` is the server
     * working - a schema the arguments did not satisfy, a row that is not
     * there, a caller who may not - and points at a description or a schema
     * that misleads the model. `error` is a fault. It is the same split
     * `handleToolsCall` already makes when it decides between `log.warn` and
     * `log.error`.
     *
     * `name` is what the client asked for, whether or not a tool by that
     * name is registered: a client calling something that does not exist is
     * worth seeing, and dropping it would hide exactly that.
     *
     * ⚠️ A subscriber must not throw and must not be slow. This is awaited
     * inside the call, so it is in front of the caller's answer.
     */
    "mcp:tool:end": {
      name: string;
      outcome: "ok" | "refused" | "error";
      context?: McpContext;
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export const AlephaMcp = $module({
  name: "alepha.mcp",
  primitives: [$tool, $resource, $resourceTemplate, $prompt],
  services: [McpServerProvider],
  // Transports are opt-in — user wires the one(s) they need via alepha.with(StreamableHttpMcpTransport).
  variants: [StreamableHttpMcpTransport, StdioMcpTransport],
});
