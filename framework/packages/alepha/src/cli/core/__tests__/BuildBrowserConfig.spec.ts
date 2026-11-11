import { Alepha, AlephaError } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, expect, it } from "vitest";

import { BuildCompressTask } from "../tasks/BuildCompressTask.ts";
import { BuildHeadersTask } from "../tasks/BuildHeadersTask.ts";
import { BuildManifestTask } from "../tasks/BuildManifestTask.ts";
import { BuildStaticTask } from "../tasks/BuildStaticTask.ts";

class TestBuildManifestTask extends BuildManifestTask {
  public testWriteManifest = this.writeManifest.bind(this);
}

/**
 * A static build's `config.js` (#Q3323): the `browser: true` keys with their
 * build-time values, one file a host replaces per environment, never
 * compressed nor cached as immutable, and listed in the manifest.
 */
describe("a static build's browser configuration", () => {
  const root = "/root/my-app";
  const pub = `${root}/dist/public`;

  /**
   * The user's app as the build sees it: one browser key, one declassified
   * key and one secret.
   */
  const appAlepha = (keys: string[] = ["API_URL"]) => ({
    isConfigured: () => true,
    primitives: () => [
      {
        name: "home",
        options: { path: "/" },
        render: async () => ({
          html: '<html><head><script src="/config.js"></script></head><body><div id="root">Home</div></body></html>',
        }),
      },
    ],
    graph: () => ({}),
    inject: (name: string) => {
      throw new AlephaError(`Service not found: ${name}`);
    },
    dump: () => ({
      env: {
        API_URL: { secret: false, browser: true },
        LOG_HOST: { secret: false },
        TOKEN: { secret: true },
      },
    }),
    browserEnvKeys: () => keys,
    browserEnv: () =>
      keys.length ? { API_URL: "https://build.example.com" } : {},
  });

  const container = () => {
    const alepha = Alepha.create().with({
      provide: FileSystemProvider,
      use: MemoryFileSystemProvider,
    });
    return { alepha, fs: alepha.inject(MemoryFileSystemProvider) };
  };

  const ctxOf = (app: unknown) =>
    ({
      alepha: app,
      root,
      hasClient: true,
      options: { runtime: "static" },
      run: async (step: { handler: () => Promise<void> }) => step.handler(),
    }) as any;

  it("writes config.js with the browser keys only, and every emitted HTML file loads it", async () => {
    const { alepha, fs } = container();

    await alepha.inject(BuildStaticTask).run(ctxOf(appAlepha()));

    expect(fs.getFileContent(`${pub}/config.js`)).toBe(
      'globalThis.__ALEPHA_ENV__ = {"API_URL":"https://build.example.com"};\n',
    );
    for (const file of ["index.html", "200.html", "404.html"]) {
      expect(fs.getFileContent(`${pub}/${file}`)).toContain(
        '<script src="/config.js"></script>',
      );
    }
  });

  it("writes no config.js for an app with no browser key", async () => {
    const { alepha, fs } = container();

    await alepha.inject(BuildStaticTask).run(ctxOf(appAlepha([])));

    expect(await fs.exists(`${pub}/config.js`)).toBe(false);
  });

  it("gives config.js no compressed sibling", async () => {
    const { alepha, fs } = container();
    await fs.mkdir(pub);
    await fs.writeFile(`${pub}/config.js`, "globalThis.__ALEPHA_ENV__ = {};");
    await fs.writeFile(`${pub}/assets/app-abc123.js`, "boot()".repeat(100));

    await alepha.inject(BuildCompressTask).run(ctxOf(appAlepha()));

    expect(await fs.exists(`${pub}/assets/app-abc123.js.br`)).toBe(true);
    expect(await fs.exists(`${pub}/config.js.br`)).toBe(false);
    expect(await fs.exists(`${pub}/config.js.gz`)).toBe(false);
  });

  it("never caches config.js as immutable", async () => {
    const { alepha, fs } = container();
    await fs.mkdir(pub);
    await fs.writeFile(`${pub}/config.js`, "globalThis.__ALEPHA_ENV__ = {};");
    await fs.writeFile(`${pub}/index.html`, "<html></html>");

    await alepha.inject(BuildHeadersTask).run(ctxOf(appAlepha()));

    // Unmatched paths get `public, max-age=0, must-revalidate` when the file
    // is applied; what matters is that no immutable rule reaches config.js.
    const headers = fs.getFileContent(`${pub}/_headers`) ?? "";
    const immutablePatterns = headers
      .split("\n\n")
      .filter((block) => block.includes("immutable"))
      .map((block) => block.trim().split("\n")[0]);
    expect(immutablePatterns.length).toBeGreaterThan(0);
    for (const pattern of immutablePatterns) {
      const glob = new RegExp(
        `^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
      );
      expect(glob.test("/config.js")).toBe(false);
    }
  });

  it("lists the browser keys in the manifest, beside the variables they also are", async () => {
    const { alepha, fs } = container();

    await alepha
      .inject(TestBuildManifestTask)
      .testWriteManifest(ctxOf(appAlepha()), "dist");

    const manifest = JSON.parse(
      fs.getFileContent(`${root}/dist/manifest.json`) ?? "{}",
    );
    expect(manifest.browser).toEqual(["API_URL"]);
    expect(manifest.variables.map((it: { name: string }) => it.name)).toEqual([
      "API_URL",
      "LOG_HOST",
    ]);
    const secrets = manifest.secrets.map((it: { name: string }) => it.name);
    expect(secrets).toContain("TOKEN");
    expect(secrets).not.toContain("API_URL");
  });
});
