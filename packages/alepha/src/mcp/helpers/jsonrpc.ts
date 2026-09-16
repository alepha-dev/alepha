import { AlephaError } from "alepha";

import type {
  JsonRpcError,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
} from "../interfaces/McpTypes.ts";

// ---------------------------------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------------------------------

export const JSONRPC_VERSION = "2.0" as const;

/**
 * The latest MCP protocol revision Alepha targets (the spec's
 * `LATEST_PROTOCOL_VERSION`). A modern revision: no handshake, version and
 * capabilities on every request's `_meta`.
 * See {@link SUPPORTED_PROTOCOL_VERSIONS} for everything the server serves.
 */
export const MCP_PROTOCOL_VERSION = "2026-07-28" as const;

/**
 * The latest legacy MCP revision: what a client that opens with
 * `initialize` negotiates, and what `initialize` answers when the requested
 * version is not a legacy one.
 */
export const MCP_LEGACY_PROTOCOL_VERSION = "2025-11-25" as const;

/**
 * The legacy MCP revisions: the ones that open a session with an `initialize`
 * handshake (2025-11-25 and earlier), highest preference first.
 *
 * Fixed: every revision after 2025-11-25 is modern by the spec's own
 * terminology, so this list never grows. `initialize` negotiates from it and
 * from nothing else, which is what keeps a legacy client from being told it
 * negotiated a modern revision.
 */
export const LEGACY_PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
] as const;

/**
 * The modern MCP revisions Alepha implements: version, client identity and
 * capabilities ride on every request's `_meta`, and there is no handshake
 * (2026-07-28 and later).
 */
export const MODERN_PROTOCOL_VERSIONS = ["2026-07-28"] as const;

/**
 * Protocol versions Alepha serves by default, modern first, then legacy.
 * Seeds `McpServerProvider.protocolVersions`, which is what the server
 * actually checks against.
 *
 * Holding a modern version is what turns the modern path on: a request that
 * names 2026-07-28 is served statelessly under that revision, and a request
 * naming an unknown version gets the modern `-32022`. Legacy clients keep
 * opening with `initialize`, on the same endpoint. An app that must not speak
 * the modern protocol assigns `LEGACY_PROTOCOL_VERSIONS` to
 * `protocolVersions`, which brings back the plain 400 a dual-era client
 * falls back on.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = [
  ...MODERN_PROTOCOL_VERSIONS,
  ...LEGACY_PROTOCOL_VERSIONS,
] as const;

export type SupportedProtocolVersion =
  (typeof SUPPORTED_PROTOCOL_VERSIONS)[number];

export const isSupportedProtocolVersion = (
  v: unknown,
): v is SupportedProtocolVersion =>
  typeof v === "string" &&
  (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(v);

/**
 * Whether a version is a legacy (handshake-based) revision. Anything else,
 * an unknown future version included, is modern: a request naming it is
 * answered with the modern `-32022`, which sends a dual-era client to a
 * supported modern version rather than back to `initialize`.
 */
export const isLegacyProtocolVersion = (v: unknown): boolean =>
  typeof v === "string" &&
  (LEGACY_PROTOCOL_VERSIONS as readonly string[]).includes(v);

export const JsonRpcErrorCodes = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

/**
 * Error codes the MCP specification itself defines (2026-07-28, "Error
 * Codes"), allocated from the `-32020..-32099` sub-range it reserves. They
 * mean exactly this and nothing else, so they live apart from
 * `McpErrorCodes`, which holds Alepha's own application codes.
 *
 * Each identifies a modern server: a dual-era client that receives one
 * retries or corrects its request instead of falling back to `initialize`.
 */
export const McpProtocolErrorCodes = {
  HEADER_MISMATCH: -32020,
  UNSUPPORTED_PROTOCOL_VERSION: -32022,
} as const;

// ---------------------------------------------------------------------------------------------------------------------
// Response Builders
// ---------------------------------------------------------------------------------------------------------------------

export function createResponse(
  id: string | number,
  result: unknown,
): JsonRpcResponse {
  return {
    jsonrpc: JSONRPC_VERSION,
    id,
    result,
  };
}

export function createErrorResponse(
  // `null` is required by JSON-RPC when the request id could not be
  // determined (an unparseable message). Fabricating `0` there both violates
  // the spec and can collide with a real request whose id IS 0.
  id: string | number | null,
  error: JsonRpcError,
): JsonRpcResponse {
  return {
    jsonrpc: JSONRPC_VERSION,
    id,
    error,
  };
}

export function createNotification(
  method: string,
  params?: Record<string, unknown>,
): JsonRpcNotification {
  return {
    jsonrpc: JSONRPC_VERSION,
    method,
    params,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Error Builders
// ---------------------------------------------------------------------------------------------------------------------

export function createParseError(message = "Parse error"): JsonRpcError {
  return {
    code: JsonRpcErrorCodes.PARSE_ERROR,
    message,
  };
}

export function createInvalidRequestError(
  message = "Invalid request",
): JsonRpcError {
  return {
    code: JsonRpcErrorCodes.INVALID_REQUEST,
    message,
  };
}

export function createMethodNotFoundError(method: string): JsonRpcError {
  return {
    code: JsonRpcErrorCodes.METHOD_NOT_FOUND,
    message: `Method not found: ${method}`,
  };
}

export function createInvalidParamsError(message: string): JsonRpcError {
  return {
    code: JsonRpcErrorCodes.INVALID_PARAMS,
    message,
  };
}

export function createInternalError(message: string): JsonRpcError {
  return {
    code: JsonRpcErrorCodes.INTERNAL_ERROR,
    message,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Message Parsing
// ---------------------------------------------------------------------------------------------------------------------

export function parseMessage(data: string): JsonRpcRequest {
  let parsed: unknown;

  try {
    parsed = JSON.parse(data);
  } catch {
    throw new JsonRpcParseError("Invalid JSON");
  }

  if (!isValidJsonRpcRequest(parsed)) {
    throw new JsonRpcParseError("Invalid JSON-RPC request");
  }

  return parsed;
}

export function isValidJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  if (obj.jsonrpc !== JSONRPC_VERSION) {
    return false;
  }

  if (typeof obj.method !== "string") {
    return false;
  }

  if (
    obj.id !== undefined &&
    typeof obj.id !== "string" &&
    typeof obj.id !== "number"
  ) {
    return false;
  }

  if (obj.params !== undefined && typeof obj.params !== "object") {
    return false;
  }

  return true;
}

export function isNotification(request: JsonRpcRequest): boolean {
  return request.id === undefined;
}

// ---------------------------------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------------------------------

export class JsonRpcParseError extends AlephaError {
  name = "JsonRpcParseError";
}
