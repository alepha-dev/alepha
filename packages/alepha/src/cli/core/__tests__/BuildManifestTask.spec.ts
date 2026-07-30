import { Alepha, AlephaError } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, expect, it } from "vitest";
import { BuildManifestTask } from "../tasks/BuildManifestTask.ts";

/**
 * Exposes the protected writer so the manifest shape can be asserted without
 * driving a full build.
 */
class TestBuildManifestTask extends BuildManifestTask {
  public testWriteManifest = this.writeManifest.bind(this);
  public testResolveRuntimeVersion = this.resolveRuntimeVersion.bind(this);
}

/**
 * Minimal fake of the workspace's live `ctx.alepha` — only `primitives` is
 * exercised meaningfully; every other lookup `writeManifest` makes (`inject`,
 * `dump`) is wrapped in try/catch there, so a throwing stub is enough to
 * exercise the "resource absent" paths without a real Alepha instance.
 */
const fakeAlepha = {
  primitives: (name: string) =>
    name === "$websocket"
      ? [{ options: { channel: { options: { path: "/ws/chat" } } } }]
      : [],
  inject: () => {
    throw new AlephaError("not available in this fake");
  },
  dump: () => {
    throw new AlephaError("not available in this fake");
  },
} as any;

/**
 * Same fake, but with the primitive answers parameterized per name — for the
 * `$websocket` / `$room` union cases.
 */
const fakeAlephaWithPrimitives = (byName: Record<string, string[]>) =>
  ({
    primitives: (name: string) =>
      (byName[name] ?? []).map((path) => ({
        options: { channel: { options: { path } } },
      })),
    inject: () => {
      throw new AlephaError("not available in this fake");
    },
    dump: () => {
      throw new AlephaError("not available in this fake");
    },
  }) as any;

