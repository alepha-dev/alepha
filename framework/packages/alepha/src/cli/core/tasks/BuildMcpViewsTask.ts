import { $inject, AlephaError } from "alepha";
import { $logger } from "alepha/logger";
import type * as vite from "vite";

import { BuildSlices } from "../services/BuildSlices.ts";
import { McpViewPlugin } from "../services/McpViewPlugin.ts";
import { ViteUtils } from "../services/ViteUtils.ts";
import { BuildTask, type BuildTaskContext } from "./BuildTask.ts";

/**
 * Build every MCP Apps view of the app, `$tool({ ui: { view } })`, into one
 * self-contained HTML document, before the server bundle embeds it.
 *
 * The views are the build list's tools marked `view` (`ctx.surface`); each
 * one's source file is what the load's `McpViewPlugin.annotate` wrote on its
 * `ui` options. One Vite build per view, the app's own Vite config included
 * (Tailwind, aliases), with every script, stylesheet and asset inlined: a
 * host renders the view in a sandboxed iframe that loads nothing else, and a
 * Worker serves it with no file system. The HTML lands on `ctx.mcpViews`,
 * keyed by source file, for `BuildServerTask`.
 */
export class BuildMcpViewsTask extends BuildTask {
  protected readonly log = $logger();
  protected readonly viteUtils = $inject(ViteUtils);
  protected readonly plugin = $inject(McpViewPlugin);
  protected readonly slices = $inject(BuildSlices);

  async run(ctx: BuildTaskContext): Promise<void> {
    if (ctx.flags?.prebuilt || !ctx.alepha) {
      return;
    }
    if (this.slices.fromOptions(ctx.options).length === 0) {
      return;
    }
    const sources = this.sourcesOf(ctx);
    if (sources.size === 0) {
      return;
    }
    await ctx.run({
      name: `build mcp views (${sources.size})`,
      handler: async () => {
        const html = new Map<string, string>();
        for (const source of new Set(sources.values())) {
          html.set(source, await this.buildView(ctx.root, source));
        }
        ctx.mcpViews = html;
      },
    });
  }

  /**
   * The source file of each tool's view, by tool name.
   */
  public sourcesOf(ctx: BuildTaskContext): Map<string, string> {
    const named = new Set(
      (ctx.surface?.tools ?? []).filter((it) => it.view).map((it) => it.name),
    );
    const sources = new Map<string, string>();
    if (named.size === 0) {
      return sources;
    }
    for (const tool of ctx.alepha.primitives("$tool") as any[]) {
      if (!named.has(tool.name)) {
        continue;
      }
      const source = tool.options?.ui?.[Symbol.for("alepha.mcp.view.source")];
      if (typeof source !== "string") {
        throw new AlephaError(
          `The view of MCP tool '${tool.name}' could not be located: declare it as \`ui: { view: () => import("./View.tsx") }\` inside the \`$tool({ ... })\` call`,
        );
      }
      sources.set(tool.name, source);
    }
    return sources;
  }

  /**
   * One view, built and inlined into one HTML document.
   */
  public async buildView(root: string, source: string): Promise<string> {
    const { build } = await this.viteUtils.importVite();
    const viteReact = await this.viteUtils.importViteReact();
    const plugins: any[] = [];
    if (viteReact) plugins.push(viteReact());
    plugins.push(this.viteUtils.createTsconfigPathsPlugin());
    plugins.push(this.plugin.entry(source));

    const logger = this.viteUtils.createBufferedLogger();
    let result: vite.Rollup.RollupOutput | vite.Rollup.RollupOutput[];
    try {
      result = (await build({
        root,
        mode: "production",
        logLevel: "silent",
        customLogger: logger,
        publicDir: false,
        define: { "process.env.NODE_ENV": '"production"' },
        resolve: {
          dedupe: [
            "react",
            "react-dom",
            "react/jsx-runtime",
            "react/jsx-dev-runtime",
          ],
        },
        plugins,
        build: {
          write: false,
          minify: true,
          copyPublicDir: false,
          cssCodeSplit: false,
          modulePreload: false,
          // Everything inline: the iframe loads nothing but this document.
          assetsInlineLimit: Number.MAX_SAFE_INTEGER,
          chunkSizeWarningLimit: 100_000,
          rolldownOptions: {
            input: McpViewPlugin.ENTRY,
            output: { format: "esm", codeSplitting: false },
          },
        },
      } as vite.InlineConfig)) as
        | vite.Rollup.RollupOutput
        | vite.Rollup.RollupOutput[];
    } catch (error) {
      logger.flush();
      throw error;
    }
    return this.document(Array.isArray(result) ? result : [result]);
  }

  /**
   * The HTML document holding a view's script and styles.
   */
  public document(outputs: vite.Rollup.RollupOutput[]): string {
    const scripts: string[] = [];
    const styles: string[] = [];
    for (const output of outputs) {
      for (const item of output.output) {
        if (item.type === "chunk") {
          scripts.push(item.code);
        } else if (item.fileName.endsWith(".css")) {
          styles.push(
            typeof item.source === "string"
              ? item.source
              : new TextDecoder().decode(item.source),
          );
        }
      }
    }
    // A `</script>` or `</style>` inside the code would close the element.
    const script = scripts.join("\n").replace(/<\/(script)/gi, "<\\/$1");
    const style = styles.join("\n").replace(/<\/(style)/gi, "<\\/$1");
    return [
      "<!doctype html>",
      '<html lang="en"><head><meta charset="utf-8" />',
      '<meta name="viewport" content="width=device-width, initial-scale=1" />',
      style ? `<style>${style}</style>` : "",
      '</head><body><div id="root"></div>',
      `<script type="module">${script}</script>`,
      "</body></html>",
    ]
      .filter(Boolean)
      .join("\n");
  }
}
