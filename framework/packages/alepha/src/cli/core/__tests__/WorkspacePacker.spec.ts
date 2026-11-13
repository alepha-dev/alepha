import { Alepha } from "alepha";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, it } from "vitest";

import { buildOptions } from "../atoms/buildOptions.ts";
import {
  ArchiveCompressor,
  MemoryArchiveCompressor,
} from "../services/ArchiveCompressor.ts";
import { WorkspacePacker } from "../services/WorkspacePacker.ts";

/*
 * The compression step reaches `node:fs` and `node:zlib` directly, because a
 * zstd stream operates on real descriptors and its input is a tar a real `tar`
 * binary just wrote. Neither exists here, where the shell is a fake — so
 * `ArchiveCompressor` is substituted and the shell command it wraps is what
 * these cases read. The compression itself is measured in
 * `WorkspacePackerZstd.spec.ts`, against real files, which is the only place
 * it can be.
 */

/**
 * What `alepha pack` writes, and what it deliberately leaves out.
 *
 * ⚠️ **`*.map` is excluded from the artifact.** Measured on Lore's `dist`:
 * 266 of 267 server JS files had a map, and they were roughly 5 MB of a
 * 6.4 MB gzipped archive that no runtime reads.
 */
describe("WorkspacePacker", () => {
  const create = () => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider })
      .with({ provide: ArchiveCompressor, use: MemoryArchiveCompressor });

    const fs = alepha.inject(MemoryFileSystemProvider);
    const shell = alepha.inject(MemoryShellProvider);

    const commands = () => shell.calls.map((it) => it.command);

    return {
      alepha,
      fs,
      shell,
      commands,
      compressor: alepha.inject(MemoryArchiveCompressor),
      packer: alepha.inject(WorkspacePacker),
    };
  };

  const aWorkspace = async (fs: MemoryFileSystemProvider) => {
    await fs.writeFile(
      "/project/package.json",
      JSON.stringify({ name: "@acme/app" }),
    );
    await fs.writeFile("/project/dist/index.node.js", "console.log(1);");
    // `resolveIncludes` refuses a `dist/` with no manifest, since that shape
    // packs cleanly and fails at deploy time.
    await fs.writeFile(
      "/project/dist/manifest.json",
      JSON.stringify({
        manifestVersion: 2,
        runtimes: [{ runtime: "bun", entry: "index.bun.js" }],
        resources: {
          hasDatabase: false,
          hasBucket: false,
          hasAnalytics: false,
          hasKV: false,
          hasQueue: false,
          hasCron: false,
          hasWebSocket: false,
        },
        crons: [],
        secrets: [],
        variables: [],
        version: 1,
        runtime: "node",
        project: "acme-app",
      }),
    );
  };

  it("packs the configured build directory", async ({ expect }) => {
    const { alepha, fs, commands, packer } = create();
    await aWorkspace(fs);
    await fs.writeFile(
      "/project/release/manifest.json",
      await fs.readTextFile("/project/dist/manifest.json"),
    );
    await fs.rm("/project/dist", { recursive: true });
    alepha.set(buildOptions, { output: { dist: "release" } });
    await packer.pack({ root: "/project", output: "/out" });
    expect(commands().find((cmd) => cmd.includes("tar -cf"))).toContain(
      "-C '/project/release' .",
    );
  });

  it("excludes *.map from the artifact", async ({ expect }) => {
    const { fs, commands, packer } = create();
    await aWorkspace(fs);

    await packer.pack({ root: "/project", output: "/out" });

    const tarCommand = commands().find((it) => it.includes("tar -cf")) as
      | string
      | undefined;
    expect(tarCommand).toContain("--exclude='*.map'");
    // ⚠️ Quoted, so the shell cannot expand it against the cwd before `tar`
    // sees it. `--exclude='*.map'` matches at any depth in GNU and BSD tar.
    expect(tarCommand).not.toContain("--exclude=*.map ");
  });

  /**
   * ⚠️ The archive root is the CONTENTS, not a `dist/` wrapper (epic #E63).
   * `tar xf` must yield `./public`, `./index.node.js` and `./manifest.json` at
   * the top, with `migrations/` beside them.
   */
  describe("the archive root", () => {
    it("unwraps dist and keeps migrations named", async ({ expect }) => {
      const { fs, commands, packer } = create();
      await aWorkspace(fs);
      await fs.writeFile("/project/migrations/sqlite/0001.sql", "select 1;");

      await packer.pack({ root: "/project", output: "/out" });

      const tar = commands().find((it) => it.includes("tar -cf")) as string;
      // Repeated `-C` is positional: tar changes directory where the option
      // appears, so `dist`'s contents land at the root and `migrations` is
      // then added from one level up, under its own name.
      expect(tar).toContain("-C '/project/dist' .");
      expect(tar).toContain("-C '/project' 'migrations'");
      // The wrapper is gone: nothing may add `dist` as a named operand.
      expect(tar).not.toContain("'dist' 'migrations'");
    });

    it("packs a workspace with no migrations", async ({ expect }) => {
      const { fs, commands, packer } = create();
      await aWorkspace(fs);

      await packer.pack({ root: "/project", output: "/out" });

      const tar = commands().find((it) => it.includes("tar -cf")) as string;
      expect(tar).toContain("-C '/project/dist' .");
      expect(tar).not.toContain("migrations");
    });
  });

  /**
   * ⚠️ Not `tar --zstd`: it needs GNU tar 1.31+ on every machine that packs,
   * which macOS does not have, and it exposes no way to set `windowLog` — the
   * one setting the whole dedup depends on.
   */
  describe("the compression step", () => {
    it("tars uncompressed, then compresses into place", async ({ expect }) => {
      const { fs, commands, compressor, packer } = create();
      await aWorkspace(fs);

      const result = await packer.pack({ root: "/project", output: "/out" });

      const tar = commands().find((it) => it.includes("tar -c")) as string;
      expect(tar).toContain("tar -cf '/out/acme-app-latest.tar.zst.tar'");
      expect(tar).not.toContain("-czf");
      expect(tar).not.toContain("--zstd");
      expect(compressor.calls).toEqual([
        {
          input: "/out/acme-app-latest.tar.zst.tar",
          output: result.outputPath,
        },
      ]);
    });

    // The uncompressed tar is 61 MB for Lore and grows with every slice.
    // Leaving it behind would silently double what a pack costs on disk.
    it("removes the uncompressed tar", async ({ expect }) => {
      const { fs, packer } = create();
      await aWorkspace(fs);

      await packer.pack({ root: "/project", output: "/out" });

      expect(fs.wasDeleted("/out/acme-app-latest.tar.zst.tar")).toBe(true);
    });
  });
});
