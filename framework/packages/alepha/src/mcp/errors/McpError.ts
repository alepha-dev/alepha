import { $error, z } from "alepha";

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

/**
 * An MCP error: a JSON-RPC error `code`, and the error's `data` member
 * (`rpcData`) when it has one. The server answers it as a JSON-RPC error
 * response rather than an internal error.
 *
 * ```ts
 * throw new McpError("Busy", { cause }); // -32603 Internal error
 * throw new McpError({ code: -31010 }, { message: "Quota exceeded" });
 * ```
 */
export const McpError = $error({
  name: "MCP",
  schema: z.object({
    code: z.integer(),
    rpcData: z.any().optional(),
  }),
  default: { code: JsonRpcErrorCodes.INTERNAL_ERROR },
  message: "MCP error",
});

export type McpError = InstanceType<typeof McpError>;

/**
 * An `Mcp-Method` / `Mcp-Name` header that does not match the request body.
 */
export const McpHeaderMismatchError = McpError.extend({
  name: "MCP_HEADER_MISMATCH",
  schema: z.object({ detail: z.text({ size: "long" }) }),
  default: { code: McpProtocolErrorCodes.HEADER_MISMATCH },
  message: (data) => `Header mismatch: ${data.detail}`,
});

export type McpHeaderMismatchError = InstanceType<
  typeof McpHeaderMismatchError
>;

/**
 * A protocol version the server does not speak; `rpcData` lists the ones it
 * does.
 */
export const McpUnsupportedProtocolVersionError = McpError.extend({
  name: "MCP_UNSUPPORTED_PROTOCOL_VERSION",
  default: { code: McpProtocolErrorCodes.UNSUPPORTED_PROTOCOL_VERSION },
  message: "Unsupported protocol version",
});

export type McpUnsupportedProtocolVersionError = InstanceType<
  typeof McpUnsupportedProtocolVersionError
>;

/**
 * A JSON-RPC method the server does not implement.
 */
export const McpMethodNotFoundError = McpError.extend({
  name: "MCP_METHOD_NOT_FOUND",
  schema: z.object({ method: z.text() }),
  default: { code: JsonRpcErrorCodes.METHOD_NOT_FOUND },
  message: (data) => `Method not found: ${data.method}`,
});

export type McpMethodNotFoundError = InstanceType<
  typeof McpMethodNotFoundError
>;

/**
 * A tool the server does not declare.
 */
export const McpToolNotFoundError = McpError.extend({
  name: "MCP_TOOL_NOT_FOUND",
  schema: z.object({ tool: z.text() }),
  default: { code: JsonRpcErrorCodes.INVALID_PARAMS },
  message: (data) => `Unknown tool: ${data.tool}`,
});

export type McpToolNotFoundError = InstanceType<typeof McpToolNotFoundError>;

/**
 * A resource the server does not declare.
 */
export const McpResourceNotFoundError = McpError.extend({
  name: "MCP_RESOURCE_NOT_FOUND",
  schema: z.object({ uri: z.text({ size: "long" }) }),
  default: { code: JsonRpcErrorCodes.INVALID_PARAMS },
  message: (data) => `Unknown resource: ${data.uri}`,
});

export type McpResourceNotFoundError = InstanceType<
  typeof McpResourceNotFoundError
>;

/**
 * A prompt the server does not declare.
 */
export const McpPromptNotFoundError = McpError.extend({
  name: "MCP_PROMPT_NOT_FOUND",
  schema: z.object({ prompt: z.text() }),
  default: { code: JsonRpcErrorCodes.INVALID_PARAMS },
  message: (data) => `Unknown prompt: ${data.prompt}`,
});

export type McpPromptNotFoundError = InstanceType<
  typeof McpPromptNotFoundError
>;

/**
 * A tool whose result violates its own declared output schema: the tool is
 * wrong, not the caller.
 */
export const McpToolOutputError = McpError.extend({
  name: "MCP_TOOL_OUTPUT",
  schema: z.object({ tool: z.text(), detail: z.text({ size: "rich" }) }),
  default: { code: JsonRpcErrorCodes.INTERNAL_ERROR },
  message: (data) =>
    `Server error: tool "${data.tool}" returned a value violating its declared output schema (${data.detail})`,
});

export type McpToolOutputError = InstanceType<typeof McpToolOutputError>;

/**
 * Params the method cannot read: -32602 Invalid params.
 */
export const McpInvalidParamsError = McpError.extend({
  name: "MCP_INVALID_PARAMS",
  default: { code: JsonRpcErrorCodes.INVALID_PARAMS },
  message: "Invalid params",
});

export type McpInvalidParamsError = InstanceType<typeof McpInvalidParamsError>;

/**
 * A caller without a credential the request needs.
 */
export const McpUnauthorizedError = McpError.extend({
  name: "MCP_UNAUTHORIZED",
  default: { code: McpErrorCodes.UNAUTHORIZED },
  message: "Unauthorized",
});

export type McpUnauthorizedError = InstanceType<typeof McpUnauthorizedError>;

/**
 * A caller who may not do what it asked.
 */
export const McpForbiddenError = McpError.extend({
  name: "MCP_FORBIDDEN",
  default: { code: McpErrorCodes.FORBIDDEN },
  message: "Forbidden",
});

export type McpForbiddenError = InstanceType<typeof McpForbiddenError>;
