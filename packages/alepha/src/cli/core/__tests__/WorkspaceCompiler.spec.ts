import { Alepha } from "alepha";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, expect, it } from "vitest";

import {
  WorkspaceCompiler,
  type WorkspaceCompileOptions,
} from "../services/WorkspaceCompiler.ts";

/**
 * `alepha compile`, as a service (epic #E63).
 *
 * It used to be `alepha build --compile`, a build option that reached back to
 * constrain `target`. Standalone it is three sentences: take the bun slice,
 * embed `public/`, emit a binary — and these cases are the same ones that
 * covered the task, moved across.
 */
describe("WorkspaceCompiler", () => {
  const createTestEnv = async () => {
    const alepha = Alepha.create()
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider });

    const fs = alepha.inject(MemoryFileSystemProvider);
    const shell = alepha.inject(MemoryShellProvider);
    const task = alepha.inject(WorkspaceCompiler);

    // A built app: the bun slice's entry wrapper, one server chunk in that
    // slice's own directory, a client bundle with its brotli sibling, a nested
    // public file, and the manifest.
    await fs.writeFile(
      "/project/dist/index.bun.js",
      `import './server/bun/abc.js';\n__alepha.set("alepha.react.ssr.manifest", {});\n`,
    );
    await fs.writeFile("/project/dist/server/bun/abc.js", "// chunk");
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
   * The options `alepha compile --out loom` resolves to. `builtAt` is pinned
   * so the embedded map's timestamp is assertable: 2026-01-02T03:04:05Z is
   * 1767323045000 ms.
   */
  const bare: WorkspaceCompileOptions = {
    root: "/project",
    name: "loom",
    minify: true,
    builtAt: 1767323045000,
  };

  it("embeds every public file in the bun slice and publishes the map with the build time", async () => {
    const { fs, task } = await createTestEnv();

    await task.compile(bare);

    const written = (pattern: RegExp) =>
      fs.wasWrittenMatching("/project/dist/index.bun.js", pattern);
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
    // The generated entry keeps what it had: its own slice's chunk first.
    expect(written(/^import '\.\/server\/bun\/abc\.js';/)).toBe(true);
  });

  /**
   * ⚠️ The one failure this task must never handle gracefully.
   *
   * The node slice runs under Bun, so compiling it would succeed and produce a
   * working binary — built from the generic bundle, with every Bun-native API
   * and every dependency the bun conditions exist to drop still inside it. A
   * binary that works is the worst outcome available, because nothing ever
   * says the wrong slice was taken.
   */
  describe("when the build produced no bun slice", () => {
    const withoutTheBunSlice = async () => {
      const env = await createTestEnv();
      await env.fs.rm("/project/dist/index.bun.js");
      return env;
    };

    it("fails, naming the slice and the flag that produces it", async ({
      expect,
    }) => {
      const { task } = await withoutTheBunSlice();
      await expect(task.compile(bare)).rejects.toThrow(
        /index\.bun\.js.*--runtime bun/s,
      );
    });

    it("never falls back to a node slice that happens to be there", async ({
      expect,
    }) => {
      const { fs, shell, task } = await withoutTheBunSlice();
      await fs.writeFile("/project/dist/index.node.js", "// the wrong slice");

      await expect(task.compile(bare)).rejects.toThrow();
      // Nothing was compiled, and the node slice is untouched.
      expect(shell.wasCalledMatching(/^bun build/)).toBe(false);
      expect(await fs.exists("/project/dist/index.node.js")).toBe(true);
    });
  });

  it("compiles for this machine on bare, never for linux-musl", async () => {
    const { shell, task } = await createTestEnv();

    await task.compile(bare);

    const calls = shell.getCallsMatching(/^bun build/);
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toMatch(
      /^bun build --compile --target=bun-(darwin|linux|windows)-(x64|arm64) --minify --outfile=loom index\.bun\.js$/,
    );
    expect(calls[0].command).not.toContain("musl");
    expect(calls[0].options.root).toBe("/project/dist");
  });

  /**
   * ⚠️ A Bun `--compile` binary is not fully static: the triple picks the
   * libc. `alepha image` asks for the musl one so the binary it puts on a
   * minimal base actually starts, rather than exiting immediately with an
   * error about nothing.
   */
  it("compiles for linux-musl when asked for it", async () => {
    const { shell, task } = await createTestEnv();

    await task.compile({
      ...bare,
      target: task.defaultBunTarget({ musl: true }),
    });

    expect(
      shell.wasCalledMatching(
        /^bun build --compile --target=bun-linux-(x64|arm64)-musl --minify --outfile=loom index\.bun\.js$/,
      ),
    ).toBe(true);
  });

  it("honours an explicit target and minify=false", async () => {
    const { shell, task } = await createTestEnv();

    await task.compile({ ...bare, target: "bun-linux-x64", minify: false });

    expect(
      shell.wasCalled(
        "bun build --compile --target=bun-linux-x64 --outfile=loom index.bun.js",
      ),
    ).toBe(true);
  });

  it("removes what the binary now carries, and keeps manifest.json", async () => {
    const { fs, task } = await createTestEnv();

    await task.compile(bare);

    expect(await fs.exists("/project/dist/index.bun.js")).toBe(false);
    expect(await fs.exists("/project/dist/server")).toBe(false);
    expect(await fs.exists("/project/dist/package.json")).toBe(false);
    expect(await fs.exists("/project/dist/public")).toBe(false);
    expect(await fs.exists("/project/dist/manifest.json")).toBe(true);
  });

  /**
   * ⚠️ Compiling CONSUMES `dist/`. `server/` and `public/` both go, because
   * the binary carries them, so a sibling `index.node.js` left behind would
   * import a `server/node/` that is no longer there: a file that looks
   * runnable, is not, and fails with a resolution error naming nothing about
   * the compile that removed its chunks.
   *
   * The slices come from the manifest, which is the discovery mechanism for
   * them.
   */
  it("removes every slice's wrapper, not just the compiled one", async ({
    expect,
  }) => {
    const { fs, task } = await createTestEnv();
    await fs.writeFile(
      "/project/dist/index.node.js",
      "import './server/node/a.js';",
    );
    await fs.writeFile("/project/dist/server/node/a.js", "// chunk");
    await fs.writeFile(
      "/project/dist/manifest.json",
      JSON.stringify({
        runtime: "bun",
        runtimes: [
          { runtime: "bun", entry: "index.bun.js" },
          { runtime: "node", entry: "index.node.js" },
        ],
      }),
    );

    await task.compile(bare);

    expect(await fs.exists("/project/dist/index.bun.js")).toBe(false);
    expect(await fs.exists("/project/dist/index.node.js")).toBe(false);
    expect(await fs.exists("/project/dist/server")).toBe(false);
    expect(await fs.exists("/project/dist/manifest.json")).toBe(true);
  });

  it("copies migrations beside the binary", async () => {
    const { fs, task } = await createTestEnv();
    await fs.writeFile("/project/migrations/001.sql", "CREATE TABLE x;");

    await task.compile(bare);

    expect(await fs.exists("/project/dist/migrations/001.sql")).toBe(true);
  });

  it("refuses dependencies Vite left external", async () => {
    const { fs, shell, task } = await createTestEnv();
    await fs.writeFile(
      "/project/dist/package.json",
      JSON.stringify({ dependencies: { sharp: "^0.33.0" } }),
    );

    await expect(task.compile(bare)).rejects.toThrow(
      /not bundled by Vite.*sharp/,
    );
    expect(shell.wasCalledMatching(/^bun build/)).toBe(false);
  });
});
