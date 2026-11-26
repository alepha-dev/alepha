import { createRequire } from "node:module";

import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { McpViewPlugin } from "../services/McpViewPlugin.ts";
import { BuildMcpViewsTask } from "../tasks/BuildMcpViewsTask.ts";

const { parseAst } = createRequire(import.meta.url)("vite") as {
  parseAst: (code: string) => any;
};

/**
 * A plugin context resolving `./X.tsx` next to `/app/src/`.
 */
const context = {
  parse: (code: string) => parseAst(code),
  resolve: async (source: string) => ({
    id: `/app/src/${source.replace(/^\.\//, "")}`,
  }),
};

const transform = async (plugin: any, code: string, id: string) =>
  (await plugin.transform.call(context, code, id))?.code as string | undefined;

const TOOLS = [
  'import { $tool } from "alepha/mcp";',
  "export class Tools {",
  "  chart = $tool({",
  '    description: "A chart",',
  '    ui: { view: () => import("./Chart.tsx"), },',
  '    handler: async () => "ok",',
  "  });",
  "  plain = $tool({",
  '    description: "No view",',
  '    ui: { resource: "ui://x" },',
  '    handler: async () => "ok",',
  "  });",
  "}",
].join("\n");

/**
 * MCP Apps views at build time: found in `$tool({ ui: { view } })`, annotated
 * with their source on load, embedded as HTML in the server bundle.
 */
describe("McpViewPlugin", () => {
  it("finds only a ui.view thunk importing a module, inside a $tool call", ({
    expect,
  }) => {
    const plugin = Alepha.create().inject(McpViewPlugin);

    const sites = plugin.findViews(parseAst(TOOLS));

    expect(sites.map((it) => it.source)).toEqual(["./Chart.tsx"]);
  });

  it("writes the resolved source on the ui options, trailing comma or not", async ({
    expect,
  }) => {
    const plugin = Alepha.create().inject(McpViewPlugin);

    const out = await transform(plugin.annotate(), TOOLS, "/app/src/Tools.ts");

    expect(out).toContain(
      'view: () => import("./Chart.tsx"), [Symbol.for("alepha.mcp.view.source")]: "/app/src/Chart.tsx",',
    );
    expect(() => parseAst(out!)).not.toThrow();
    expect(out).toContain('ui: { resource: "ui://x" }');
  });

  it("leaves a dependency and a module with no view alone", async ({
    expect,
  }) => {
    const plugin = Alepha.create().inject(McpViewPlugin);
    const annotate = plugin.annotate();

    expect(
      await transform(annotate, TOOLS, "/app/node_modules/x/Tools.js"),
    ).toBeUndefined();
    expect(
      await transform(annotate, "export const a = 1;", "/app/src/a.ts"),
    ).toBeUndefined();
  });

  it("embeds the built HTML in place of the import, so the component leaves the bundle", async ({
    expect,
  }) => {
    const plugin = Alepha.create().inject(McpViewPlugin);
    const html = new Map([["/app/src/Chart.tsx", "<!doctype html><p>x</p>"]]);

    const out = await transform(plugin.embed(html), TOOLS, "/app/src/Tools.ts");

    expect(out).toContain(
      'view: () => Promise.resolve("<!doctype html><p>x</p>")',
    );
    expect(out).not.toContain("./Chart.tsx");
  });

  it("serves a view's virtual entry, mounting its default export", async ({
    expect,
  }) => {
    const plugin = Alepha.create().inject(McpViewPlugin);
    const annotate = plugin.annotate() as any;

    const id = annotate.resolveId("alepha-mcp-view?source=%2Fapp%2FChart.tsx");
    expect(id).toBe("\0alepha-mcp-view?source=%2Fapp%2FChart.tsx");
    const code = annotate.load(id);
    expect(code).toContain('import * as view from "/app/Chart.tsx";');
    expect(code).toContain("McpView.mount(view);");
  });

  it("opens module loads to a sandboxed view's null origin only, never a fetch", ({
    expect,
  }) => {
    const plugin = Alepha.create().inject(McpViewPlugin);

    expect(plugin.allowsCrossOrigin("null", "script")).toBe(true);
    expect(plugin.allowsCrossOrigin("null", "style")).toBe(true);
    expect(plugin.allowsCrossOrigin("null", "empty")).toBe(false);
    expect(plugin.allowsCrossOrigin("https://evil.example", "script")).toBe(
      false,
    );
    expect(plugin.allowsCrossOrigin(undefined, "script")).toBe(false);
  });

  it("opens nothing until a module declared a view", async ({ expect }) => {
    const plugin = Alepha.create().inject(McpViewPlugin);
    const annotate = plugin.annotate();

    expect(plugin.hasViews).toBe(false);
    await transform(annotate, "export const a = 1;", "/app/src/a.ts");
    expect(plugin.hasViews).toBe(false);
    await transform(annotate, TOOLS, "/app/src/Tools.ts");
    expect(plugin.hasViews).toBe(true);
  });
});

describe("BuildMcpViewsTask", () => {
  it("inlines scripts and styles into one document, escaping their closing tags", ({
    expect,
  }) => {
    const task = Alepha.create().inject(BuildMcpViewsTask);

    const html = task.document([
      {
        output: [
          { type: "chunk", code: 'console.log("</script>")' },
          {
            type: "asset",
            fileName: "a.css",
            source: "p::after{content:'</style>'}",
          },
        ],
      } as any,
    ]);

    expect(html).toContain(
      '<script type="module">console.log("<\\/script>")</script>',
    );
    expect(html).toContain("<style>p::after{content:'<\\/style>'}</style>");
    expect(html).toContain('<div id="root"></div>');
  });
});
