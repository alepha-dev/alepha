import { $module } from "alepha";
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
  McpInvalidParamsError,
  McpMethodNotFoundError,
  McpPromptNotFoundError,
  McpResourceNotFoundError,
  McpToolNotFoundError,
  McpToolOutputError,
  McpUnauthorizedError,
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
  isNotification,
  isSupportedProtocolVersion,
  isValidJsonRpcRequest,
  JSONRPC_VERSION,
  JsonRpcErrorCodes,
  JsonRpcParseError,
  MCP_PROTOCOL_VERSION,
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
  // MCP protocol types
  McpCapabilities,
  McpClientInfo,
  McpCompletionArgument,
  McpCompletionRef,
  McpCompletionResult,
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
export const AlephaMcp = $module({
  name: "alepha.mcp",
  primitives: [$tool, $resource, $resourceTemplate, $prompt],
  services: [McpServerProvider],
  // Transports are opt-in — user wires the one(s) they need via alepha.with(StreamableHttpMcpTransport).
  variants: [StreamableHttpMcpTransport, StdioMcpTransport],
});
