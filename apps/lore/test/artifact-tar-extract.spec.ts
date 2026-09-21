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
        "index.node.js": "console.log(1);",
        "manifest.json": '{"version":1}',
        "migrations/sqlite/0001.sql": "SELECT 1;",
      }),
      fs,
      "/deploy",
    );

    expect(result.files).toBe(3);
    expect(await fs.readTextFile("/deploy/index.node.js")).toBe(
      "console.log(1);",
    );
    expect(await fs.readTextFile("/deploy/migrations/sqlite/0001.sql")).toBe(
      "SELECT 1;",
    );
  });

  /**
   * ⚠️ **The reason this option exists is a 128 MB isolate, not tidiness.**
   *
   * Writing every entry meant a site's whole `dist/public` was resident before
   * the build read a byte: `apps/docs` is 49 MB across 1629 files, and the
   * deploy died with `Worker exceeded memory limit` while unpacking. A skipped
   * entry is still walked and still offered, so a caller can hash it and let
   * it go.
   */
  describe("an entry the caller does not want stored", () => {
    it("is offered with its bytes and never written", async ({ expect }) => {
      const { fs, reader } = setup();
      const seen: Array<{ path: string; text: string }> = [];

      const result = await reader.extract(
        await archive({
          "index.node.js": "console.log(1);",
          "public/app.css": "body{color:red}",
          "public/nested/logo.svg": "<svg/>",
        }),
        fs,
        "/deploy",
        {
          skip: (path) => path.startsWith("/deploy/public/"),
          onSkipped: (path, body) => {
            seen.push({ path, text: new TextDecoder().decode(body) });
          },
        },
      );

      expect(seen).toEqual([
        { path: "/deploy/public/app.css", text: "body{color:red}" },
        { path: "/deploy/public/nested/logo.svg", text: "<svg/>" },
      ]);
      expect(result.skipped).toBe(2);
      // Still counted as walked, so a caller reading `files` sees the archive.
      expect(result.files).toBe(3);
      // And the one entry that was wanted is the only one on disk.
      expect(await fs.exists("/deploy/index.node.js")).toBe(true);
      expect(await fs.exists("/deploy/public/app.css")).toBe(false);
    });

    it("does not spend the extraction budget on what it never keeps", async ({
      expect,
    }) => {
      // `bytes` is what a deploy is holding, and it is the number
      // MAX_EXTRACTED_BYTES bounds. Counting streamed assets against it would
      // refuse exactly the artifacts this option exists to make deployable.
      const { fs, reader } = setup();

      const result = await reader.extract(
        await archive({
          "index.node.js": "abc",
          "public/big.txt": "x".repeat(5000),
        }),
        fs,
        "/deploy",
        { skip: (path) => path.includes("/public/") },
      );

      expect(result.bytes).toBe(3);
    });
  });

  it("keeps a zero-length file, which is not the same as an absent one", async ({
    expect,
  }) => {
    const { fs, reader } = setup();

    await reader.extract(
      await archive({ "empty.txt": "", "manifest.json": "{}" }),
      fs,
      "/deploy",
    );

    expect(await fs.exists("/deploy/empty.txt")).toBe(true);
  });

  /**
   * ⚠️ The entry a REAL tar writes, and the one this suite could not have
   * invented for itself.
   *
   * `alepha pack` builds the artifact with `tar -C <dist> .` so the build's
   * contents land at the archive root, and both GNU and BSD tar emit a `./`
   * entry for the directory itself when handed `.`. Every fixture here names
   * its entries explicitly, so none of them ever produced one - the fixture
   * agreed with the parser because the same hand wrote both.
   *
   * It reached production: the docs and ui deploys failed on
   * `This artifact contains a path a deploy will not unpack ()`, whose empty
   * parens are the whole diagnosis.
   */
  it("skips the ./ root entry a real tar writes", async ({ expect }) => {
    const { fs, reader } = setup();

    const result = await reader.extract(
      await archive({
        "./": { content: "", typeflag: "5" },
        "index.node.js": "console.log(1);",
        "manifest.json": "{}",
      }),
      fs,
      "/deploy",
    );

    expect(await fs.exists("/deploy/index.node.js")).toBe(true);
    // The root entry writes nothing and is not counted as a file.
    expect(result.files).not.toContain("");
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
    ).rejects.toThrow(/climbs out of the archive/);
  });

  it("refuses an absolute path", async ({ expect }) => {
    const { fs, reader } = setup();

    await expect(
      reader.extract(await archive({ "/etc/passwd": "x" }), fs, "/deploy"),
    ).rejects.toThrow(/will not unpack/);
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
          "index.node.js": "1",
          "dist/evil": { content: "", typeflag: "2" },
        }),
        fs,
        "/deploy",
      ),
    ).rejects.toThrow(/contains a link/);
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
    ).rejects.toThrow(/GNU long-name records/);
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
    ).rejects.toThrow(/more than a deploy will unpack/);
  });

  it("still reads a manifest, through the same walk", async ({ expect }) => {
    // ⚠️ The regression that matters: `readManifest` and `extract` share one
    // tar walk now. A second copy of that streaming arithmetic is a copy that
    // drifts, in a reader whose whole job is to refuse malformed input.
    const { reader } = setup();

    const manifest = await reader.readManifest(
      await archive({
        "index.node.js": "1",
        "manifest.json": JSON.stringify({
          runtimes: [{ runtime: "workerd", entry: "index.workerd.js" }],
        }),
      }),
    );

    expect(manifest.runtimes[0]?.runtime).toBe("workerd");
  });
});
