/**
 * How an `$action` is served as an MCP tool, when `alepha/mcp` is registered
 * (the `mcp` option of `$action`).
 *
 * A plain type: `alepha/server` never imports `alepha/mcp`. The MCP module
 * finds the actions carrying it at start and lists them beside its `$tool`s.
 * The shapes below are those of the MCP specification (2025-11-25), the same
 * ones `$tool` takes.
 */
export interface ActionMcpOptions {
  /**
   * The tool's name. Defaults to the action's name. MCP's own rule applies,
   * which accepts dots, not the narrower one of the AI vendors.
   */
  name?: string;

  /**
   * Human-friendly display title, for tool pickers.
   */
  title?: string;

  /**
   * Behavior hints for the client. `GET` defaults to `readOnlyHint: true`
   * and `DELETE` to `destructiveHint: true`; what is set here wins.
   */
  annotations?: ActionMcpAnnotations;

  /**
   * Icons surfaced in client tool palettes.
   */
  icons?: Array<{
    src: string;
    mimeType?: string;
    sizes?: string[];
    theme?: "light" | "dark";
  }>;
}

/**
 * The tool annotations of the MCP specification (2025-03-26+): hints to the
 * client, never guarantees.
 */
export interface ActionMcpAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}
