import { $module } from "alepha";
import { $prompt } from "./primitives/$prompt.ts";
import { $resource } from "./primitives/$resource.ts";
import { $tool } from "./primitives/$tool.ts";
import { McpServerProvider } from "./providers/McpServerProvider.ts";
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
export type { PromptPrimitiveOptions } from "./primitives/$prompt.ts";
export { $prompt, PromptPrimitive } from "./primitives/$prompt.ts";
export type { ResourcePrimitiveOptions } from "./primitives/$resource.ts";
export { $resource, ResourcePrimitive } from "./primitives/$resource.ts";
export type { ToolPrimitiveOptions } from "./primitives/$tool.ts";
export { $tool, ToolPrimitive } from "./primitives/$tool.ts";
export { McpServerProvider } from "./providers/McpServerProvider.ts";
export {
  mcpSseOptions,
  mcpStreamableHttpOptions,
  SseMcpTransport,
  StreamableHttpMcpTransport,
} from "./transports/StreamableHttpMcpTransport.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Model Context Protocol for AI tool integration.
 *
 * **Features:**
 * - MCP resource definitions
 * - MCP tool definitions
 * - MCP prompt definitions
 * - JSON-RPC protocol
 * - Streamable HTTP transport (spec 2025-03-26+)
 *
 * @module alepha.mcp
 */
export const AlephaMcp = $module({
  name: "alepha.mcp",
  primitives: [$tool, $resource, $prompt],
  services: [McpServerProvider],
  // Transports are opt-in — user wires the one(s) they need via alepha.with(StreamableHttpMcpTransport).
  variants: [StreamableHttpMcpTransport],
});
