import { Alepha, AlephaError } from "alepha";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, it } from "vitest";

import {
  type DesktopAdapter,
  DesktopAdapterResolver,
} from "../services/DesktopAdapterResolver.ts";
import { WorkspaceCompiler } from "../services/WorkspaceCompiler.ts";

/**
 * An adapter that records what it was asked, and fails where told to.
 */
class RecordingAdapter implements DesktopAdapter {
  public calls: string[] = [];
  public failAt?: "preflight" | "assemble";
  protected readonly fs: MemoryFileSystemProvider;
  constructor(fs: MemoryFileSystemProvider) {
    this.fs = fs;
  }

  public async preflight(input: { config: unknown }) {
    this.calls.push("preflight");
    if (this.failAt === "preflight")
      throw new AlephaError("bad desktop config");
    return input.config as Record<string, unknown>;
  }

  public async writeEntries(input: { dist: string }) {
    this.calls.push(`entries ${input.dist}`);
    await this.fs.writeFile(`${input.dist}/desktop-shell.js`, "// shell");
    return ["desktop-shell.js", "desktop-supervisor.js", "desktop-worker.js"];
  }

  public async assemble(input: {
    stage: string;
    binary: string;
    name: string;
  }) {
    this.calls.push(`assemble ${input.binary}`);
    if (this.failAt === "assemble") throw new AlephaError("codesign failed");
    await this.fs.writeFile(
      `${input.stage}/Fixture.app/Contents/MacOS/${input.name}`,
      "binary",
    );
    return `${input.stage}/Fixture.app`;
  }
}

/**
 * Plays any host.
 */
class TestWorkspaceCompiler extends WorkspaceCompiler {
  public platform = "darwin";
  public arch = "arm64";
  protected override hostPlatform(): string {
    return this.platform;
  }
  protected override hostArch(): string {
    return this.arch;
  }
}

const config = { name: "Fixture", identifier: "dev.alepha.fixture" };
const stage = "/my project/node_modules/.alepha/desktop-stage";

const setup = async (options: { installed?: boolean } = {}) => {
  const alepha = Alepha.create()
    .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
    .with({ provide: ShellProvider, use: MemoryShellProvider })
    .with({ provide: WorkspaceCompiler, use: TestWorkspaceCompiler });
  const fs = alepha.inject(MemoryFileSystemProvider);
  const shell = alepha.inject(MemoryShellProvider);
  const adapter = new RecordingAdapter(fs);
  const resolver = alepha.inject(DesktopAdapterResolver);
  resolver.resolve = async () => {
    if (options.installed === false) {
      throw new AlephaError(
        "`alepha compile --desktop` needs @alepha/desktop in this app's dependencies",
      );
    }
    return adapter;
  };
  const compiler = alepha.inject(WorkspaceCompiler) as TestWorkspaceCompiler;

  await fs.writeFile(
    "/my project/dist/index.bun.js",
    "import './server/bun/abc.js';\n",
  );
  await fs.writeFile(
    "/my project/dist/index.node.js",
    "import './server/node/def.js';\n",
  );
  await fs.writeFile("/my project/dist/server/bun/abc.js", "// chunk");
  await fs.writeFile("/my project/dist/server/node/def.js", "// chunk");
  await fs.writeFile(
    "/my project/dist/package.json",
    JSON.stringify({ dependencies: {} }),
  );
  await fs.writeFile("/my project/dist/public/entry.js", "// client");
  await fs.writeFile(
    "/my project/dist/manifest.json",
    JSON.stringify({ runtimes: [{ runtime: "bun" }, { runtime: "node" }] }),
  );
  const before = new Map(fs.files);
  const distUnchanged = () =>
    [...fs.files.keys()].filter((key) => key.startsWith("/my project/dist/"))
      .length === [...before.keys()].length &&
    [...before].every(([key, value]) => fs.files.get(key)?.equals(value));

  return { fs, shell, adapter, compiler, distUnchanged };
};

const options = {
  root: "/my project",
  name: "fixture",
  builtAt: 1767323045000,
  config,
};

