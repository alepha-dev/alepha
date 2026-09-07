import { Alepha } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, it } from "vitest";

import { ArtifactTarReader } from "../src/api/services/ArtifactTarReader.ts";
import { gzip, tar } from "./fixtures/artifactTarball.ts";

/**
 * Unpacking an artifact into the filesystem a deploy builds against (#288).
 *
 * ⚠️ **An extraction is not a bigger manifest scan.** The scan matched one
 * exact path and threw every body away, so what an entry WAS never mattered
 * and nothing it held could land anywhere. This holds the bytes and writes them
 * by name, into a `MemoryFileSystemProvider` that `BuildCloudflareTask` then
 * reads - so a path that climbs out of the archive overwrites what the build is
 * about to read, and a symlink is a second escape vector beside `../`.
 */
describe("unpacking an artifact", () => {
  const setup = () => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } }).with({
      provide: FileSystemProvider,
      use: MemoryFileSystemProvider,
    });
    return {
      fs: alepha.inject(MemoryFileSystemProvider),
      reader: alepha.inject(ArtifactTarReader),
    };
  };

  const archive = (entries: Parameters<typeof tar>[0]) => gzip(tar(entries));

  it("writes every file under the root it was given", async ({ expect }) => {
    const { fs, reader } = setup();

    const result = await reader.extract(
      await archive({
        "dist/index.js": "console.log(1);",
        "dist/manifest.json": '{"version":1}',
        "migrations/sqlite/0001.sql": "SELECT 1;",
      }),
      fs,
      "/deploy",
    );

    expect(result.files).toBe(3);
    expect(await fs.readTextFile("/deploy/dist/index.js")).toBe(
      "console.log(1);",
    );
    expect(await fs.readTextFile("/deploy/migrations/sqlite/0001.sql")).toBe(
      "SELECT 1;",
    );
  });

  it("keeps a zero-length file, which is not the same as an absent one", async ({
    expect,
  }) => {
    const { fs, reader } = setup();

    await reader.extract(
      await archive({ "dist/empty.txt": "", "dist/manifest.json": "{}" }),
      fs,
      "/deploy",
    );

    expect(await fs.exists("/deploy/dist/empty.txt")).toBe(true);
  });

  it("refuses a path that climbs out of the archive", async ({ expect }) => {
    // The zip-slip case, and it is worse here than on a real filesystem: the
    // MemoryFS is SHARED with the build task, so an escaped path overwrites
    // what the build is about to read rather than a file somewhere on disk.
    const { fs, reader } = setup();

    await expect(
      reader.extract(
        await archive({ "dist/../../etc/passwd": "root::0:0" }),
        fs,
        "/deploy",
      ),
    ).rejects.toThrowError(/climbs out of the archive/);
  });

  it("refuses an absolute path", async ({ expect }) => {
    const { fs, reader } = setup();

    await expect(
      reader.extract(await archive({ "/etc/passwd": "x" }), fs, "/deploy"),
    ).rejects.toThrowError(/will not unpack/);
  });

  it("refuses a symlink rather than writing it out as a file", async ({
    expect,
  }) => {
    // A symlink entry has no body, so ignoring the typeflag writes a zero-byte
    // regular file where a link was meant - or, on a real filesystem, a link
    // pointing anywhere at all. `alepha pack` writes none, so one here is
    // either a different tool's output or an attack.
    const { fs, reader } = setup();

    await expect(
      reader.extract(
        await archive({
          "dist/index.js": "1",
          "dist/evil": { content: "", typeflag: "2" },
        }),
        fs,
        "/deploy",
      ),
    ).rejects.toThrowError(/contains a link/);
  });

  it("refuses a GNU long-name record rather than writing its pseudo-name", async ({
    expect,
  }) => {
    const { fs, reader } = setup();

    await expect(
      reader.extract(
        await archive({
          "././@LongLink": { content: "a/very/long/path", typeflag: "L" },
        }),
        fs,
        "/deploy",
      ),
    ).rejects.toThrowError(/GNU long-name records/);
  });

  it("creates a directory entry, and the directories a file implies", async ({
    expect,
  }) => {
    const { fs, reader } = setup();

    await reader.extract(
      await archive({
        "dist/": { typeflag: "5" },
        "dist/server/app.js": "1",
      }),
      fs,
      "/deploy",
    );

    expect(await fs.exists("/deploy/dist/server/app.js")).toBe(true);
  });

  it("refuses an archive with more entries than a deploy will unpack", async ({
    expect,
  }) => {
    const { fs, reader } = setup();
    const many: Record<string, string> = {};
    for (let i = 0; i < 20_001; i++) {
      many[`dist/f${i}`] = "";
    }

    await expect(
      reader.extract(await archive(many), fs, "/deploy"),
    ).rejects.toThrowError(/more than a deploy will unpack/);
  });

  it("still reads a manifest, through the same walk", async ({ expect }) => {
    // ⚠️ The regression that matters: `readManifest` and `extract` share one
    // tar walk now. A second copy of that streaming arithmetic is a copy that
    // drifts, in a reader whose whole job is to refuse malformed input.
    const { reader } = setup();

    const manifest = await reader.readManifest(
      await archive({
        "dist/index.js": "1",
        "dist/manifest.json": JSON.stringify({
          version: 1,
          runtime: "workerd",
        }),
      }),
    );

    expect(manifest.runtime).toBe("workerd");
  });
});
