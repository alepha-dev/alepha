import { Alepha } from "alepha";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, it } from "vitest";

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
 * ⚠️ **`*.map` is excluded from the artifact and kept in a sibling** (#1515).
 * Measured on `apps/lore/dist`: 266 of 267 server JS files had a map, and they
 * were roughly 5 MB of a 6.4 MB gzipped archive that no runtime reads -
 * Cloudflare treats source maps as a separate opt-in. The exclusion is only
 * safe because the sibling exists: a pattern added to `EXCLUDES` with no route
 * for what it removes is how a diagnostic quietly stops existing.
 */
describe("WorkspacePacker", () => {
  const create = (options: { maps?: string[] } = {}) => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider })
      .with({ provide: ArchiveCompressor, use: MemoryArchiveCompressor });

    const fs = alepha.inject(MemoryFileSystemProvider);
    const shell = alepha.inject(MemoryShellProvider);
    // `find` is what decides whether a maps archive is written at all, so the
    // fake answers it the way a real one would: newline-separated paths, or
    // nothing.
    shell.outputs.set(
      "sh -c \"find . -name '*.map' -type f -print\"",
      (options.maps ?? []).join("\n"),
    );

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
      JSON.stringify({ version: 1, runtime: "node", project: "acme-app" }),
    );
  };

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

  it("writes the maps to a sibling archive when the build produced any", async ({
    expect,
  }) => {
    const { fs, commands, shell, packer } = create({
      maps: ["./index.node.js.map", "./server/node/app.js.map"],
    });
    await aWorkspace(fs);

    const result = await packer.pack({
      root: "/project",
      output: "/out",
      tag: "1.2.3",
    });

    expect(result.filename).toBe("acme-app-1.2.3.tar.zst");
    expect(result.maps?.filename).toBe("acme-app-1.2.3.maps.tar.zst");
    expect(result.maps?.outputPath).toBe("/out/acme-app-1.2.3.maps.tar.zst");

    // ⚠️ `-T <list>` rather than the paths as arguments: a large build has
    // thousands of maps and an argument list has a ceiling.
    const mapsCommand = commands().find((it) =>
      it.includes("maps.tar.zst.tar'"),
    ) as string | undefined;
    expect(mapsCommand).toContain("-T '/out/acme-app-1.2.3.maps.tar.zst.list'");
    // ⚠️ Rooted at `dist`, like the main archive, so a map lands at
    // `server/node/abc.js.map` beside the `server/node/abc.js` it describes.
    // Rooted anywhere else every path is off by one directory, and nothing
    // that symbolicates can line the two up.
    const mapsCall = shell.calls.find((it) =>
      it.command.includes("maps.tar.zst.tar'"),
    );
    expect(mapsCall?.options?.root).toBe("/project/dist");
  });

  it("writes no maps archive when the build produced none", async ({
    expect,
  }) => {
    // An empty tarball would be a stored object that says something false: it
    // would read as "this build has maps" to anything that checked for one.
    const { fs, commands, packer } = create({ maps: [] });
    await aWorkspace(fs);

    const result = await packer.pack({ root: "/project", output: "/out" });

    expect(result.maps).toBeUndefined();
    expect(commands().some((it) => it.includes("maps.tar"))).toBe(false);
  });

  it("removes the list file it wrote", async ({ expect }) => {
    const { fs, packer } = create({ maps: ["dist/index.js.map"] });
    await aWorkspace(fs);

    await packer.pack({ root: "/project", output: "/out", tag: "1.2.3" });

    expect(fs.wasDeleted("/out/acme-app-1.2.3.maps.tar.zst.list")).toBe(true);
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
