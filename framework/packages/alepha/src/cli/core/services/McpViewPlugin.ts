import type * as vite from "vite";

/**
 * The Vite side of an MCP Apps view, `$tool({ ui: { view: () => import("./X.tsx") } })`.
 *
 * Three plugins, one AST walk:
 *
 * - {@link annotate}, on the app's load for the build and under `alepha dev`:
 *   writes the view's resolved source file on its `ui` options (under
 *   `Symbol.for("alepha.mcp.view.source")`), which is how `alepha build`
 *   finds the views to build and how the dev shell finds the module. It also
 *   serves the virtual entry the dev shell loads, `alepha-mcp-view?source=`.
 * - {@link entry}, in each view's own build: the same virtual entry, which
 *   mounts the component with `McpView.mount`.
 * - {@link embed}, in the server build: replaces each `view` thunk by one
 *   resolving to the view's built HTML, so React and the component stay out
 *   of the server bundle and a Worker serves the view with no file system.
 *
 * Modelled on `LazyControllerPlugin`, and unlike it not gated on
 * `ALEPHA_LAZY_CHUNKS`: a server build that holds a view always embeds it.
 */
export class McpViewPlugin {
  /**
   * The id of the virtual entry module of a view.
   */
  public static readonly ENTRY = "alepha-mcp-view";

  /**
   * Write each view's source file on its `ui` options, and serve the dev
   * shell's virtual entry.
   */
  public annotate(): vite.Plugin {
    const find = (context: McpViewPluginContext, code: string, id: string) =>
      this.sitesOf(context, code, id);
    const entryCode = (source: string) => this.entryCode(source);
    const entryOf = (id: string) => this.entrySource(id);
    const allow = (origin: unknown, dest: unknown) =>
      this.allowsCrossOrigin(origin, dest);
    const seen = () => this.hasViews;
    const saw = () => {
      this.hasViews = true;
    };
    return {
      name: "alepha:mcp-view-annotate",
      enforce: "pre",
      configureServer(server) {
        // A view under `alepha dev` loads its modules from this server into
        // the host's sandboxed iframe, another origin (`null` for a
        // `srcdoc`), and a cross-origin module script needs CORS. Opened only
        // once the app holds a view, only to what a module graph loads
        // (scripts, styles, fonts, images), and only to the null origin or
        // the origins MCP_VIEW_DEV_ORIGINS lists (a host's sandbox proxy).
        server.middlewares.use((req, res, next) => {
          const origin = req.headers.origin;
          if (seen() && allow(origin, req.headers["sec-fetch-dest"])) {
            res.setHeader("Access-Control-Allow-Origin", String(origin));
            res.setHeader("Vary", "Origin");
          }
          next();
        });
      },
      resolveId(id) {
        const source = entryOf(id);
        return source === undefined
          ? null
          : `\0${McpViewPlugin.ENTRY}?source=${encodeURIComponent(source)}`;
      },
      load(id) {
        const source = entryOf(id);
        return source === undefined ? null : entryCode(source);
      },
      async transform(code, id) {
        const views = find(this as unknown as McpViewPluginContext, code, id);
        if (views.length === 0) {
          return null;
        }
        saw();
        let out = code;
        for (const view of views.toReversed()) {
          const resolved = await this.resolve(view.source, id);
          if (!resolved?.id) {
            continue;
          }
          const file = resolved.id.split("?")[0];
          // After the last property, never before the closing brace: the
          // object may already end with a comma.
          out = `${out.slice(0, view.anchor)}, [Symbol.for("alepha.mcp.view.source")]: ${JSON.stringify(file)}${out.slice(view.anchor)}`;
        }
        return { code: out, map: null };
      },
    } as vite.Plugin & ThisType<McpViewPluginContext>;
  }

  /**
   * The virtual entry of one view's build, mounting `source`'s default
   * export.
   */
  public entry(source: string): vite.Plugin {
    const code = this.entryCode(source);
    return {
      name: "alepha:mcp-view-entry",
      resolveId(id) {
        return id === McpViewPlugin.ENTRY ? `\0${McpViewPlugin.ENTRY}` : null;
      },
      load(id) {
        return id === `\0${McpViewPlugin.ENTRY}` ? code : null;
      },
    };
  }

  /**
   * Replace each `view` thunk by one resolving to its built HTML, keyed by
   * the view's resolved source file. A view missing from `html` is left
   * alone: it then answers "not built" at run time rather than breaking the
   * build.
   */
  public embed(html: Map<string, string>): vite.Plugin {
    const find = (context: McpViewPluginContext, code: string, id: string) =>
      this.sitesOf(context, code, id);
    return {
      name: "alepha:mcp-view-embed",
      enforce: "pre",
      async transform(code, id) {
        const views = find(this as unknown as McpViewPluginContext, code, id);
        let out = code;
        let changed = false;
        for (const view of views.toReversed()) {
          const resolved = await this.resolve(view.source, id);
          const built = resolved?.id
            ? html.get(resolved.id.split("?")[0])
            : undefined;
          if (built === undefined) {
            continue;
          }
          out = `${out.slice(0, view.thunk.start)}() => Promise.resolve(${JSON.stringify(built)})${out.slice(view.thunk.end)}`;
          changed = true;
        }
        return changed ? { code: out, map: null } : null;
      },
    } as vite.Plugin & ThisType<McpViewPluginContext>;
  }

