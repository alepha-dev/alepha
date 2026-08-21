import { describe, expect, test } from "vitest";

import {
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
} from "../index.ts";

// ---------------------------------------------------------------------------------------------------------------------

describe("jsonrpc constants", () => {
  test("JSONRPC_VERSION should be 2.0", () => {
    expect(JSONRPC_VERSION).toBe("2.0");
  });

  test("MCP_PROTOCOL_VERSION should be defined", () => {
    expect(MCP_PROTOCOL_VERSION).toBe("2025-11-25");
  });

  test("JsonRpcErrorCodes should have correct values", () => {
    expect(JsonRpcErrorCodes.PARSE_ERROR).toBe(-32700);
    expect(JsonRpcErrorCodes.INVALID_REQUEST).toBe(-32600);
    expect(JsonRpcErrorCodes.METHOD_NOT_FOUND).toBe(-32601);
    expect(JsonRpcErrorCodes.INVALID_PARAMS).toBe(-32602);
    expect(JsonRpcErrorCodes.INTERNAL_ERROR).toBe(-32603);
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe("createResponse", () => {
  test("should create a valid JSON-RPC response", () => {
    const response = createResponse(1, { foo: "bar" });

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { foo: "bar" },
    });
  });

  test("should work with string id", () => {
    const response = createResponse("abc-123", "hello");

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: "abc-123",
      result: "hello",
    });
  });

  test("should work with null result", () => {
    const response = createResponse(1, null);

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: null,
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe("createErrorResponse", () => {
  test("should create a valid JSON-RPC error response", () => {
    const response = createErrorResponse(1, {
      code: -32600,
      message: "Invalid request",
    });

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32600,
        message: "Invalid request",
      },
    });
  });

  test("should include error data if provided", () => {
    const response = createErrorResponse(1, {
      code: -32602,
      message: "Invalid params",
      data: { param: "foo" },
    });

    expect(response.error?.data).toEqual({ param: "foo" });
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe("createNotification", () => {
  test("should create a notification without params", () => {
    const notification = createNotification("notifications/initialized");

    expect(notification).toEqual({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
  });

  test("should create a notification with params", () => {
    const notification = createNotification("notifications/progress", {
      token: "abc",
      value: 50,
    });

    expect(notification).toEqual({
      jsonrpc: "2.0",
      method: "notifications/progress",
      params: {
        token: "abc",
        value: 50,
      },
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe("error builders", () => {
  test("createParseError should create parse error", () => {
    const error = createParseError();
    expect(error.code).toBe(JsonRpcErrorCodes.PARSE_ERROR);
    expect(error.message).toBe("Parse error");
  });

  test("createParseError should accept custom message", () => {
    const error = createParseError("Custom parse error");
    expect(error.message).toBe("Custom parse error");
  });

  test("createInvalidRequestError should create invalid request error", () => {
    const error = createInvalidRequestError();
    expect(error.code).toBe(JsonRpcErrorCodes.INVALID_REQUEST);
    expect(error.message).toBe("Invalid request");
  });

  test("createMethodNotFoundError should include method name", () => {
    const error = createMethodNotFoundError("tools/call");
    expect(error.code).toBe(JsonRpcErrorCodes.METHOD_NOT_FOUND);
    expect(error.message).toBe("Method not found: tools/call");
  });

  test("createInvalidParamsError should include message", () => {
    const error = createInvalidParamsError("Missing required param: name");
    expect(error.code).toBe(JsonRpcErrorCodes.INVALID_PARAMS);
    expect(error.message).toBe("Missing required param: name");
  });

  test("createInternalError should include message", () => {
    const error = createInternalError("Something went wrong");
    expect(error.code).toBe(JsonRpcErrorCodes.INTERNAL_ERROR);
    expect(error.message).toBe("Something went wrong");
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe("parseMessage", () => {
  test("should parse valid JSON-RPC request", () => {
    const json = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });

    const request = parseMessage(json);

    expect(request).toEqual({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
  });

  test("should parse request with params", () => {
    const json = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "calculator", arguments: { a: 1, b: 2 } },
    });

    const request = parseMessage(json);

    expect(request.method).toBe("tools/call");
    expect(request.params).toEqual({
      name: "calculator",
      arguments: { a: 1, b: 2 },
    });
  });

  test("should parse notification (no id)", () => {
    const json = JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });

    const request = parseMessage(json);

    expect(request.id).toBeUndefined();
    expect(request.method).toBe("notifications/initialized");
  });

  test("should throw JsonRpcParseError for invalid JSON", () => {
    expect(() => parseMessage("not json")).toThrow(JsonRpcParseError);
    expect(() => parseMessage("not json")).toThrow("Invalid JSON");
  });

  test("should throw JsonRpcParseError for invalid JSON-RPC version", () => {
    const json = JSON.stringify({
      jsonrpc: "1.0",
      id: 1,
      method: "test",
    });

    expect(() => parseMessage(json)).toThrow(JsonRpcParseError);
    expect(() => parseMessage(json)).toThrow("Invalid JSON-RPC request");
  });

  test("should throw JsonRpcParseError for missing method", () => {
    const json = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
    });

    expect(() => parseMessage(json)).toThrow(JsonRpcParseError);
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe("isValidJsonRpcRequest", () => {
  test("should return true for valid request", () => {
    expect(
      isValidJsonRpcRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "test",
      }),
    ).toBe(true);
  });

  test("should return true for notification", () => {
    expect(
      isValidJsonRpcRequest({
        jsonrpc: "2.0",
        method: "test",
      }),
    ).toBe(true);
  });

  test("should return true for request with params", () => {
    expect(
      isValidJsonRpcRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "test",
        params: { foo: "bar" },
      }),
    ).toBe(true);
  });

  test("should return false for null", () => {
    expect(isValidJsonRpcRequest(null)).toBe(false);
  });

  test("should return false for non-object", () => {
    expect(isValidJsonRpcRequest("string")).toBe(false);
    expect(isValidJsonRpcRequest(123)).toBe(false);
  });

  test("should return false for wrong version", () => {
    expect(
      isValidJsonRpcRequest({
        jsonrpc: "1.0",
        id: 1,
        method: "test",
      }),
    ).toBe(false);
  });

  test("should return false for non-string method", () => {
    expect(
      isValidJsonRpcRequest({
        jsonrpc: "2.0",
        id: 1,
        method: 123,
      }),
    ).toBe(false);
  });

  test("should return false for invalid id type", () => {
    expect(
      isValidJsonRpcRequest({
        jsonrpc: "2.0",
        id: { foo: "bar" },
        method: "test",
      }),
    ).toBe(false);
  });

  test("should return false for non-object params", () => {
    expect(
      isValidJsonRpcRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "test",
        params: "string",
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe("isNotification", () => {
  test("should return true when id is undefined", () => {
    expect(
      isNotification({
        jsonrpc: "2.0",
        method: "test",
      }),
    ).toBe(true);
  });

  test("should return false when id is present", () => {
    expect(
      isNotification({
        jsonrpc: "2.0",
        id: 1,
        method: "test",
      }),
    ).toBe(false);
  });

  test("should return false when id is 0", () => {
    expect(
      isNotification({
        jsonrpc: "2.0",
        id: 0,
        method: "test",
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe("JsonRpcParseError", () => {
  test("should be an instance of Error", () => {
    const error = new JsonRpcParseError("test");
    expect(error).toBeInstanceOf(Error);
  });

  test("should have correct name", () => {
    const error = new JsonRpcParseError("test");
    expect(error.name).toBe("JsonRpcParseError");
  });

  test("should have correct message", () => {
    const error = new JsonRpcParseError("Custom message");
    expect(error.message).toBe("Custom message");
  });
});
