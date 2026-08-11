import { JsonRpcErrorCodes } from "../helpers/jsonrpc.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * MCP-specific error codes (application-specific codes in the -32000 to -32099 range).
 */
export const McpErrorCodes = {
  UNAUTHORIZED: -32001,
  FORBIDDEN: -32003,
} as const;

// ---------------------------------------------------------------------------------------------------------------------

export class McpError extends Error {
  name = "McpError";
  code: number;

  constructor(
    message: string,
    code: number = JsonRpcErrorCodes.INTERNAL_ERROR,
  ) {
    super(message);
    this.code = code;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export class McpMethodNotFoundError extends McpError {
  name = "McpMethodNotFoundError";

  constructor(method: string) {
    super(`Method not found: ${method}`, JsonRpcErrorCodes.METHOD_NOT_FOUND);
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * A named primitive the server does not have.
 *
 * These carry `-32602 Invalid params`, NOT `-32601 Method not found`.
 * `-32601` says the *method* — `tools/call` — does not exist, from which a
 * conforming client can reasonably conclude the server exposes no tools at
 * all. The spec spells the correct shape out for tools ("Unknown tool:
 * invalid_tool_name" with code `-32602`); resource-not-found used `-32002` in
 * 2025-11-25 and became `-32602` in 2026-07-28, so `-32601` is wrong under
 * every revision.
 */
export class McpToolNotFoundError extends McpError {
  name = "McpToolNotFoundError";
  tool: string;

  constructor(tool: string) {
    super(`Unknown tool: ${tool}`, JsonRpcErrorCodes.INVALID_PARAMS);
    this.tool = tool;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/** See {@link McpToolNotFoundError} for why this is `-32602`. */
export class McpResourceNotFoundError extends McpError {
  name = "McpResourceNotFoundError";
  uri: string;

  constructor(uri: string) {
    super(`Unknown resource: ${uri}`, JsonRpcErrorCodes.INVALID_PARAMS);
    this.uri = uri;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/** See {@link McpToolNotFoundError} for why this is `-32602`. */
export class McpPromptNotFoundError extends McpError {
  name = "McpPromptNotFoundError";
  prompt: string;

  constructor(prompt: string) {
    super(`Unknown prompt: ${prompt}`, JsonRpcErrorCodes.INVALID_PARAMS);
    this.prompt = prompt;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * A tool returned a value that violates its own declared `schema.result`.
 *
 * This is a SERVER bug, not a caller mistake, and the distinction is the whole
 * point of the class. Both validations in `ToolPrimitive.execute()` throw the
 * same `SchemaValidationError`, so an output failure used to surface through
 * the SEP-1303 tool-execution-error path as `Validation error at /n` — naming
 * a path that is not an input parameter. The model, told its arguments were
 * wrong, retries forever adjusting arguments that were never the problem.
 *
 * Carrying `-32603 Internal error` instead says the honest thing: the call
 * failed for reasons on the server side and there is nothing to self-correct.
 */
export class McpToolOutputError extends McpError {
  name = "McpToolOutputError";
  tool: string;

  constructor(tool: string, detail: string) {
    super(
      `Server error: tool "${tool}" returned a value violating its declared output schema (${detail})`,
      JsonRpcErrorCodes.INTERNAL_ERROR,
    );
    this.tool = tool;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export class McpInvalidParamsError extends McpError {
  name = "McpInvalidParamsError";

  constructor(message: string) {
    super(message, JsonRpcErrorCodes.INVALID_PARAMS);
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export class McpUnauthorizedError extends McpError {
  name = "McpUnauthorizedError";

  constructor(message = "Unauthorized") {
    super(message, McpErrorCodes.UNAUTHORIZED);
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export class McpForbiddenError extends McpError {
  name = "McpForbiddenError";

  constructor(message = "Forbidden") {
    super(message, McpErrorCodes.FORBIDDEN);
  }
}
