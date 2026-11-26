import { defineConfig } from "alepha/cli/config";

/**
 * An MCP server with one MCP Apps view: `sales_report` answers in text and
 * shows a chart in a host that supports `io.modelcontextprotocol/ui`.
 */
export default defineConfig({
  // The 33xx band is the dev servers'; 3317 is this app's.
  dev: { port: 3317 },
});
