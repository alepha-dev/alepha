import { Alepha, AlephaError } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, it } from "vitest";

import { ViteUtils } from "../services/ViteUtils.ts";
import { BuildClientTask } from "../tasks/BuildClientTask.ts";
import { BuildServerTask } from "../tasks/BuildServerTask.ts";

/**
 * Stands in for Vite: records the config the server build hands to `build()`
 * and stops there, since the config is all these specs read.
 */
class RecordingViteUtils extends ViteUtils {
  public configs: Array<{
    plugins?: Array<{ name?: string }>;
    build?: { rolldownOptions?: { output?: { assetFileNames?: string } } };
  }> = [];

  public async importVite(): Promise<any> {
    return {
      build: async (config: any) => {
        this.configs.push(config);
        throw new AlephaError("stop: the config is all this spec reads");
      },
      resolveConfig: async () => ({}),
    };
  }

  public async importViteReact(): Promise<any> {
    return undefined;
  }
}

class TestBuildServerTask extends BuildServerTask {
  public testBuildServer = this.buildServer.bind(this);
  public testGenerateExternals = this.generateExternals.bind(this);
}

describe("BuildServerTask", () => {
  it("should keep the app's .client modules out of the server bundle", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ViteUtils, use: RecordingViteUtils });
    const task = alepha.inject(TestBuildServerTask);
    const vite = alepha.inject(RecordingViteUtils);

    await expect(
      task.testBuildServer({
        root: "/project",
        entry: "src/main.server.ts",
        distDir: "dist",
        runtime: "node",
        alepha: Alepha.create(),
      }),
    ).rejects.toThrow(/stop/);

    const names = (vite.configs[0]?.plugins ?? []).map(
      (plugin) => plugin?.name,
    );
    expect(names).toContain("alepha-client-modules");
  });

  it("names an imported asset as the client build does, so the server-rendered URL is the file the client writes", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ViteUtils, use: RecordingViteUtils });
    const task = alepha.inject(TestBuildServerTask);
    const vite = alepha.inject(RecordingViteUtils);

    await expect(
      task.testBuildServer({
        root: "/project",
        entry: "src/main.server.ts",
        distDir: "dist",
        runtime: "node",
        alepha: Alepha.create(),
      }),
    ).rejects.toThrow(/stop/);

    expect(
      vite.configs[0]?.build?.rolldownOptions?.output?.assetFileNames,
    ).toBe(`${BuildClientTask.HASHED_PREFIXES.asset}[hash][extname]`);
  });

  describe("dist/package.json", () => {
    const setup = () => {
      const alepha = Alepha.create().with({
        provide: FileSystemProvider,
        use: MemoryFileSystemProvider,
      });
      return {
        task: alepha.inject(TestBuildServerTask),
        fs: alepha.inject(MemoryFileSystemProvider),
      };
    };

    const dependencies = (fs: MemoryFileSystemProvider) =>
      JSON.parse(fs.getFileContent("/project/dist/package.json") ?? "{}")
        .dependencies;

    it("declares an external installed in the app, whatever its exports allow", async ({
      expect,
    }) => {
      // An ESM-only package: no `require` condition and no `./package.json`
      // export, so nothing but reading the file finds its version.
      const { task, fs } = setup();
      await fs.writeFile(
        "/project/node_modules/esm-only/package.json",
        JSON.stringify({
          name: "esm-only",
          version: "3.1.4",
          type: "module",
          exports: { ".": { import: "./index.js" } },
        }),
      );

      await task.testGenerateExternals(
        "/project",
        "/project/dist",
        ["esm-only"],
        "index.node.js",
      );

      expect(dependencies(fs)).toEqual({ "esm-only": "^3.1.4" });
    });

    it("finds an external hoisted to a directory above the app", async ({
      expect,
    }) => {
      const { task, fs } = setup();
      await fs.writeFile(
        "/node_modules/@scope/hoisted/package.json",
        JSON.stringify({ name: "@scope/hoisted", version: "2.0.0" }),
      );

      await task.testGenerateExternals(
        "/project",
        "/project/dist",
        ["@scope/hoisted"],
        "index.node.js",
      );

      expect(dependencies(fs)).toEqual({ "@scope/hoisted": "^2.0.0" });
    });

    it("never declares a version it could not read", async ({ expect }) => {
      // A subpath external finds the package's legacy subpath shim: a
      // `package.json` that redirects `main` and carries no version.
      const { task, fs } = setup();
      await fs.writeFile(
        "/project/node_modules/shimmed/sub/package.json",
        JSON.stringify({ main: "../dist/sub.js" }),
      );

      await task.testGenerateExternals(
        "/project",
        "/project/dist",
        ["shimmed/sub"],
        "index.node.js",
      );

      expect(dependencies(fs)).toEqual({});
      expect(fs.getFileContent("/project/dist/package.json")).not.toContain(
        "undefined",
      );
    });

    it("takes the copy nearest the app when two versions are installed", async ({
      expect,
    }) => {
      const { task, fs } = setup();
      await fs.writeFile(
        "/node_modules/twice/package.json",
        JSON.stringify({ name: "twice", version: "1.0.0" }),
      );
      await fs.writeFile(
        "/project/node_modules/twice/package.json",
        JSON.stringify({ name: "twice", version: "2.0.0" }),
      );

      await task.testGenerateExternals(
        "/project",
        "/project/dist",
        ["twice"],
        "index.node.js",
      );

      expect(dependencies(fs)).toEqual({ twice: "^2.0.0" });
    });
  });
});
