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
 * The latest MCP protocol revision Alepha targets.
 * See {@link SUPPORTED_PROTOCOL_VERSIONS} for the full negotiation list.
 */
export const MCP_PROTOCOL_VERSION = "2025-11-25" as const;

/**
 * Protocol versions Alepha will accept during `initialize` negotiation,
 * highest preference first. The server echoes back whichever version the
 * client requested if it appears here, otherwise picks the first entry.
 */
export const SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
] as const;

export type SupportedProtocolVersion =
  (typeof SUPPORTED_PROTOCOL_VERSIONS)[number];

export const isSupportedProtocolVersion = (
  v: unknown,
): v is SupportedProtocolVersion =>
  typeof v === "string" &&
  (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(v);

export const JsonRpcErrorCodes = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
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
