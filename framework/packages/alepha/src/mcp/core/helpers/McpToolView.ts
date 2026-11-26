import type { Alepha } from "alepha";
import { ServerProvider } from "alepha/server";

import { McpViewNotBuiltError } from "../errors/McpError.ts";
import type {
  McpCacheHints,
  McpResourceDescriptor,
  McpUiResourceMeta,
  ResourceContent,
} from "../interfaces/McpTypes.ts";
import { MCP_APP_MIME_TYPE } from "./mcpApps.ts";

/**
 * The `ui://` resource of a `$tool({ ui: { view } })`: the tool's React view,
 * served as one HTML document.
 *
 * What `view()` resolves to says how far the app was built:
 *
 * - a **string**: `alepha build` built the view into one self-contained HTML
 *   file and embedded it in the server bundle in place of the import. Served
 *   as is, on Node and on Workers alike.
 * - a **module**: nothing built it (vitest, `node` on the sources). Under
 *   `alepha dev`, the view is a shell loading the module from the Vite dev
 *   server, whose origin is added to the CSP; anywhere else, reading it is a
 *   {@link McpViewNotBuiltError}.
 *
 * Listed and read like any `$resource`, by the same provider.
 */
export class McpToolView {
  /**
   * Where the build and the dev server write the view's source file, on its
   * `ui` options. Read by `alepha build` to find the views, and by the dev
   * shell to load the module.
   */
  public static readonly SOURCE = Symbol.for("alepha.mcp.view.source");

  /**
   * The `ui://` URI a tool's view is served under.
   */
  public static uriOf(tool: string): string {
    return `ui://tools/${tool}`;
  }

  public readonly uri: string;
  public readonly mimeType = MCP_APP_MIME_TYPE;
  public readonly isUi = true;
  public readonly readCache: McpCacheHints = {
    ttlMs: 0,
    cacheScope: "private",
  };

  protected readonly alepha: Alepha;
  public readonly tool: string;
  protected readonly view: () => Promise<unknown>;
  protected readonly meta: McpUiResourceMeta | undefined;
  protected readonly source: string | undefined;

  constructor(options: {
    alepha: Alepha;
    tool: string;
    view: () => Promise<unknown>;
    meta?: McpUiResourceMeta;
    source?: string;
  }) {
    this.alepha = options.alepha;
    this.tool = options.tool;
    this.view = options.view;
    this.meta = options.meta;
    this.source = options.source;
    this.uri = McpToolView.uriOf(options.tool);
  }

  public get name(): string {
    return `${this.tool} view`;
  }

  /**
   * The view's `_meta.ui`: the tool's `ui.meta`, plus the dev server's origin
   * in `resourceDomains` and `connectDomains` while `alepha dev` serves it.
   */
  public get uiMeta(): Record<string, unknown> | undefined {
    const meta: McpUiResourceMeta = { ...this.meta };
    const origin = this.devOrigin();
    if (origin) {
      const socket = origin.replace(/^http/, "ws");
      meta.csp = {
        ...meta.csp,
        resourceDomains: this.union(meta.csp?.resourceDomains, [origin]),
        connectDomains: this.union(meta.csp?.connectDomains, [origin, socket]),
      };
    }
    return Object.keys(meta).length > 0
      ? (meta as Record<string, unknown>)
      : undefined;
  }

  /**
   * The `_meta` of the read content: the view's `ui`, when it has one.
   */
  public get contentMeta(): Record<string, unknown> | undefined {
    const ui = this.uiMeta;
    return ui ? { ui } : undefined;
  }

  public toDescriptor(): McpResourceDescriptor {
    const ui = this.uiMeta;
    return {
      uri: this.uri,
      name: this.name,
      description: `The view of the ${this.tool} tool`,
      mimeType: this.mimeType,
      ...(ui ? { _meta: { ui } } : {}),
    };
  }

  public async read(): Promise<ResourceContent> {
    const loaded = await this.view();
    if (typeof loaded === "string") {
      return { text: loaded };
    }
    const origin = this.devOrigin();
    if (origin && this.source) {
      return { text: this.devShell(origin, this.source) };
    }
    throw new McpViewNotBuiltError({ tool: this.tool });
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * The origin of the Vite dev server under `alepha dev`, `undefined`
   * anywhere else.
   */
  protected devOrigin(): string | undefined {
    if (!this.alepha.isViteDev() || !this.source) {
      return undefined;
    }
    try {
      return new URL(this.alepha.inject(ServerProvider).hostname).origin;
    } catch {
      return undefined;
    }
  }

  /**
   * A document loading the view from the dev server: React Refresh's
   * preamble, Vite's client, then the view's entry, which the dev plugin
   * serves as a virtual module mounting the component.
   */
  protected devShell(origin: string, source: string): string {
    const entry = `${origin}/@id/__x00__alepha-mcp-view?source=${encodeURIComponent(source)}`;
    return [
      "<!doctype html>",
      '<html><head><meta charset="utf-8" />',
      '<meta name="viewport" content="width=device-width, initial-scale=1" />',
      '<script type="module">',
      `import RefreshRuntime from "${origin}/@react-refresh";`,
      "RefreshRuntime.injectIntoGlobalHook(window);",
      "window.$RefreshReg$ = () => {};",
      "window.$RefreshSig$ = () => (type) => type;",
      "window.__vite_plugin_react_preamble_installed__ = true;",
      "</script>",
      `<script type="module" src="${origin}/@vite/client"></script>`,
      `<script type="module" src="${entry}"></script>`,
      '</head><body><div id="root"></div></body></html>',
    ].join("\n");
  }

  protected union(a: string[] | undefined, b: string[]): string[] {
    return [...new Set([...(a ?? []), ...b])];
  }
}
