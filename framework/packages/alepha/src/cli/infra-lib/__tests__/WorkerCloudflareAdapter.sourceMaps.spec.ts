import { Alepha } from "alepha";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, it } from "vitest";

import type { InfraContext } from "../adapters/InfraAdapter.ts";
import { WorkerCloudflareAdapter } from "../adapters/WorkerCloudflareAdapter.ts";
import { NamingService } from "../services/NamingService.ts";

/**
 * Source maps in the API upload (#Q3061).
 *
 * wrangler 4.150+ uploads them by default, and Cloudflare remaps the stack
 * traces of Workers Logs, Tail Workers and Workers Issues with them. The API
 * deploy uploaded `.js` only, so every Alepha and Lore Worker reported bundled
 * frames.
 */
describe("WorkerCloudflareAdapter source maps", () => {
  const setup = () => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider });
    const adapter = alepha.inject(WorkerCloudflareAdapter);
    adapter.use({ apiToken: "estate-token", accountId: "estate-account" });

    const calls: Array<Record<string, any>> = [];
    Object.assign(adapter as unknown as Record<string, unknown>, {
      deployer: () => ({
        deploy: async (plan: Record<string, any>) => {
          calls.push(plan);
          return { versionId: "v1" };
        },
        getSubdomain: async () => "acme",
      }),
    });

    const naming = alepha.inject(NamingService);
    const ctx = {
      project: "my-app",
      env: "staging",
      options: {},
      root: "/deploy",
      entry: { root: "/deploy", server: "" },
      naming: naming.forContext("my-app", "staging"),
      resources: {
        hasDatabase: false,
        hasBucket: false,
        hasAnalytics: false,
        hasKV: false,
        hasQueue: false,
        hasCron: false,
      },
    } as InfraContext<any>;

    return {
      adapter,
      fs: alepha.inject(MemoryFileSystemProvider),
      calls,
      deploy: () => adapter.deploy(ctx, run),
    };
  };

  type Task = { name: string; handler: () => Promise<void> };
  const run = Object.assign(
    async (task: Task | Task[]) => {
      await Promise.all(
        (Array.isArray(task) ? task : [task]).map((it) => it.handler()),
      );
    },
    { end: () => {} },
  ) as never;

  const artifact = async (
    fs: MemoryFileSystemProvider,
    extra: Record<string, unknown> = {},
  ) => {
    await fs.writeFile(
      "/deploy/wrangler.jsonc",
      JSON.stringify({
        name: "my-app",
        main: "./main.cloudflare.js",
        compatibility_date: "2025-11-17",
        rules: [
          {
            type: "ESModule",
            globs: ["index.workerd.js", "server/workerd/*.js"],
          },
        ],
        ...extra,
      }),
    );
    await fs.writeFile("/deploy/main.cloudflare.js", "export default {};");
    await fs.writeFile(
      "/deploy/index.workerd.js",
      "export const a = 1;\n//# sourceMappingURL=index.workerd.js.map\n",
    );
    await fs.writeFile(
      "/deploy/index.workerd.js.map",
      JSON.stringify({
        version: 3,
        file: "index.workerd.js",
        sources: ["../src/main.ts"],
        mappings: "AAAA",
      }),
    );
    await fs.writeFile(
      "/deploy/server/workerd/chunk.js",
      "export const w = 1;\n//# sourceMappingURL=chunk.js.map\n",
    );
    await fs.writeFile(
      "/deploy/server/workerd/chunk.js.map",
      JSON.stringify({
        version: 3,
        sources: ["../../../src/chunk.ts", "./local.ts"],
        mappings: "AAAA",
      }),
    );
    // The node slice's own map: never uploaded, as its chunk is not.
    await fs.writeFile(
      "/deploy/server/node/chunk.js",
      "export const n = 1;\n//# sourceMappingURL=chunk.js.map\n",
    );
    await fs.writeFile("/deploy/server/node/chunk.js.map", "{}");
  };

  const maps = (plan: Record<string, any>) =>
    (plan.modules as Array<{ name: string; bytes: Uint8Array; type?: string }>)
      .filter((it) => it.type === "application/source-map")
      .map((it) => ({
        name: it.name,
        map: JSON.parse(new TextDecoder().decode(it.bytes)),
      }));

  it("uploads each workerd module's map as its own source-map part", async ({
    expect,
  }) => {
    const { fs, calls, deploy } = setup();
    await artifact(fs);

    await deploy();

    const uploaded = maps(calls[0]!);
    expect(uploaded.map((it) => it.name).sort()).toEqual([
      "index.workerd.js.map",
      "server/workerd/chunk.js.map",
    ]);
    // wrangler's normalisation: `file` is the module, sources lose `./`, `../`.
    const chunk = uploaded.find(
      (it) => it.name === "server/workerd/chunk.js.map",
    )!;
    expect(chunk.map.file).toBe("server/workerd/chunk.js");
    expect(chunk.map.sources).toEqual(["src/chunk.ts", "local.ts"]);
  });

  it("uploads none with upload_source_maps: false", async ({ expect }) => {
    const { fs, calls, deploy } = setup();
    await artifact(fs, { upload_source_maps: false });

    await deploy();

    expect(maps(calls[0]!)).toEqual([]);
  });

  it("accepts upload_source_maps as a config key rather than refusing it", async ({
    expect,
  }) => {
    const { fs, calls, deploy } = setup();
    await artifact(fs, { upload_source_maps: true });

    await deploy();

    expect(maps(calls[0]!)).toHaveLength(2);
  });

  it("uploads a module whose map is missing or unreadable without one, and still deploys", async ({
    expect,
  }) => {
    const { fs, calls, deploy } = setup();
    await artifact(fs);
    // A Lore artifact keeps its maps in a separate archive (#Q1515).
    await fs.rm("/deploy/index.workerd.js.map");
    await fs.writeFile("/deploy/server/workerd/chunk.js.map", "not json");

    await deploy();

    const names = (calls[0]!.modules as Array<{ name: string }>).map(
      (it) => it.name,
    );
    expect(names).toContain("index.workerd.js");
    expect(names).toContain("server/workerd/chunk.js");
    expect(maps(calls[0]!)).toEqual([]);
  });

  it("refuses the deploy over a missing map with upload_source_maps: true, as wrangler's strict mode", async ({
    expect,
  }) => {
    const { fs, calls, deploy } = setup();
    await artifact(fs, { upload_source_maps: true });
    await fs.rm("/deploy/index.workerd.js.map");

    await expect(deploy()).rejects.toThrow(
      /upload_source_maps is true, and 1 module\(s\) have no usable source map: index\.workerd\.js/,
    );
    expect(calls).toHaveLength(0);
  });
});
