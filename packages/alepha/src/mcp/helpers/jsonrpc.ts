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

export const MCP_PROTOCOL_VERSION = "2024-11-05" as const;

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
  id: string | number,
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
