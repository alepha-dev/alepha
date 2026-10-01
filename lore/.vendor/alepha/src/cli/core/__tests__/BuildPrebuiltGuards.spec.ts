import { Alepha } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, expect, it } from "vitest";

import type { BuildOptions } from "../atoms/buildOptions.ts";
import type { AppEntry } from "../providers/AppEntryProvider.ts";
import { BuildStaticTask } from "../tasks/BuildStaticTask.ts";
import type { BuildTaskContext } from "../tasks/BuildTask.ts";

describe("--prebuilt guards", () => {
  // In prebuilt/manifest mode `ctx.alepha` is null: there is no live app to
  // introspect. Neither task checked, so the build died on a TypeError that
  // named nothing the user could act on.
  const createCtx = (runtime: string): BuildTaskContext =>
    ({
      alepha: null as any,
      // ⚠️ A runtime, not a target. The build is described by what it
      // produces, and `static` is the declaration for "no server at all".
      options: { runtime } as BuildOptions,
      run: (async (cmd: any) => {
        if (typeof cmd === "object" && cmd.handler) await cmd.handler();
        return "";
      }) as BuildTaskContext["run"],
      root: "/project",
      entry: { server: "/project/src/server.ts" } as AppEntry,
      hasClient: false,
      manifest: null,
      flags: { prebuilt: true },
    }) as unknown as BuildTaskContext;

  const create = () => {
    const alepha = Alepha.create().with({
      provide: FileSystemProvider,
      use: MemoryFileSystemProvider,
    });
    return {
      static: alepha.inject(BuildStaticTask),
    };
  };

  it("should refuse --prebuilt for a static build", async () => {
    const tasks = create();

    await expect(tasks.static.run(createCtx("static"))).rejects.toThrow(
      /--prebuilt/,
    );
  });

  it("should stay inert for a build it does not own", async () => {
    const tasks = create();

    await expect(
      tasks.static.run(createCtx("cloudflare")),
    ).resolves.toBeUndefined();
  });
});