describe("BuildManifestTask", () => {
  const createTask = () => {
    const alepha = Alepha.create().with({
      provide: FileSystemProvider,
      use: MemoryFileSystemProvider,
    });
    return {
      task: alepha.inject(TestBuildManifestTask),
      fs: alepha.inject(MemoryFileSystemProvider),
    };
  };

  const contextFor = (options: Record<string, unknown> = {}) =>
    ({
      alepha: fakeAlepha,
      root: "/root/my-app",
      platformOptions: null,
      options,
    }) as any;

  const readManifest = (fs: MemoryFileSystemProvider) =>
    JSON.parse(fs.getFileContent("/root/my-app/dist/manifest.json") ?? "{}");

  describe("writeManifest", () => {
    it("captures registered $websocket channel paths into the manifest", async () => {
      const { task, fs } = createTask();

      await task.testWriteManifest(contextFor(), "dist");

      const manifest = readManifest(fs);
      expect(manifest.websocketPaths).toEqual(["/ws/chat"]);
      expect(manifest.resources.hasWebSocket).toBe(true);
    });

    /**
     * A `$room` rides the same worker upgrade branch and the same Durable
     * Object as a `$websocket`, so an app whose realtime layer is rooms-only
     * must still record `hasWebSocket` + its channel paths — otherwise the
     * `--prebuilt` deploy path emits a worker with no WebSocket wiring.
     */
    it("unions $room channel paths into websocketPaths", async () => {
      const { task, fs } = createTask();
      const ctx = contextFor();
      ctx.alepha = fakeAlephaWithPrimitives({
        $room: ["/ws/world", "/ws/party", "/ws/presence"],
      });

      await task.testWriteManifest(ctx, "dist");

      const manifest = readManifest(fs);
      expect(manifest.websocketPaths).toEqual([
        "/ws/world",
        "/ws/party",
        "/ws/presence",
      ]);
      expect(manifest.resources.hasWebSocket).toBe(true);
    });

    it("dedups a channel path shared by a $websocket and a $room", async () => {
      const { task, fs } = createTask();
      const ctx = contextFor();
      ctx.alepha = fakeAlephaWithPrimitives({
        $websocket: ["/ws/chat"],
        $room: ["/ws/chat"],
      });

      await task.testWriteManifest(ctx, "dist");

      expect(readManifest(fs).websocketPaths).toEqual(["/ws/chat"]);
    });

    it("derives `project` from the workspace directory name, slugified", async () => {
      const { task, fs } = createTask();

      await task.testWriteManifest(contextFor(), "dist");

      // Slugified because the same value doubles as the wrangler placeholder
      // name, which must match `^[a-z0-9-]+$`.
      expect(readManifest(fs).project).toBe("my-app");
    });

    it("records the entry directory so a deployer can spawn `<runtime> <entry>`", async () => {
      const { task, fs } = createTask();

      // A self-hosted deployer receives `dist/` + `migrations/` and no
      // package.json, so the bundle location has to be in the manifest.
      await task.testWriteManifest(contextFor(), "dist");

      expect(readManifest(fs).entry).toBe("dist");
    });

    it("defaults the runtime to node when the build did not specify one", async () => {
      const { task, fs } = createTask();

      await task.testWriteManifest(contextFor(), "dist");

      expect(readManifest(fs).runtime).toBe("node");
    });

    it("records the runtime the build targeted", async () => {
      const { task, fs } = createTask();

      await task.testWriteManifest(contextFor({ runtime: "bun" }), "dist");

      expect(readManifest(fs).runtime).toBe("bun");
    });

    it("creates the dist directory rather than failing when it does not exist", async () => {
      const { task, fs } = createTask();

      // `writeFile` does not create parents. This used to be safe only by
      // accident: the manifest was written from the Cloudflare task, which ran
      // after the bundle steps had already created `dist/`.
      await task.testWriteManifest(contextFor(), "build");

      expect(fs.wasWritten("/root/my-app/build/manifest.json")).toBe(true);
    });
  });

  describe("run", () => {
    it("does not overwrite the manifest in prebuilt mode", async () => {
      const { task, fs } = createTask();
      const ctx = {
        ...contextFor(),
        // Prebuilt mode read this manifest off disk; rewriting it would only
        // re-emit the same data and would destroy the record of how the
        // artifact was actually built.
        manifest: { version: 1, project: "my-app" },
        run: async (_step: unknown) => {
          throw new AlephaError("run must not be called in prebuilt mode");
        },
      } as any;

      await task.run(ctx);

      expect(fs.wasWritten("/root/my-app/dist/manifest.json")).toBe(false);
    });
  });

  describe("resolveRuntimeVersion", () => {
    it("keeps only the major so a runtime patch does not need a redeploy", async () => {
      const { task, fs } = createTask();
      await fs.writeFile(
        "/root/my-app/package.json",
        JSON.stringify({ engines: { node: "^26.1.0" } }),
      );

      // Pinning `26.1.0` would mean a runtime security fix cannot be picked
      // up without rebuilding and redeploying every app.
      expect(await task.testResolveRuntimeVersion("/root/my-app", "node")).toBe(
        "26",
      );
    });

    it("accepts range syntax", async () => {
      const { task, fs } = createTask();
      await fs.writeFile(
        "/root/my-app/package.json",
        JSON.stringify({ engines: { node: ">=26" } }),
      );

      expect(await task.testResolveRuntimeVersion("/root/my-app", "node")).toBe(
        "26",
      );
    });

    it("falls back to the major of the runtime that ran the build", async () => {
      const { task } = createTask();

      // No package.json at all: the honest second answer is the runtime whose
      // export conditions and syntax level the bundle was resolved against.
      expect(await task.testResolveRuntimeVersion("/root/my-app", "node")).toBe(
        process.versions.node.split(".")[0],
      );
    });

    it("reports no version for workerd", async () => {
      const { task } = createTask();

      // Cloudflare selects the workerd build via `compatibility_date`; there
      // is no version for a deployer to install.
      expect(
        await task.testResolveRuntimeVersion("/root/my-app", "workerd"),
      ).toBeUndefined();
    });
  });
});
