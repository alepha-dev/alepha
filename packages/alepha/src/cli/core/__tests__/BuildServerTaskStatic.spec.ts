import { Alepha } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, it } from "vitest";

import { ViteUtils } from "../services/ViteUtils.ts";
import { BuildServerTask } from "../tasks/BuildServerTask.ts";
import type { BuildTaskContext } from "../tasks/BuildTask.ts";

/**
 * Records which slices would have been linked, without running Vite.
 */
class RecordingServerTask extends BuildServerTask {
  public linked: string[] = [];

  protected override async buildServer(opts: { runtime: string }): Promise<{
    entryFile: string;
    externals: string[];
  }> {
    this.linked.push(opts.runtime);
    return { entryFile: "index.js", externals: [] };
  }

  protected override async readSsrManifest(): Promise<any> {
    return {
      viteDir: "/project/dist/public/.vite",
      data: { favicon: "image/svg+xml:/favicon.svg" },
      statement: "",
    };
  }
}

class FakeViteUtils extends ViteUtils {
  public override async importVite(): Promise<any> {
    return { resolveConfig: async () => ({ base: "/" }) };
  }
}

describe("BuildServerTask, for a static build", () => {
  const setup = async () => {
    const alepha = Alepha.create()
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ViteUtils, use: FakeViteUtils });
    const fs = alepha.inject(MemoryFileSystemProvider);
    await fs.mkdir("/project/dist/public/.vite", { recursive: true });
    await fs.writeFile("/project/dist/public/index.html", "<html></html>");
    const app = Alepha.create();
    const ctx = {
      alepha: app,
      options: { runtime: "static", runtimes: [] },
      run: (task: any) => task.handler(),
      root: "/project",
      entry: { root: "/project", server: "src/main.server.ts" },
      hasClient: true,
      manifest: null,
      flags: {},
    } as unknown as BuildTaskContext;
    return { task: alepha.inject(RecordingServerTask), fs, app, ctx };
  };

  it("links no server slice at all", async ({ expect }) => {
    // `[] ?? runtime` is `[]`, which used to resolve to the default node
    // slice: every static build compiled server code the static task then
    // deleted, and a server-only compile error broke a build with no server.
    const { task, ctx } = await setup();

    await task.run(ctx);

    expect(task.linked).toEqual([]);
  });

  it("still hands the renderer the client manifests and clears the client index", async ({
    expect,
  }) => {
    // The static task renders `/` in this process, and that render reads the
    // entry assets from the SSR manifest the server step used to install.
    const { task, fs, app, ctx } = await setup();

    await task.run(ctx);

    expect(app.store.get("alepha.react.ssr.manifest" as any)).toEqual({
      favicon: "image/svg+xml:/favicon.svg",
    });
    expect(await fs.exists("/project/dist/public/index.html")).toBe(false);
  });

  it("still links the declared slice for a server build", async ({
    expect,
  }) => {
    const { task, ctx } = await setup();

    await task.run({
      ...ctx,
      options: { runtime: "bun", runtimes: ["bun"] },
    } as BuildTaskContext);

    expect(task.linked).toEqual(["bun"]);
  });
});
