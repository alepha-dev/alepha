import {
  JsonRpcErrorCodes,
  McpProtocolErrorCodes,
} from "../helpers/jsonrpc.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Alepha's own MCP error codes: application codes, for purposes the MCP
 * specification does not define.
 *
 * Deliberately outside the JSON-RPC reserved range `-32768..-32000`, per the
 * 2026-07-28 error-code policy (`basic/index`, "Error Codes"): new
 * implementations SHOULD NOT emit codes in the legacy `-32000..-32019`
 * sub-range and receivers MUST NOT assume a meaning for them, `-32020..-32099`
 * belongs to the specification alone, and an application code SHOULD be
 * allocated outside the reserved range altogether.
 *
 * They were `-32001` and `-32003`, which are also exactly what a pre-release
 * draft of 2026-07-28 gave `HeaderMismatch` and
 * `MissingRequiredClientCapability`: a client built against that draft would
 * read a permission refusal as a header error. The trailing digits are kept
 * so the old mapping stays obvious. The codes the specification does define
 * are in `McpProtocolErrorCodes`.
 */
export const McpErrorCodes = {
  UNAUTHORIZED: -31001,
  FORBIDDEN: -31003,
} as const;

// ---------------------------------------------------------------------------------------------------------------------

export class McpError extends Error {
  name = "McpError";
  code: number;

  /**
   * The JSON-RPC error's `data` member, sent only when set.
   */
  data?: unknown;

  constructor(
    message: string,
    code: number = JsonRpcErrorCodes.INTERNAL_ERROR,
  ) {
    super(message);
    this.code = code;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * A modern request's HTTP headers are missing, malformed, or disagree with its
 * body (spec 2026-07-28, Streamable HTTP "Server Validation").
 *
 * `-32020` with HTTP 400. The headers exist so an intermediary can route on
 * them without parsing the body, which is only safe if the server refuses a
 * request whose headers say something the body does not: otherwise a load
 * balancer and this server act on two different requests.
 */
export class McpHeaderMismatchError extends McpError {
  name = "McpHeaderMismatchError";

  constructor(detail: string) {
    super(`Header mismatch: ${detail}`, McpProtocolErrorCodes.HEADER_MISMATCH);
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * A modern request (2026-07-28 and later) named a protocol version this
 * server does not serve.
 *
 * `-32022` with the versions it does serve, per spec. On HTTP the status is
 * 400. This error is itself the signal that the server is modern, so it is
 * only ever sent while the modern path is on: with it off, an unsupported
 * version gets a plain non-JSON-RPC 400 instead, which is what lets a
 * dual-era client fall back to `initialize`.
 */
export class McpUnsupportedProtocolVersionError extends McpError {
  name = "McpUnsupportedProtocolVersionError";
  data: { supported: string[]; requested: string };

  constructor(requested: string, supported: string[]) {
    super(
      "Unsupported protocol version",
      McpProtocolErrorCodes.UNSUPPORTED_PROTOCOL_VERSION,
    );
    this.data = { supported, requested };
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

/**
 * See {@link McpToolNotFoundError} for why this is `-32602`.
 */
export class McpResourceNotFoundError extends McpError {
  name = "McpResourceNotFoundError";
  uri: string;

  constructor(uri: string) {
    super(`Unknown resource: ${uri}`, JsonRpcErrorCodes.INVALID_PARAMS);
    this.uri = uri;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * See {@link McpToolNotFoundError} for why this is `-32602`.
 */
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
