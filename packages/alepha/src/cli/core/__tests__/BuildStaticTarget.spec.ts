import { Alepha, AlephaError } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, expect, it } from "vitest";
import { BuildManifestTask } from "../tasks/BuildManifestTask.ts";
import { BuildStaticTask } from "../tasks/BuildStaticTask.ts";

/**
 * Exposes the protected writer so the manifest shape can be asserted without
 * driving a full build.
 */
class TestBuildManifestTask extends BuildManifestTask {
  public testWriteManifest = this.writeManifest.bind(this);
}

/**
 * Minimal fake of the workspace's live `ctx.alepha`. Every lookup
 * `writeManifest` makes is wrapped in try/catch there, so a throwing stub
 * exercises the "nothing declared" paths without a real container.
 */
const fakeAlepha = {
  primitives: () => [],
  inject: () => {
    throw new AlephaError("not available in this fake");
  },
  dump: () => {
    throw new AlephaError("not available in this fake");
  },
} as any;

describe("build --target=static", () => {
  const createManifestTask = () => {
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

  describe("the manifest", () => {
    it("records the static runtime so a deployer knows to spawn nothing", async () => {
      // Bay switches on this field. An older Bay meeting an unknown value
      // refuses the deploy by name; a new field it did not know about would be
      // ignored, leaving it to spawn `node dist` against a directory with no
      // entry point.
      const { task, fs } = createManifestTask();

      await task.testWriteManifest(contextFor({ target: "static" }), "dist");

      expect(readManifest(fs).runtime).toBe("static");
    });

    it("records no runtime version for a static site", async () => {
      // Nothing is spawned, so there is no interpreter to resolve a major
      // against. A version here would be a claim about a process that does not
      // exist.
      const { task, fs } = createManifestTask();

      await task.testWriteManifest(contextFor({ target: "static" }), "dist");

      expect(readManifest(fs).runtimeVersion).toBeUndefined();
    });

    it("still records node for a bare build", async () => {
      const { task, fs } = createManifestTask();

      await task.testWriteManifest(contextFor({ target: "bare" }), "dist");

      expect(readManifest(fs).runtime).toBe("node");
    });
  });

  describe("cleaning dist", () => {
    const createStaticTask = () => {
      const alepha = Alepha.create().with({
        provide: FileSystemProvider,
        use: MemoryFileSystemProvider,
      });
      return {
        task: alepha.inject(BuildStaticTask) as BuildStaticTask & {
          cleanDist: (dist: string, clientDir: string) => Promise<void>;
        },
        fs: alepha.inject(MemoryFileSystemProvider),
      };
    };

    it("keeps the manifest, which the deploy side cannot work without", async () => {
      /*
        The bug this exists for.

        `BuildStaticTask` runs AFTER `BuildManifestTask` in the pipeline and
        removed every `dist/` entry that was not `public/` — so a static build
        shipped no manifest at all, and `alepha pack` produced an archive Bay
        rejects with "read manifest: no such file".
      */
      const { task, fs } = createStaticTask();
      await fs.writeFile("/root/my-app/dist/manifest.json", "{}");
      await fs.writeFile("/root/my-app/dist/index.js", "server");
      await fs.writeFile(
        "/root/my-app/dist/public/index.html",
        "<html></html>",
      );

      await (task as any).cleanDist("/root/my-app/dist", "public");

      expect(await fs.exists("/root/my-app/dist/manifest.json")).toBe(true);
      expect(await fs.exists("/root/my-app/dist/public/index.html")).toBe(true);
    });

    it("still removes the server bundle", async () => {
      // The point of the target: what ships is files, not a process.
      const { task, fs } = createStaticTask();
      await fs.writeFile("/root/my-app/dist/manifest.json", "{}");
      await fs.writeFile("/root/my-app/dist/index.js", "server");
      await fs.writeFile(
        "/root/my-app/dist/public/index.html",
        "<html></html>",
      );

      await (task as any).cleanDist("/root/my-app/dist", "public");

      expect(await fs.exists("/root/my-app/dist/index.js")).toBe(false);
    });
  });
});
