import { Alepha } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, it } from "vitest";
import { ViteUtils } from "../services/ViteUtils.ts";
import { BuildClientTask } from "../tasks/BuildClientTask.ts";
import type { BuildTaskContext } from "../tasks/BuildTask.ts";

/**
 * Stands in for the real Vite so the task can be driven end-to-end without
 * running a bundler.
 */
class FakeViteUtils extends ViteUtils {
  public configs: any[] = [];

  public async importVite(): Promise<any> {
    return {
      build: async (config: any) => {
        this.configs.push(config);
      },
    };
  }

  public async importViteReact(): Promise<any> {
    return undefined;
  }

  public createTsconfigPathsPlugin(): any {
    return {};
  }

  public createSsrPreloadPlugin(): any {
    return {};
  }

  public generateIndexHtml(): string {
    return "<html></html>";
  }
}

describe("BuildClientTask", () => {
  const setup = () => {
    const alepha = Alepha.create()
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ViteUtils, use: FakeViteUtils });

    return {
      task: alepha.inject(BuildClientTask),
      fs: alepha.inject(MemoryFileSystemProvider),
      vite: alepha.inject(FakeViteUtils),
    };
  };

  const createContext = (
    output: { dist?: string; public?: string } | undefined,
  ): BuildTaskContext =>
    ({
      alepha: Alepha.create(),
      options: { output } as any,
      run: (task: any) => task.handler(),
      root: "/project",
      entry: {} as any,
      hasClient: true,
      flags: {},
    }) as unknown as BuildTaskContext;

  it("should clean up the index.html inside the configured output directory", async ({
    expect,
  }) => {
    // The cleanup was called with no argument and defaulted to a hardcoded
    // "dist/public", so any customised `output.dist` / `output.public` made
    // the whole build fail on a manifest that isn't there.
    const { task, fs } = setup();

    await fs.mkdir("build/static/node_modules/.alepha", { recursive: true });
    await fs.writeFile(
      "build/static/.vite/manifest.json",
      JSON.stringify({ "node_modules/.alepha/index.html": { file: "e.js" } }),
    );
    await fs.writeFile(
      "build/static/node_modules/.alepha/index.html",
      "<html></html>",
    );

    await task.run(createContext({ dist: "build", public: "static" }));

    expect(fs.wasWritten("build/static/.vite/manifest.json")).toBe(true);
    expect(await fs.exists("build/static/index.html")).toBe(true);
  });

  it("should still default to dist/public when output is not configured", async ({
    expect,
  }) => {
    const { task, fs } = setup();

    await fs.mkdir("dist/public/node_modules/.alepha", { recursive: true });
    await fs.writeFile(
      "dist/public/.vite/manifest.json",
      JSON.stringify({ "node_modules/.alepha/index.html": { file: "e.js" } }),
    );
    await fs.writeFile(
      "dist/public/node_modules/.alepha/index.html",
      "<html></html>",
    );

    await task.run(createContext(undefined));

    expect(await fs.exists("dist/public/index.html")).toBe(true);
  });

  it("should not force Vite's static-asset `publicDir` on the inline config, so the app's own vite.config.ts publicDir survives Vite's own file+inline merge", async ({
    expect,
  }) => {
    // Regression: this option used to be hardcoded to the literal "public"
    // on the inline config handed to Vite's `build()`. Vite merges the
    // caller's inline config OVER whatever it auto-loads from the app's own
    // vite.config.ts, so a hardcoded scalar here silently discarded an
    // app-configured `publicDir` (e.g. a monorepo app whose static assets
    // live in a sibling package) every single build. Leaving the key unset
    // lets Vite's real merge/default behavior decide: the app's configured
    // `publicDir` wins, and Vite's own "public" default applies only when
    // the app never configured one.
    const { task, fs, vite } = setup();

    await fs.mkdir("dist/public/node_modules/.alepha", { recursive: true });
    await fs.writeFile(
      "dist/public/.vite/manifest.json",
      JSON.stringify({ "node_modules/.alepha/index.html": { file: "e.js" } }),
    );
    await fs.writeFile(
      "dist/public/node_modules/.alepha/index.html",
      "<html></html>",
    );

    await task.run(createContext(undefined));

    expect(vite.configs[0].publicDir).toBeUndefined();
  });
});
