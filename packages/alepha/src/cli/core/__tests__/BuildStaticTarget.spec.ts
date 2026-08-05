import { Alepha, AlephaError } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, expect, it } from "vitest";
import { BuildCompressTask } from "../tasks/BuildCompressTask.ts";
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

  describe("adopting a client the app built itself", () => {
    /*
      Bay can host a site with no process behind it. This target is the only
      thing that produces one — and until now it could only ship what Alepha
      itself rendered: its own Vite client build, or a `$page` at `/`. A site
      built by anything else (a hand-written `index.html` through plain Vite,
      an Astro export, a docs generator) had no way in, because `alepha build`
      cleans `dist/` before any task runs, so putting the files there first
      only got them deleted.

      `static.source` is that way in: a directory OUTSIDE `dist/` that the
      workspace filled itself, copied in before the shell is derived.
    */
    const runStaticTask = async (
      source: string | undefined,
      seed: (fs: MemoryFileSystemProvider) => Promise<void>,
    ) => {
      const alepha = Alepha.create().with({
        provide: FileSystemProvider,
        use: MemoryFileSystemProvider,
      });
      const task = alepha.inject(BuildStaticTask);
      const fs = alepha.inject(MemoryFileSystemProvider);
      await seed(fs);

      const ctx = {
        alepha: { isConfigured: () => true, primitives: () => [] },
        root: "/root/my-app",
        options: { target: "static", static: source ? { source } : undefined },
        run: async (task: { handler: () => Promise<void> }) => task.handler(),
      } as any;

      await task.run(ctx);
      return fs;
    };

    const seedClient = async (fs: MemoryFileSystemProvider) => {
      await fs.mkdir("/root/my-app/dist-client");
      await fs.writeFile(
        "/root/my-app/dist-client/index.html",
        '<html><body><canvas id="view"></canvas></body></html>',
      );
      await fs.writeFile("/root/my-app/dist-client/assets/app.js", "boot()");
    };

    it("ships a site Alepha never rendered", async () => {
      const fs = await runStaticTask("dist-client", seedClient);

      expect(await fs.exists("/root/my-app/dist/public/index.html")).toBe(true);
      expect(await fs.exists("/root/my-app/dist/public/assets/app.js")).toBe(
        true,
      );
    });

    it("keeps the author's own index.html rather than a stripped shell", async () => {
      // The copied file IS the site. Only the fallbacks are stripped down to a
      // shell, because they stand in for pages nobody wrote.
      const fs = await runStaticTask("dist-client", seedClient);

      expect(
        fs.getFileContent("/root/my-app/dist/public/index.html"),
      ).toContain('id="view"');
    });

    it("still writes the fallbacks the proxy looks for", async () => {
      // Bay answers an unmatched path with 200.html, then 404.html. A site
      // that ships neither has every path but the root fail.
      const fs = await runStaticTask("dist-client", seedClient);

      expect(await fs.exists("/root/my-app/dist/public/200.html")).toBe(true);
      expect(await fs.exists("/root/my-app/dist/public/404.html")).toBe(true);
    });

    it("takes an absolute source as written", async () => {
      // `join(root, "/elsewhere/site")` yields `<root>/elsewhere/site` — a
      // directory that does not exist, reported as a client the author never
      // built, for a path they gave correctly.
      const fs = await runStaticTask("/elsewhere/site", async (fs) => {
        await fs.mkdir("/elsewhere/site");
        await fs.writeFile("/elsewhere/site/index.html", "<html></html>");
      });

      expect(await fs.exists("/root/my-app/dist/public/index.html")).toBe(true);
    });

    it("refuses a source inside dist, which the build has already deleted", async () => {
      /*
        The trap worth naming: `dist/public` is the obvious place to point a
        client build at, and it is the one place that cannot work — the clean
        step removes it before this task ever runs. Left to the copy, the
        error would be a bare ENOENT on a path the author did write, which
        reads as "my build didn't run" rather than "it ran and was deleted".
      */
      await expect(runStaticTask("dist/public", seedClient)).rejects.toThrow(
        /outside dist/,
      );
    });

    it("names the directory it could not find", async () => {
      // Not the ENOENT the copy would raise on its own: that one names
      // `dist/public/index.html`, a path the author never wrote.
      await expect(
        runStaticTask("dist-client", async () => {}),
      ).rejects.toThrow(/"dist-client" does not exist/);
    });

    it("refuses a source with no index.html", async () => {
      // Otherwise the failure surfaces further down as ENOENT on
      // `dist/public/index.html` — a path the author never wrote.
      await expect(
        runStaticTask("dist-client", async (fs) => {
          await fs.mkdir("/root/my-app/dist-client");
          await fs.writeFile(
            "/root/my-app/dist-client/assets/app.js",
            "boot()",
          );
        }),
      ).rejects.toThrow(/"dist-client" has no index\.html/);
    });
  });

  describe("compressing an adopted client", () => {
    it("emits the sidecars the proxy looks for", async () => {
      /*
        Bay serves a `.br`/`.gz` sidecar when the request carries a matching
        Accept-Encoding, rather than recompressing per request — the build is
        expected to have emitted them.

        `BuildCompressTask` skipped on `!hasClient`, which is exactly what an
        adopted site is: Alepha bundled nothing, so it declares no client. The
        site shipped raw and every asset went out uncompressed.
      */
      const alepha = Alepha.create().with({
        provide: FileSystemProvider,
        use: MemoryFileSystemProvider,
      });
      const task = alepha.inject(BuildCompressTask);
      const fs = alepha.inject(MemoryFileSystemProvider);
      await fs.mkdir("/root/my-app/dist/public");
      await fs.writeFile(
        "/root/my-app/dist/public/index.html",
        "<html><body>a site</body></html>",
      );

      await task.run({
        alepha: fakeAlepha,
        root: "/root/my-app",
        hasClient: false,
        options: { target: "static", static: { source: "dist-client" } },
        run: async (step: { handler: () => Promise<void> }) => step.handler(),
      } as any);

      expect(await fs.exists("/root/my-app/dist/public/index.html.br")).toBe(
        true,
      );
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
