import { Alepha, z } from "alepha";
import { AlephaServer } from "alepha/server";
import { describe, it } from "vitest";

import {
  $resource,
  $tool,
  AlephaMcp,
  MCP_APP_MIME_TYPE,
  MCP_APPS_EXTENSION,
  McpServerProvider,
} from "../index.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * `$tool({ ui: { view } })`: the tool's own view, served as
 * `ui://tools/<name>`. A view `alepha build` embedded resolves to its HTML;
 * an unbuilt one (here, under vitest) is a module, and reading it outside
 * `alepha dev` is a clear error.
 */

const BUILT = "<!doctype html><div id=root></div>";

class Views {
  built = $tool({
    description: "A tool whose view was built",
    schema: { result: z.object({ total: z.number() }) },
    ui: {
      view: () => Promise.resolve(BUILT),
      meta: { prefersBorder: true },
      visibility: ["model", "app"],
    },
    handler: async () => ({ total: 3 }),
  });

  unbuilt = $tool({
    description: "A tool whose view nothing built",
    ui: { view: () => Promise.resolve({ default: () => null }) },
    handler: async () => "ok",
  });
}

const start = async (app: new () => object, env: Record<string, any> = {}) => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "error", ...env } })
    .with(AlephaServer)
    .with(AlephaMcp)
    .with(app);
  await alepha.start();
  const mcp = alepha.inject(McpServerProvider);
  const send = (method: string, params: Record<string, unknown> = {}) =>
    mcp.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }) as Promise<any>;
  return { alepha, mcp, send };
};

describe("MCP Apps views", () => {
  it("links the tool to ui://tools/<name>, listed as an MCP Apps resource", async ({
    expect,
  }) => {
    const { alepha, mcp, send } = await start(Views);

    const tools = (await send("tools/list")).result.tools;
    expect(tools.find((it: any) => it.name === "built")._meta).toEqual({
      ui: { resourceUri: "ui://tools/built", visibility: ["model", "app"] },
    });
    const resources = (await send("resources/list")).result.resources;
    expect(resources).toEqual([
      expect.objectContaining({
        uri: "ui://tools/built",
        mimeType: MCP_APP_MIME_TYPE,
        _meta: { ui: { prefersBorder: true } },
      }),
      expect.objectContaining({ uri: "ui://tools/unbuilt" }),
    ]);
    expect(mcp.hasExtension(MCP_APPS_EXTENSION)).toBe(true);
    expect(mcp.getCapabilities().resources).toEqual({});
    await alepha.stop();
  });

  it("serves a built view's HTML", async ({ expect }) => {
    const { alepha, send } = await start(Views);

    const read = await send("resources/read", { uri: "ui://tools/built" });

    expect(read.result.contents).toEqual([
      {
        uri: "ui://tools/built",
        mimeType: MCP_APP_MIME_TYPE,
        text: BUILT,
        _meta: { ui: { prefersBorder: true } },
      },
    ]);
    await alepha.stop();
  });

  it("answers a clear error for an unbuilt view outside alepha dev", async ({
    expect,
  }) => {
    const { alepha, send } = await start(Views);

    const read = await send("resources/read", { uri: "ui://tools/unbuilt" });

    expect(read.error.message).toContain(
      'The view of tool "unbuilt" is not built',
    );
    await alepha.stop();
  });

  it("serves an unbuilt view as a dev shell under alepha dev, its origin in the CSP", async ({
    expect,
  }) => {
    class DevViews {
      chart = $tool({
        description: "A view loaded from the dev server",
        ui: {
          view: () => Promise.resolve({ default: () => null }),
          meta: { csp: { connectDomains: ["https://api.example.app"] } },
          [Symbol.for("alepha.mcp.view.source")]: "/app/src/Chart.tsx",
        } as any,
        handler: async () => "ok",
      });
    }
    const { alepha, send } = await start(DevViews, {
      VITE_ALEPHA_DEV: true,
      SERVER_PORT: 3999,
    });

    const read = await send("resources/read", { uri: "ui://tools/chart" });

    const content = read.result.contents[0];
    expect(content._meta.ui.csp).toEqual({
      connectDomains: [
        "https://api.example.app",
        "http://localhost:3999",
        "ws://localhost:3999",
      ],
      resourceDomains: ["http://localhost:3999"],
    });
    expect(content.text).toContain(
      '<script type="module" src="http://localhost:3999/@vite/client"></script>',
    );
    expect(content.text).toContain(
      "http://localhost:3999/@id/__x00__alepha-mcp-view?source=%2Fapp%2Fsrc%2FChart.tsx",
    );
    await alepha.stop();
  });

  it("refuses a tool declaring both a view and a resource, or neither", async ({
    expect,
  }) => {
    class Both {
      chart = $resource({
        uri: "ui://charts/a",
        handler: async () => ({ text: BUILT }),
      });

      both = $tool({
        description: "Both",
        ui: { view: () => Promise.resolve(BUILT), resource: this.chart },
        handler: async () => "ok",
      });
    }
    class Neither {
      neither = $tool({
        description: "Neither",
        ui: {},
        handler: async () => "ok",
      });
    }

    await expect(start(Both)).rejects.toThrow(
      "declares both ui.view and ui.resource",
    );
    await expect(start(Neither)).rejects.toThrow(
      "declares ui without a view or a resource",
    );
  });
});