  // -------------------------------------------------------------------------------------------------------------------

  /**
   * The view declarations of a module: none for a file that cannot hold one
   * (a dependency, a non-script, no `$tool` or no `view`), or that does not
   * parse, which the build reports on its own a moment later.
   */
  protected sitesOf(
    context: McpViewPluginContext,
    code: string,
    id: string,
  ): McpViewSite[] {
    const path = id.split("?")[0];
    if (
      !/\.[cm]?[tj]sx?$/.test(path) ||
      path.includes("/node_modules/") ||
      !code.includes("$tool") ||
      !code.includes("view")
    ) {
      return [];
    }
    const lang = path.endsWith(".tsx")
      ? "tsx"
      : /\.[cm]?ts$/.test(path)
        ? "ts"
        : path.endsWith(".jsx")
          ? "jsx"
          : "js";
    try {
      return this.findViews(
        context.parse(code, {
          lang,
          astType: lang.startsWith("ts") ? "ts" : "js",
        }),
      );
    } catch {
      return [];
    }
  }

  /**
   * The entry module of a view: mount its default export.
   */
  public entryCode(source: string): string {
    return [
      `import * as view from ${JSON.stringify(source)};`,
      `import { McpView } from "alepha/mcp/view";`,
      "McpView.mount(view);",
    ].join("\n");
  }

  /**
   * Whether a module of the app was seen declaring a view: until then the
   * dev server opens nothing to another origin.
   */
  public hasViews = false;

  /**
   * Whether a dev server response may be read by a view in another origin:
   * a script, a stylesheet, a font or an image (never a `fetch`), requested
   * from the null origin of a sandboxed `srcdoc` iframe or from an origin
   * `MCP_VIEW_DEV_ORIGINS` lists (comma-separated, for a host whose sandbox
   * is served from a proxy origin).
   *
   * ⚠️ Dev only, and only while the app holds a view: a page that frames a
   * null-origin iframe can then import the app's modules from the dev
   * server, as a view does.
   */
  public allowsCrossOrigin(origin: unknown, dest: unknown): boolean {
    if (typeof origin !== "string" || !origin) {
      return false;
    }
    if (
      dest !== "script" &&
      dest !== "style" &&
      dest !== "font" &&
      dest !== "image"
    ) {
      return false;
    }
    if (origin === "null") {
      return true;
    }
    const listed = String(process.env.MCP_VIEW_DEV_ORIGINS ?? "")
      .split(",")
      .map((it) => it.trim())
      .filter(Boolean);
    return listed.includes(origin);
  }

  /**
   * The source a virtual entry id names, or `undefined` when it is not one.
   */
  protected entrySource(id: string): string | undefined {
    const bare = id.startsWith("\0") ? id.slice(1) : id;
    const prefix = `${McpViewPlugin.ENTRY}?source=`;
    return bare.startsWith(prefix)
      ? decodeURIComponent(bare.slice(prefix.length))
      : undefined;
  }

  /**
   * Every `view: () => import("...")` inside the `ui` object of a `$tool(...)`
   * call: the `ui` object node, the thunk node and the import specifier.
   */
  public findViews(ast: any): McpViewSite[] {
    const found: McpViewSite[] = [];
    const visit = (node: any): void => {
      if (!node || typeof node !== "object") {
        return;
      }
      if (Array.isArray(node)) {
        for (const child of node) visit(child);
        return;
      }
      if (typeof node.type !== "string") {
        return;
      }
      if (
        node.type === "CallExpression" &&
        node.callee?.type === "Identifier" &&
        node.callee.name === "$tool" &&
        node.arguments?.[0]?.type === "ObjectExpression"
      ) {
        const ui = this.property(node.arguments[0], "ui");
        if (ui?.type === "ObjectExpression") {
          const thunk = this.property(ui, "view");
          if (
            (thunk?.type === "ArrowFunctionExpression" ||
              thunk?.type === "FunctionExpression") &&
            thunk.params.length === 0 &&
            thunk.body?.type === "ImportExpression" &&
            typeof thunk.body.source?.value === "string"
          ) {
            found.push({
              anchor: ui.properties[ui.properties.length - 1].end,
              thunk,
              source: thunk.body.source.value,
            });
          }
        }
      }
      for (const key of Object.keys(node)) {
        if (key === "type" || key === "start" || key === "end") continue;
        visit(node[key]);
      }
    };
    visit(ast);
    return found;
  }

  protected property(object: any, name: string): any {
    for (const property of object.properties ?? []) {
      if (property.type !== "Property" || property.computed) continue;
      const key =
        property.key?.type === "Identifier"
          ? property.key.name
          : property.key?.value;
      if (key === name) {
        return property.value;
      }
    }
    return undefined;
  }
}

/**
 * One view declaration found in a module.
 */
export interface McpViewSite {
  /**
   * Where a property is added to the `ui: { ... }` object: the end of its
   * last property.
   */
  anchor: number;
  /**
   * The `() => import("...")` thunk.
   */
  thunk: { start: number; end: number };
  /**
   * The import specifier, as written.
   */
  source: string;
}

/**
 * The slice of the bundler's plugin context the transforms use.
 */
interface McpViewPluginContext {
  parse: (code: string, options?: unknown) => any;
  resolve: (
    source: string,
    importer: string,
  ) => Promise<{ id: string } | null | undefined>;
}
