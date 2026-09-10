import { Alepha, type AlephaMeta } from "alepha";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, expect, it } from "vitest";

import type { BuildOptions } from "../atoms/buildOptions.ts";
import type { AppEntry } from "../providers/AppEntryProvider.ts";
import { BuildCompileTask } from "../tasks/BuildCompileTask.ts";
import type { BuildTaskContext } from "../tasks/BuildTask.ts";

describe("BuildCompileTask", () => {
  const createTestEnv = async () => {
    const alepha = Alepha.create()
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider });

    const fs = alepha.inject(MemoryFileSystemProvider);
    const shell = alepha.inject(MemoryShellProvider);
    const task = alepha.inject(BuildCompileTask);

    // A built app: the generated entry, one server chunk, a client bundle
    // with its brotli sibling, a nested public file, and the manifest.
    await fs.writeFile(
      "/project/dist/index.js",
      `import './server/abc.js';\n__alepha.set("alepha.react.ssr.manifest", {});\n`,
    );
    await fs.writeFile("/project/dist/server/abc.js", "// chunk");
    await fs.writeFile(
      "/project/dist/package.json",
      JSON.stringify({ dependencies: {} }),
    );
    await fs.writeFile("/project/dist/public/entry.X1.js", "// client");
    await fs.writeFile("/project/dist/public/entry.X1.js.br", "br");
    await fs.writeFile("/project/dist/public/assets/logo.svg", "<svg/>");
    await fs.writeFile("/project/dist/manifest.json", "{}");

    return { fs, shell, task };
  };

  /**
   * Minimal RunnerMethod stand-in. Strings are forwarded to the shell so
   * MemoryShellProvider records them in order; task objects run their handler.
   */
  const createRun = (shell: MemoryShellProvider): BuildTaskContext["run"] => {
    const run = (async (cmd: any, options?: any) => {
      if (typeof cmd === "string") {
        await shell.run(cmd, { root: options?.root });
        return "";
      }
      const result = await cmd.handler();
      return String(result ?? "");
    }) as BuildTaskContext["run"];
    run.rm = async () => "";
    run.cp = async () => "";
    run.end = () => {};
    return run;
  };

  const createCtx = (
    shell: MemoryShellProvider,
    options: BuildOptions,
    overrides: Partial<BuildTaskContext> = {},
  ): BuildTaskContext => ({
    alepha: {} as any,
    options,
    run: createRun(shell),
    root: "/project",
    entry: { server: "/project/src/server.ts" } as AppEntry,
    hasClient: true,
    // 2026-01-02T03:04:05Z is 1767323045000 ms.
    meta: {
      build: { date: "2026-01-02T03:04:05.000Z", runtime: "bun", dev: false },
    } as AlephaMeta,
    manifest: null,
    platformOptions: null,
    flags: {},
    ...overrides,
  });

  const bare: BuildOptions = {
    target: "bare",
    runtime: "bun",
    compile: { name: "loom", minify: true },
  };

  it("does nothing unless build.compile is set", async () => {
    const { fs, shell, task } = await createTestEnv();

    await task.run(createCtx(shell, { target: "bare", runtime: "bun" }));

    expect(shell.calls).toHaveLength(0);
    expect(await fs.exists("/project/dist/index.js")).toBe(true);
  });

  it("embeds every public file in index.js and publishes the map with the build time", async () => {
    const { fs, shell, task } = await createTestEnv();

    await task.run(createCtx(shell, bare));

    const written = (pattern: RegExp) =>
      fs.wasWrittenMatching("/project/dist/index.js", pattern);
    expect(
      written(
        /import a0 from "\.\/public\/assets\/logo\.svg" with \{ type: "file" \};/,
      ),
    ).toBe(true);
    expect(
      written(
        /import a1 from "\.\/public\/entry\.X1\.js" with \{ type: "file" \};/,
      ),
    ).toBe(true);
    expect(
      written(
        /import a2 from "\.\/public\/entry\.X1\.js\.br" with \{ type: "file" \};/,
      ),
    ).toBe(true);
    expect(
      written(
        /__alepha\.set\("alepha\.server\.static\.embedded", \{ builtAt: 1767323045000, files: \{ "\/assets\/logo\.svg": a0, "\/entry\.X1\.js": a1, "\/entry\.X1\.js\.br": a2 \} \}\);/,
      ),
    ).toBe(true);
    // The generated entry keeps what it had: the server chunk first.
    expect(written(/^import '\.\/server\/abc\.js';/)).toBe(true);
  });

  it("compiles for this machine on bare, never for linux-musl", async () => {
    const { shell, task } = await createTestEnv();

    await task.run(createCtx(shell, bare));

    const calls = shell.getCallsMatching(/^bun build/);
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toMatch(
      /^bun build --compile --target=bun-(darwin|linux|windows)-(x64|arm64) --minify --outfile=loom index\.js$/,
    );
    expect(calls[0].command).not.toContain("musl");
    expect(calls[0].options.root).toBe("/project/dist");
  });

  it("compiles for linux-musl on docker", async () => {
    const { shell, task } = await createTestEnv();

    await task.run(createCtx(shell, { ...bare, target: "docker" }));

    expect(
      shell.wasCalledMatching(
        /^bun build --compile --target=bun-linux-(x64|arm64)-musl --minify --outfile=loom index\.js$/,
      ),
    ).toBe(true);
  });

  it("honours an explicit target and minify=false", async () => {
    const { shell, task } = await createTestEnv();

    await task.run(
      createCtx(shell, {
        ...bare,
        compile: { name: "loom", target: "bun-linux-x64", minify: false },
      }),
    );

    expect(
      shell.wasCalled(
        "bun build --compile --target=bun-linux-x64 --outfile=loom index.js",
      ),
    ).toBe(true);
  });

  it("removes what the binary now carries, and keeps manifest.json", async () => {
    const { fs, shell, task } = await createTestEnv();

    await task.run(createCtx(shell, bare));

    expect(await fs.exists("/project/dist/index.js")).toBe(false);
    expect(await fs.exists("/project/dist/server")).toBe(false);
    expect(await fs.exists("/project/dist/package.json")).toBe(false);
    expect(await fs.exists("/project/dist/public")).toBe(false);
    expect(await fs.exists("/project/dist/manifest.json")).toBe(true);
  });

  it("copies migrations beside the binary on bare", async () => {
    const { fs, shell, task } = await createTestEnv();
    await fs.writeFile("/project/migrations/001.sql", "CREATE TABLE x;");

    await task.run(createCtx(shell, bare));

    expect(await fs.exists("/project/dist/migrations/001.sql")).toBe(true);
  });

  it("refuses dependencies Vite left external", async () => {
    const { fs, shell, task } = await createTestEnv();
    await fs.writeFile(
      "/project/dist/package.json",
      JSON.stringify({ dependencies: { sharp: "^0.33.0" } }),
    );

    await expect(task.run(createCtx(shell, bare))).rejects.toThrow(
      /not bundled by Vite.*sharp/,
    );
    expect(shell.wasCalledMatching(/^bun build/)).toBe(false);
  });

  it("builds the docker image only once the binary exists", async () => {
    const { shell, task } = await createTestEnv();

    await task.run(
      createCtx(
        shell,
        {
          ...bare,
          target: "docker",
          docker: { image: { tag: "ghcr.io/myorg/loom" } },
        },
        { flags: { image: true } },
      ),
    );

    const commands = shell.calls.map((call) => call.command);
    const compiled = commands.findIndex((it) => it.startsWith("bun build"));
    const imaged = commands.findIndex((it) => it.startsWith("docker build"));
    expect(compiled).toBeGreaterThanOrEqual(0);
    expect(imaged).toBeGreaterThan(compiled);
  });
});
