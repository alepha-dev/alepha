/**
 * The MCP Apps extension's id (SEP-1865, spec 2026-01-26), declared under
 * `capabilities.extensions` once a UI resource is registered.
 */
export const MCP_APPS_EXTENSION = "io.modelcontextprotocol/ui";

/**
 * The MIME type of an MCP Apps view: HTML a host renders in a sandboxed
 * iframe. A `ui://` resource serves it by default.
 */
export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";
