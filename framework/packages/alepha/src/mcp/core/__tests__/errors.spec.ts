import { describe, expect, test } from "vitest";

import {
  JsonRpcErrorCodes,
  McpError,
  McpInvalidParamsError,
  McpMethodNotFoundError,
  McpPromptNotFoundError,
  McpResourceNotFoundError,
  McpToolNotFoundError,
} from "../index.ts";

// ---------------------------------------------------------------------------------------------------------------------

describe("McpError", () => {
  test("should be an instance of Error", () => {
    const error = new McpError("Test error");
    expect(error).toBeInstanceOf(Error);
  });

  test("should have correct name", () => {
    const error = new McpError("Test error");
    expect(error.name).toBe("MCP");
  });

  test("should have correct message", () => {
    const error = new McpError("Test error message");
    expect(error.message).toBe("Test error message");
  });

  test("should default to INTERNAL_ERROR code", () => {
    const error = new McpError("Test error");
    expect(error.data.code).toBe(JsonRpcErrorCodes.INTERNAL_ERROR);
  });

  test("should accept custom error code", () => {
    const error = new McpError({ code: -32000 }, { message: "Test error" });
    expect(error.data.code).toBe(-32000);
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe("McpMethodNotFoundError", () => {
  test("should be an instance of McpError", () => {
    const error = new McpMethodNotFoundError({ method: "unknown/method" });
    expect(error).toBeInstanceOf(McpError);
    expect(error).toBeInstanceOf(Error);
  });

  test("should have correct name", () => {
    const error = new McpMethodNotFoundError({ method: "unknown/method" });
    expect(error.name).toBe("MCP_METHOD_NOT_FOUND");
  });

  test("should include method name in message", () => {
    const error = new McpMethodNotFoundError({ method: "custom/method" });
    expect(error.message).toBe("Method not found: custom/method");
  });

  test("should have METHOD_NOT_FOUND code", () => {
    const error = new McpMethodNotFoundError({ method: "test" });
    expect(error.data.code).toBe(JsonRpcErrorCodes.METHOD_NOT_FOUND);
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe("McpToolNotFoundError", () => {
  test("should be an instance of McpError", () => {
    const error = new McpToolNotFoundError({ tool: "unknown-tool" });
    expect(error).toBeInstanceOf(McpError);
  });

  test("should have correct name", () => {
    const error = new McpToolNotFoundError({ tool: "test-tool" });
    expect(error.name).toBe("MCP_TOOL_NOT_FOUND");
  });

  test("should include tool name in message", () => {
    const error = new McpToolNotFoundError({ tool: "my-tool" });
    expect(error.message).toBe("Unknown tool: my-tool");
  });

  test("should store tool name as property", () => {
    const error = new McpToolNotFoundError({ tool: "calculator" });
    expect(error.data.tool).toBe("calculator");
  });

  test("should have INVALID_PARAMS code", () => {
    const error = new McpToolNotFoundError({ tool: "test" });
    expect(error.data.code).toBe(JsonRpcErrorCodes.INVALID_PARAMS);
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe("McpResourceNotFoundError", () => {
  test("should be an instance of McpError", () => {
    const error = new McpResourceNotFoundError({ uri: "file:///test" });
    expect(error).toBeInstanceOf(McpError);
  });

  test("should have correct name", () => {
    const error = new McpResourceNotFoundError({ uri: "file:///test" });
    expect(error.name).toBe("MCP_RESOURCE_NOT_FOUND");
  });

  test("should include URI in message", () => {
    const error = new McpResourceNotFoundError({ uri: "config://app" });
    expect(error.message).toBe("Unknown resource: config://app");
  });

  test("should store URI as property", () => {
    const error = new McpResourceNotFoundError({ uri: "db://users/123" });
    expect(error.data.uri).toBe("db://users/123");
  });

  test("should have INVALID_PARAMS code", () => {
    const error = new McpResourceNotFoundError({ uri: "test://" });
    expect(error.data.code).toBe(JsonRpcErrorCodes.INVALID_PARAMS);
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe("McpPromptNotFoundError", () => {
  test("should be an instance of McpError", () => {
    const error = new McpPromptNotFoundError({ prompt: "unknown-prompt" });
    expect(error).toBeInstanceOf(McpError);
  });

  test("should have correct name", () => {
    const error = new McpPromptNotFoundError({ prompt: "test-prompt" });
    expect(error.name).toBe("MCP_PROMPT_NOT_FOUND");
  });

  test("should include prompt name in message", () => {
    const error = new McpPromptNotFoundError({ prompt: "greeting" });
    expect(error.message).toBe("Unknown prompt: greeting");
  });

  test("should store prompt name as property", () => {
    const error = new McpPromptNotFoundError({ prompt: "code-review" });
    expect(error.data.prompt).toBe("code-review");
  });

  test("should have INVALID_PARAMS code", () => {
    const error = new McpPromptNotFoundError({ prompt: "test" });
    expect(error.data.code).toBe(JsonRpcErrorCodes.INVALID_PARAMS);
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe("McpInvalidParamsError", () => {
  test("should be an instance of McpError", () => {
    const error = new McpInvalidParamsError("Invalid params");
    expect(error).toBeInstanceOf(McpError);
  });

  test("should have correct name", () => {
    const error = new McpInvalidParamsError("test");
    expect(error.name).toBe("MCP_INVALID_PARAMS");
  });

  test("should have provided message", () => {
    const error = new McpInvalidParamsError("Missing required parameter: name");
    expect(error.message).toBe("Missing required parameter: name");
  });

  test("should have INVALID_PARAMS code", () => {
    const error = new McpInvalidParamsError("test");
    expect(error.data.code).toBe(JsonRpcErrorCodes.INVALID_PARAMS);
  });
});
