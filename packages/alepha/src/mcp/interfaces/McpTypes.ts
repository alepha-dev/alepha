import type { Async, Infer, ZObject, ZType } from "alepha";

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
  /**
   * `null` when the request id could not be determined — JSON-RPC requires it
   * for an unparseable message.
   */
  id: string | number | null;
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

/**
 * Spec 2025-11-25: optional `description` aligns with the MCP registry's
 * `server.json` format and provides human-readable context during init.
 */
export interface McpServerInfo {
  name: string;
  version: string;
  description?: string;
}

export interface McpClientInfo {
  name: string;
  version: string;
  description?: string;
}

/**
 * Icon descriptor (spec 2025-11-25 / SEP-973). Mirrors web app manifest
 * icon shape — clients render these in tool palettes / picker UIs.
 */
export interface McpIcon {
  src: string;
  mimeType?: string;
  sizes?: string;
}

/**
 * Tool annotations (spec 2025-03-26+). Hints to the client about how to
 * present and gate the tool. None are guarantees — the client uses these
 * heuristically (e.g. to show a confirmation prompt for destructive tools).
 */
export interface McpToolAnnotations {
  /** Human-friendly display title (distinct from `name`, the programmatic id). */
  title?: string;
  /** Tool reads only; safe to auto-approve. */
  readOnlyHint?: boolean;
  /** Tool may delete or overwrite data; client should require confirmation. */
  destructiveHint?: boolean;
  /** Calling the tool with the same args twice yields the same end state. */
  idempotentHint?: boolean;
  /** Tool interacts with the open world (network, etc.) vs. a closed system. */
  openWorldHint?: boolean;
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
  /** Human-friendly display label (spec 2025-11-25). Distinct from `name`. */
  title?: string;
  description: string;
  inputSchema: McpJsonSchema;
  /** Output schema enabling `structuredContent` on call results (spec 2025-06-18). */
  outputSchema?: McpJsonSchema;
  /** Behavior hints (spec 2025-03-26+). */
  annotations?: McpToolAnnotations;
  /** Optional icons (spec 2025-11-25 / SEP-973). */
  icons?: McpIcon[];
  /** Arbitrary metadata passthrough (spec 2025-06-18+). */
  _meta?: Record<string, unknown>;
}

export interface McpJsonSchema {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
  /** JSON Schema dialect (spec 2025-11-25 / SEP-1613 — defaults to 2020-12). */
  $schema?: string;
  [key: string]: unknown;
}

export interface McpToolCallParams {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface McpToolCallResult {
  content: McpContent[];
  /**
   * Structured tool output (spec 2025-06-18). When the tool declares an
   * `outputSchema`, the server MUST populate `structuredContent`; the
   * `content` array carrying a JSON-stringified text block is kept as
   * a back-compat fallback for older clients.
   */
  structuredContent?: unknown;
  isError?: boolean;
  _meta?: Record<string, unknown>;
}

/**
 * Discriminated content union covering text, image, audio (added 2025-03-26),
 * inlined resources, and resource links (added 2025-06-18).
 */
export type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "audio"; data: string; mimeType: string }
  | { type: "resource"; resource: McpResourceContent }
  | {
      type: "resource_link";
      uri: string;
      name: string;
      description?: string;
      mimeType?: string;
    };

// ---------------------------------------------------------------------------------------------------------------------
// Resource Types
// ---------------------------------------------------------------------------------------------------------------------

export interface McpResourceDescriptor {
  uri: string;
  name: string;
  /** Human-friendly display label (spec 2025-11-25). Distinct from `name`. */
  title?: string;
  description?: string;
  mimeType?: string;
  /** Optional icons (spec 2025-11-25 / SEP-973). */
  icons?: McpIcon[];
  /** Arbitrary metadata passthrough (spec 2025-06-18+). */
  _meta?: Record<string, unknown>;
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
  /** Human-friendly display label (spec 2025-11-25). Distinct from `name`. */
  title?: string;
  description?: string;
  arguments?: McpPromptArgument[];
  /** Optional icons (spec 2025-11-25 / SEP-973). */
  icons?: McpIcon[];
  /** Arbitrary metadata passthrough (spec 2025-06-18+). */
  _meta?: Record<string, unknown>;
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
  params?: ZObject;
  result?: ZType;
}

export interface ResourcePrimitiveSchema {
  contents?: ZType;
}

export interface PromptPrimitiveSchema {
  args?: ZObject;
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
  params: T["params"] extends ZObject
    ? Infer<T["params"]>
    : Record<string, never>;
  context?: McpContext<TContext>;
}

export type ToolHandlerResult<T extends ToolPrimitiveSchema> =
  T["result"] extends ZType ? Infer<T["result"]> : unknown;

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

export type PromptHandler<T extends ZObject, TContext = unknown> = (
  args: PromptHandlerArgs<T, TContext>,
) => Async<PromptMessage[]>;

export interface PromptHandlerArgs<T extends ZObject, TContext = unknown> {
  args: Infer<T>;
  context?: McpContext<TContext>;
}

export interface PromptMessage {
  role: "user" | "assistant";
  content: string;
}
