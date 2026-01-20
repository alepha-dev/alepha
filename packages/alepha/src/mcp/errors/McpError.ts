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

export class McpToolNotFoundError extends McpError {
  name = "McpToolNotFoundError";
  tool: string;

  constructor(tool: string) {
    super(`Tool not found: ${tool}`, JsonRpcErrorCodes.METHOD_NOT_FOUND);
    this.tool = tool;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export class McpResourceNotFoundError extends McpError {
  name = "McpResourceNotFoundError";
  uri: string;

  constructor(uri: string) {
    super(`Resource not found: ${uri}`, JsonRpcErrorCodes.METHOD_NOT_FOUND);
    this.uri = uri;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export class McpPromptNotFoundError extends McpError {
  name = "McpPromptNotFoundError";
  prompt: string;

  constructor(prompt: string) {
    super(`Prompt not found: ${prompt}`, JsonRpcErrorCodes.METHOD_NOT_FOUND);
    this.prompt = prompt;
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
