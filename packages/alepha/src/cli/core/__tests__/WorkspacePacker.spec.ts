import { Alepha } from "alepha";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, it } from "vitest";

import { WorkspacePacker } from "../services/WorkspacePacker.ts";

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
      .with({ provide: ShellProvider, use: MemoryShellProvider });

    const fs = alepha.inject(MemoryFileSystemProvider);
    const shell = alepha.inject(MemoryShellProvider);
    // `find` is what decides whether a maps archive is written at all, so the
    // fake answers it the way a real one would: newline-separated paths, or
    // nothing.
    shell.outputs.set(
      "sh -c \"find 'dist' -name '*.map' -type f -print\"",
      (options.maps ?? []).join("\n"),
    );

    const commands = () => shell.calls.map((it) => it.command);

    return {
      alepha,
      fs,
      shell,
      commands,
      packer: alepha.inject(WorkspacePacker),
    };
  };

  const aWorkspace = async (fs: MemoryFileSystemProvider) => {
    await fs.writeFile(
      "/project/package.json",
      JSON.stringify({ name: "@acme/app" }),
    );
    await fs.writeFile("/project/dist/index.js", "console.log(1);");
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

    const tarCommand = commands().find((it) => it.includes("tar -czf")) as
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
    const { fs, commands, packer } = create({
      maps: ["dist/index.js.map", "dist/server/app.js.map"],
    });
    await aWorkspace(fs);

    const result = await packer.pack({
      root: "/project",
      output: "/out",
      tag: "1.2.3",
    });

    expect(result.filename).toBe("acme-app-1.2.3.tar.gz");
    expect(result.maps?.filename).toBe("acme-app-1.2.3.maps.tar.gz");
    expect(result.maps?.outputPath).toBe("/out/acme-app-1.2.3.maps.tar.gz");

    // ⚠️ `-T <list>` rather than the paths as arguments: a large build has
    // thousands of maps and an argument list has a ceiling.
    const mapsCommand = commands().find((it) => it.includes("maps.tar.gz'")) as
      | string
      | undefined;
    expect(mapsCommand).toContain("-T '/out/acme-app-1.2.3.maps.tar.gz.list'");
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
    expect(commands().some((it) => it.includes("maps.tar.gz"))).toBe(false);
  });

  it("removes the list file it wrote", async ({ expect }) => {
    const { fs, packer } = create({ maps: ["dist/index.js.map"] });
    await aWorkspace(fs);

    await packer.pack({ root: "/project", output: "/out", tag: "1.2.3" });

    expect(fs.wasDeleted("/out/acme-app-1.2.3.maps.tar.gz.list")).toBe(true);
  });
});
