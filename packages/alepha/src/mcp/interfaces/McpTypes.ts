import type { Async, Static, TObject, TSchema } from "alepha";

// ---------------------------------------------------------------------------------------------------------------------
// JSON-RPC 2.0 Types
// ---------------------------------------------------------------------------------------------------------------------

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

// ---------------------------------------------------------------------------------------------------------------------
// MCP Protocol Types
// ---------------------------------------------------------------------------------------------------------------------

export interface McpCapabilities {
  tools?: Record<string, never>;
  resources?: Record<string, never>;
  prompts?: Record<string, never>;
}

export interface McpServerInfo {
  name: string;
  version: string;
}

export interface McpClientInfo {
  name: string;
  version: string;
}

export interface McpInitializeParams {
  protocolVersion: string;
  capabilities: McpCapabilities;
  clientInfo: McpClientInfo;
}

export interface McpInitializeResult {
  protocolVersion: string;
  capabilities: McpCapabilities;
  serverInfo: McpServerInfo;
}

// ---------------------------------------------------------------------------------------------------------------------
// Tool Types
// ---------------------------------------------------------------------------------------------------------------------

export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: McpJsonSchema;
}

export interface McpJsonSchema {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
}

export interface McpToolCallParams {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface McpToolCallResult {
  content: McpContent[];
  isError?: boolean;
}

export interface McpContent {
  type: "text" | "image" | "resource";
  text?: string;
  data?: string;
  mimeType?: string;
}

// ---------------------------------------------------------------------------------------------------------------------
// Resource Types
// ---------------------------------------------------------------------------------------------------------------------

export interface McpResourceDescriptor {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpResourceReadParams {
  uri: string;
}

export interface McpResourceReadResult {
  contents: McpResourceContent[];
}

export interface McpResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}

// ---------------------------------------------------------------------------------------------------------------------
// Prompt Types
// ---------------------------------------------------------------------------------------------------------------------

export interface McpPromptDescriptor {
  name: string;
  description?: string;
  arguments?: McpPromptArgument[];
}

export interface McpPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface McpPromptGetParams {
  name: string;
  arguments?: Record<string, string>;
}

export interface McpPromptGetResult {
  description?: string;
  messages: McpPromptMessage[];
}

export interface McpPromptMessage {
  role: "user" | "assistant";
  content: McpPromptContent;
}

export interface McpPromptContent {
  type: "text" | "image" | "resource";
  text?: string;
  data?: string;
  mimeType?: string;
}

// ---------------------------------------------------------------------------------------------------------------------
// Primitive Schema Types
// ---------------------------------------------------------------------------------------------------------------------

export interface ToolPrimitiveSchema {
  params?: TObject;
  result?: TSchema;
}

export interface ResourcePrimitiveSchema {
  contents?: TSchema;
}

export interface PromptPrimitiveSchema {
  args?: TObject;
}

// ---------------------------------------------------------------------------------------------------------------------
// Context Types
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Context passed to MCP handlers from the transport layer.
 *
 * This allows tools, resources, and prompts to access request-level
 * information like headers for authentication.
 */
export interface McpContext<T = unknown> {
  /**
   * HTTP headers from the request (for SSE transport).
   */
  headers?: Record<string, string | string[] | undefined>;

  /**
   * Custom context data set by transport or middleware.
   * Can be used to pass authenticated user, project scope, etc.
   */
  data?: T;
}

// ---------------------------------------------------------------------------------------------------------------------
// Handler Types
// ---------------------------------------------------------------------------------------------------------------------

export type ToolHandler<T extends ToolPrimitiveSchema, TContext = unknown> = (
  args: ToolHandlerArgs<T, TContext>,
) => Async<ToolHandlerResult<T>>;

export interface ToolHandlerArgs<
  T extends ToolPrimitiveSchema,
  TContext = unknown,
> {
  params: T["params"] extends TObject
    ? Static<T["params"]>
    : Record<string, never>;
  context?: McpContext<TContext>;
}

export type ToolHandlerResult<T extends ToolPrimitiveSchema> =
  T["result"] extends TSchema ? Static<T["result"]> : unknown;

export type ResourceHandler<TContext = unknown> = (
  args: ResourceHandlerArgs<TContext>,
) => Async<ResourceContent>;

export interface ResourceHandlerArgs<TContext = unknown> {
  context?: McpContext<TContext>;
}

export interface ResourceContent {
  text?: string;
  blob?: Uint8Array;
}

export type PromptHandler<T extends TObject, TContext = unknown> = (
  args: PromptHandlerArgs<T, TContext>,
) => Async<PromptMessage[]>;

export interface PromptHandlerArgs<T extends TObject, TContext = unknown> {
  args: Static<T>;
  context?: McpContext<TContext>;
}

export interface PromptMessage {
  role: "user" | "assistant";
  content: string;
}
