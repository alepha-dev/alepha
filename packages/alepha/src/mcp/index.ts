import { $module } from "alepha";
import { $mcpAuth } from "./primitives/$mcpAuth.ts";
import { $prompt } from "./primitives/$prompt.ts";
import { $resource } from "./primitives/$resource.ts";
import { $tool } from "./primitives/$tool.ts";
import { McpAuthProvider } from "./providers/McpAuthProvider.ts";
import { McpServerProvider } from "./providers/McpServerProvider.ts";
import { OAuthClientService } from "./services/OAuthClientService.ts";
import { SseMcpTransport } from "./transports/SseMcpTransport.ts";
import { StdioMcpTransport } from "./transports/StdioMcpTransport.ts";

// ---------------------------------------------------------------------------------------------------------------------

export type { OAuthClientEntity } from "./entities/oauthClients.ts";
export { oauthClients } from "./entities/oauthClients.ts";
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
  isValidJsonRpcRequest,
  JSONRPC_VERSION,
  JsonRpcErrorCodes,
  JsonRpcParseError,
  MCP_PROTOCOL_VERSION,
  parseMessage,
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
export type {
  McpAuthContext,
  McpAuthPrimitiveOptions,
} from "./primitives/$mcpAuth.ts";
export { $mcpAuth, McpAuthPrimitive } from "./primitives/$mcpAuth.ts";
export type { PromptPrimitiveOptions } from "./primitives/$prompt.ts";
export { $prompt, PromptPrimitive } from "./primitives/$prompt.ts";
export type { ResourcePrimitiveOptions } from "./primitives/$resource.ts";
export { $resource, ResourcePrimitive } from "./primitives/$resource.ts";
export type { ToolPrimitiveOptions } from "./primitives/$tool.ts";
export { $tool, ToolPrimitive } from "./primitives/$tool.ts";
export type { McpAuthProviderConfig } from "./providers/McpAuthProvider.ts";
export { McpAuthProvider } from "./providers/McpAuthProvider.ts";
export { McpServerProvider } from "./providers/McpServerProvider.ts";
export { OAuthClientService } from "./services/OAuthClientService.ts";
export { SseMcpTransport } from "./transports/SseMcpTransport.ts";
export { StdioMcpTransport } from "./transports/StdioMcpTransport.ts";

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
 *
 * @module alepha.mcp
 */
export const AlephaMcp = $module({
  name: "alepha.mcp",
  primitives: [$tool, $resource, $prompt, $mcpAuth],
  services: [
    McpAuthProvider,
    McpServerProvider,
    OAuthClientService,
    SseMcpTransport,
    StdioMcpTransport,
  ],
  register: (alepha) => {
    alepha.with(McpAuthProvider);
    alepha.with(McpServerProvider);
    alepha.with(OAuthClientService);
  },
});
