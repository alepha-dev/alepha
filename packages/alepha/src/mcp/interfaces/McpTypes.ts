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
  /**
   * Declared only when at least one prompt or resource template provides a
   * `complete` handler — advertising argument autocompletion the server cannot
   * actually perform is worse than advertising nothing.
   */
  completions?: Record<string, never>;
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
  /**
   * Size specifications, web-app-manifest style — `["48x48"]`, `["any"]` for
   * a scalable format, `["48x48", "96x96"]` for several. An array, not a
   * single string: SEP-973 defines it that way.
   */
  sizes?: string[];
  /** Which client theme this icon is drawn for. */
  theme?: "light" | "dark";
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
 * Hints about how a client should treat a piece of content or a resource.
 * All optional, all advisory (spec 2025-03-26+).
 */
export interface McpAnnotations {
  /** Who this is for. A client may hide `["assistant"]` content from the user. */
  audience?: Array<"user" | "assistant">;
  /** 0 (least) to 1 (most) important. */
  priority?: number;
  /**
   * ISO 8601 timestamp of the last change. This is what lets a client decide
   * whether it needs to re-read a resource it already has.
   */
  lastModified?: string;
}

interface McpContentBase {
  annotations?: McpAnnotations;
  /** Arbitrary metadata passthrough (spec 2025-06-18+). */
  _meta?: Record<string, unknown>;
}

/**
 * Discriminated content union covering text, image, audio (added 2025-03-26),
 * inlined resources, and resource links (added 2025-06-18).
 */
export type McpContent =
  | (McpContentBase & { type: "text"; text: string })
  | (McpContentBase & { type: "image"; data: string; mimeType: string })
  | (McpContentBase & { type: "audio"; data: string; mimeType: string })
  | (McpContentBase & { type: "resource"; resource: McpResourceContent })
  | (McpContentBase & {
      type: "resource_link";
      uri: string;
      name: string;
      description?: string;
      mimeType?: string;
    });

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
  /** Audience / priority / lastModified hints (spec 2025-03-26+). */
  annotations?: McpAnnotations;
  /** Arbitrary metadata passthrough (spec 2025-06-18+). */
  _meta?: Record<string, unknown>;
}

/**
 * A family of resources addressed by an RFC 6570 URI template, returned by
 * `resources/templates/list`. Carries `uriTemplate` where a
 * {@link McpResourceDescriptor} carries a concrete `uri`.
 */
export interface McpResourceTemplateDescriptor {
  uriTemplate: string;
  name: string;
  /** Human-friendly display label (spec 2025-11-25). Distinct from `name`. */
  title?: string;
  description?: string;
  mimeType?: string;
  /** Optional icons (spec 2025-11-25 / SEP-973). */
  icons?: McpIcon[];
  /** Audience / priority / lastModified hints (spec 2025-03-26+). */
  annotations?: McpAnnotations;
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
  content: McpContent;
}

/**
 * A prompt message's content block.
 *
 * Now an alias of {@link McpContent}. It used to be a separate, looser shape
 * (`type: "text" | "image" | "resource"` with optional `text`/`data`) that
 * described a capability nothing could reach: `PromptMessage.content` was
 * `string` and the server hard-coded every message to a text block. The types
 * over-promised; this makes them tell the truth.
 */
export type McpPromptContent = McpContent;

// ---------------------------------------------------------------------------------------------------------------------
// Completion Types
// ---------------------------------------------------------------------------------------------------------------------

/**
 * What the client is asking to complete: a named prompt's argument, or a
 * resource template's URI variable.
 */
export type McpCompletionRef =
  | { type: "ref/prompt"; name: string }
  | { type: "ref/resource"; uri: string };

export interface McpCompletionArgument {
  name: string;
  /** What the user has typed so far — may be empty. */
  value: string;
}

export interface McpCompletionResult {
  completion: {
    values: string[];
    /** How many candidates exist in total, before the cap. */
    total?: number;
    /** True when `values` was truncated. */
    hasMore?: boolean;
  };
}

export interface CompletionHandlerArgs<TContext = unknown> {
  /** The argument being completed and its partial value. */
  argument: McpCompletionArgument;
  /**
   * Arguments the user has already filled in, when the client sends them
   * (`params.context.arguments`, spec 2025-06-18+). Use it to narrow: a
   * `city` completion depends on the `country` already chosen.
   */
  arguments?: Record<string, string>;
  context?: McpContext<TContext>;
}

/**
 * Returns candidate values for one argument. Return everything that matches —
 * the server applies the cap and reports `hasMore`.
 */
export type CompletionHandler<TContext = unknown> = (
  args: CompletionHandlerArgs<TContext>,
) => Async<string[]>;

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
   *
   * Populated by the transport's `buildContext` — the authenticated user by
   * default. Override that method to carry anything else.
   */
  data?: T;

  /**
   * Aborted when the client gives up on this request
   * (`notifications/cancelled`).
   *
   * Pass it to `fetch`, DB queries and anything else that accepts one: without
   * it, a tool the client has abandoned runs to completion anyway — still
   * holding a connection, still burning CPU, still writing whatever it was
   * going to write. Absent when the transport does not support cancellation.
   */
  signal?: AbortSignal;

  /**
   * Report incremental progress on a long-running call.
   *
   * Present only when the client attached a `_meta.progressToken` to the
   * request AND the transport can stream — a progress notification is
   * addressed to that token, so without one there is nothing to send it to.
   * Handlers should call it unconditionally through `?.`:
   *
   * ```ts
   * context?.reportProgress?.(done, total, `Indexed ${done} files`);
   * ```
   *
   * @param progress - How far along, in the same unit as `total`.
   * @param total - The end value, when known.
   * @param message - Human-readable status line.
   */
  reportProgress?: (progress: number, total?: number, message?: string) => void;

  /**
   * Identifies the caller for the purpose of correlating a request with the
   * `notifications/cancelled` that cancels it. Set by the transport.
   *
   * JSON-RPC ids are unique per connection, not globally, and this server has
   * no session concept — so without a client key, two callers that both use
   * `id: 1` share a cancellation slot and either could cancel the other.
   */
  clientKey?: string;
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
  /**
   * A plain string (the common case, wrapped into a text block for you), a
   * single content block, or several.
   *
   * An array becomes one wire message per block, all with this message's role
   * — `PromptMessage.content` is a single block on the wire, not a list.
   */
  content: string | McpContent | McpContent[];
}