describe("WorkspaceCompiler.compileDesktop", () => {
  it("stages, compiles the three entries with argv, assembles, promotes the app and cleans dist", async ({
    expect,
  }) => {
    const { fs, shell, adapter, compiler } = await setup();

    const app = await compiler.compileDesktop(options);

    expect(app).toBe("/my project/dist/Fixture.app");
    expect(adapter.calls).toEqual([
      "preflight",
      `entries ${stage}/dist`,
      `assemble ${stage}/dist/fixture`,
    ]);
    const [call] = shell.calls;
    expect(call.argv).toEqual([
      "bun",
      "build",
      "--compile",
      "--target=bun-darwin-arm64",
      "--minify",
      "--outfile=fixture",
      "desktop-shell.js",
      "desktop-supervisor.js",
      "desktop-worker.js",
    ]);
    expect(call.options.root).toBe(`${stage}/dist`);
    // Public files are embedded in the STAGED wrapper, never the original.
    expect(
      fs.wasWrittenMatching(
        `${stage}/dist/index.bun.js`,
        /with \{ type: "file" \}/,
      ),
    ).toBe(true);
    expect(
      fs.files.has("/my project/dist/Fixture.app/Contents/MacOS/fixture"),
    ).toBe(true);
    for (const gone of [
      "server/bun/abc.js",
      "index.bun.js",
      "index.node.js",
      "package.json",
      "public/entry.js",
    ]) {
      expect(fs.files.has(`/my project/dist/${gone}`)).toBe(false);
    }
    expect(fs.files.has("/my project/dist/manifest.json")).toBe(true);
    expect([...fs.files.keys()].some((key) => key.startsWith(stage))).toBe(
      false,
    );
  });

  it("is not minified when asked", async ({ expect }) => {
    const { shell, compiler } = await setup();
    await compiler.compileDesktop({ ...options, minify: false });
    expect(shell.calls[0].argv).not.toContain("--minify");
  });

  it("fails before touching dist without a desktop config, on another host or target, without the bun slice or the package", async ({
    expect,
  }) => {
    const cases: Array<
      [
        string,
        (s: Awaited<ReturnType<typeof setup>>) => Promise<unknown>,
        RegExp,
      ]
    > = [
      [
        "no config",
        (s) => s.compiler.compileDesktop({ ...options, config: undefined }),
        /top-level `desktop/,
      ],
      [
        "linux host",
        (s) => (
          (s.compiler.platform = "linux"),
          s.compiler.compileDesktop(options)
        ),
        /runs on macOS only/,
      ],
      [
        "cross target",
        (s) =>
          s.compiler.compileDesktop({ ...options, target: "bun-darwin-x64" }),
        /targets this Mac only \(bun-darwin-arm64\)/,
      ],
      [
        "linux target",
        (s) =>
          s.compiler.compileDesktop({ ...options, target: "bun-linux-arm64" }),
        /targets this Mac only/,
      ],
      [
        "no bun slice",
        async (s) => {
          await s.fs.rm("/my project/dist/index.bun.js");
          return s.compiler.compileDesktop(options);
        },
        /needs the bun slice/,
      ],
      [
        "bad config",
        (s) => (
          (s.adapter.failAt = "preflight"),
          s.compiler.compileDesktop(options)
        ),
        /bad desktop config/,
      ],
    ];
    for (const [, run, error] of cases) {
      const s = await setup();
      const snapshot = new Map(s.fs.files);
      await expect(run(s)).rejects.toThrow(error);
      expect(s.shell.calls).toEqual([]);
      if (!error.source.includes("bun slice")) {
        expect([...s.fs.files.keys()].sort()).toEqual(
          [...snapshot.keys()].sort(),
        );
      }
    }

    const missing = await setup({ installed: false });
    await expect(missing.compiler.compileDesktop(options)).rejects.toThrow(
      /needs @alepha\/desktop/,
    );
    expect(missing.distUnchanged()).toBe(true);
  });

  it("leaves dist exactly as built, and no staging, when assembly fails", async ({
    expect,
  }) => {
    const { fs, adapter, compiler, distUnchanged } = await setup();
    adapter.failAt = "assemble";

    await expect(compiler.compileDesktop(options)).rejects.toThrow(
      "codesign failed",
    );

    expect(distUnchanged()).toBe(true);
    expect([...fs.files.keys()].some((key) => key.startsWith(stage))).toBe(
      false,
    );
  });

  it("leaves dist as built when the compile itself fails", async ({
    expect,
  }) => {
    const { shell, compiler, distUnchanged } = await setup();
    shell.errors.set(
      "bun build --compile --target=bun-darwin-arm64 --minify --outfile=fixture desktop-shell.js desktop-supervisor.js desktop-worker.js",
      "bun: compile failed",
    );

    await expect(compiler.compileDesktop(options)).rejects.toThrow(
      "compile failed",
    );
    expect(distUnchanged()).toBe(true);
  });

  it("leaves an ordinary compile untouched by the desktop config", async ({
    expect,
  }) => {
    const { fs, shell, adapter, compiler } = await setup();

    await compiler.compile({
      root: "/my project",
      name: "fixture",
      builtAt: 1,
      minify: true,
    });

    expect(adapter.calls).toEqual([]);
    expect(shell.calls[0].command).toMatch(
      /^bun build --compile --target=bun-\S+ --minify --outfile=fixture index\.bun\.js$/,
    );
    expect(
      fs.files.has("/my project/dist/Fixture.app/Contents/MacOS/fixture"),
    ).toBe(false);
  });
});

describe("defineConfig({ desktop })", () => {
  it("stores the desktop object for compile --desktop, and nothing else reads it", async ({
    expect,
  }) => {
    const { defineConfig } = await import("../../config/defineConfig.ts");
    const { desktopOptions } = await import("../atoms/desktopOptions.ts");
    const { buildOptions } = await import("../atoms/buildOptions.ts");
    const alepha = Alepha.create();

    defineConfig({ desktop: { name: "Loom", identifier: "dev.alepha.loom" } })(
      alepha,
    );

    expect(alepha.store.get(desktopOptions)).toEqual({
      name: "Loom",
      identifier: "dev.alepha.loom",
    });
    expect(alepha.store.get(buildOptions)).toEqual(
      buildOptions.options.default,
    );
  });
});
