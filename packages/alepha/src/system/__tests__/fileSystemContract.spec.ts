import { tmpdir } from "node:os";
import { join } from "node:path";

import { Alepha, type FileLike, type StreamLike } from "alepha";
import { afterAll, describe, expect, it } from "vitest";

import type { FileSystemProvider } from "../providers/FileSystemProvider.ts";
import { MemoryFileSystemProvider } from "../providers/MemoryFileSystemProvider.ts";
import { NodeFileSystemProvider } from "../providers/NodeFileSystemProvider.ts";

/**
 * Every FileSystemProvider implementation must satisfy the SAME behavior
 * table — this is the filesystem twin of `shellStringContract.spec.ts`.
 *
 * The point is service substitution: a test that runs against
 * `MemoryFileSystemProvider` must mean something about production running
 * against `NodeFileSystemProvider`. Every divergence found by review #92
 * (mkdir defaults, cp force, implicit directories) lived exactly in the gap
 * this suite closes.
 */
const implementations = [
  {
    name: "NodeFileSystemProvider",
    create: () => Alepha.create().inject(NodeFileSystemProvider),
  },
  {
    name: "MemoryFileSystemProvider",
    create: () => Alepha.create().inject(MemoryFileSystemProvider),
  },
];

/**
 * Reads a StreamLike (node Readable or web ReadableStream) fully as a string.
 */
const streamToString = async (stream: StreamLike): Promise<string> => {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
};

const roots: string[] = [];

afterAll(async () => {
  const alepha = Alepha.create();
  const fs = alepha.inject(NodeFileSystemProvider);
  for (const root of roots) {
    await fs.rm(root, { recursive: true, force: true });
  }
});

for (const impl of implementations) {
  describe(`FileSystemProvider contract — ${impl.name}`, () => {
    let counter = 0;

    /**
     * A fresh, existing base directory per test, valid on both backends.
     */
    const setup = async (): Promise<{
      fs: FileSystemProvider;
      base: string;
    }> => {
      const fs = impl.create();
      const base = join(
        tmpdir(),
        `alepha-fs-contract-${process.pid}-${counter++}`,
      );
      roots.push(base);
      await fs.mkdir(base);
      return { fs, base };
    };

    describe("mkdir", () => {
      it("is recursive by default: creates parents and reports them via exists()", async () => {
        const { fs, base } = await setup();
        await fs.mkdir(join(base, "a/b/c"));
        expect(await fs.exists(join(base, "a"))).toBe(true);
        expect(await fs.exists(join(base, "a/b"))).toBe(true);
        expect(await fs.exists(join(base, "a/b/c"))).toBe(true);
      });

      it("tolerates an existing directory by default", async () => {
        const { fs, base } = await setup();
        const dir = join(base, "dup");
        await fs.mkdir(dir);
        await expect(fs.mkdir(dir)).resolves.toBeUndefined();
      });

      it("throws EEXIST only when recursive and force are both disabled", async () => {
        const { fs, base } = await setup();
        const dir = join(base, "strict");
        await fs.mkdir(dir);
        await expect(
          fs.mkdir(dir, { recursive: false, force: false }),
        ).rejects.toThrow(/EEXIST/);
        // force defaults to true: an existing directory is fine even
        // without recursion.
        await expect(
          fs.mkdir(dir, { recursive: false }),
        ).resolves.toBeUndefined();
      });

      it("throws when non-recursive and the parent is missing", async () => {
        const { fs, base } = await setup();
        await expect(
          fs.mkdir(join(base, "no/such/parent"), { recursive: false }),
        ).rejects.toThrow();
      });
    });

    describe("exists", () => {
      it("sees files, directories, and nothing else", async () => {
        const { fs, base } = await setup();
        await fs.writeFile(join(base, "f.txt"), "x");
        expect(await fs.exists(join(base, "f.txt"))).toBe(true);
        expect(await fs.exists(base)).toBe(true);
        expect(await fs.exists(join(base, "missing"))).toBe(false);
      });
    });

    describe("rm", () => {
      it("removes a file", async () => {
        const { fs, base } = await setup();
        const file = join(base, "f.txt");
        await fs.writeFile(file, "x");
        await fs.rm(file);
        expect(await fs.exists(file)).toBe(false);
      });

      it("removes a directory tree with recursive", async () => {
        const { fs, base } = await setup();
        await fs.mkdir(join(base, "tree/deep"));
        await fs.writeFile(join(base, "tree/deep/f.txt"), "x");
        await fs.rm(join(base, "tree"), { recursive: true });
        expect(await fs.exists(join(base, "tree"))).toBe(false);
        expect(await fs.exists(join(base, "tree/deep/f.txt"))).toBe(false);
      });

      it("refuses a directory without recursive", async () => {
        const { fs, base } = await setup();
        await fs.mkdir(join(base, "dir"));
        await expect(fs.rm(join(base, "dir"))).rejects.toThrow();
      });

      it("throws on a missing path unless force is set", async () => {
        const { fs, base } = await setup();
        await expect(fs.rm(join(base, "nope"))).rejects.toThrow();
        await expect(
          fs.rm(join(base, "nope"), { force: true }),
        ).resolves.toBeUndefined();
      });
    });

    describe("cp", () => {
      it("overwrites an existing destination file by default", async () => {
        const { fs, base } = await setup();
        await fs.writeFile(join(base, "src.txt"), "new");
        await fs.writeFile(join(base, "dest.txt"), "old");
        await fs.cp(join(base, "src.txt"), join(base, "dest.txt"));
        expect(await fs.readTextFile(join(base, "dest.txt"))).toBe("new");
      });

      it("throws instead of silently skipping when force is false", async () => {
        const { fs, base } = await setup();
        await fs.writeFile(join(base, "src.txt"), "new");
        await fs.writeFile(join(base, "dest.txt"), "old");
        await expect(
          fs.cp(join(base, "src.txt"), join(base, "dest.txt"), {
            force: false,
          }),
        ).rejects.toThrow();
        expect(await fs.readTextFile(join(base, "dest.txt"))).toBe("old");
      });

      it("copies a directory tree, including nested directories", async () => {
        const { fs, base } = await setup();
        await fs.mkdir(join(base, "from/nested"));
        await fs.writeFile(join(base, "from/f.txt"), "a");
        await fs.writeFile(join(base, "from/nested/g.txt"), "b");
        await fs.cp(join(base, "from"), join(base, "to"));
        expect(await fs.readTextFile(join(base, "to/f.txt"))).toBe("a");
        expect(await fs.readTextFile(join(base, "to/nested/g.txt"))).toBe("b");
        expect(await fs.exists(join(base, "to/nested"))).toBe(true);
      });

      it("throws on a missing source", async () => {
        const { fs, base } = await setup();
        await expect(
          fs.cp(join(base, "nope"), join(base, "dest")),
        ).rejects.toThrow();
      });
    });

    describe("ls", () => {
      it("lists entries, hides dotfiles by default, includes them on demand", async () => {
        const { fs, base } = await setup();
        await fs.writeFile(join(base, "a.txt"), "a");
        await fs.mkdir(join(base, "sub"));
        await fs.writeFile(join(base, ".hidden"), "h");

        const entries = await fs.ls(base);
        expect(entries).toContain("a.txt");
        expect(entries).toContain("sub");
        expect(entries).not.toContain(".hidden");

        const all = await fs.ls(base, { hidden: true });
        expect(all).toContain(".hidden");
      });

      it("lists nested paths with recursive", async () => {
        const { fs, base } = await setup();
        await fs.mkdir(join(base, "sub"));
        await fs.writeFile(join(base, "sub/inner.txt"), "x");
        const entries = await fs.ls(base, { recursive: true });
        expect(entries).toContain("sub");
        expect(entries.some((e) => e.endsWith(join("sub", "inner.txt")))).toBe(
          true,
        );
      });

      it("throws on a missing directory", async () => {
        const { fs, base } = await setup();
        await expect(fs.ls(join(base, "nope"))).rejects.toThrow();
      });
    });

    describe("read / write", () => {
      it("round-trips text, buffers, and FileLike payloads", async () => {
        const { fs, base } = await setup();

        await fs.writeFile(join(base, "s.txt"), "text");
        expect(await fs.readTextFile(join(base, "s.txt"))).toBe("text");

        await fs.writeFile(join(base, "b.bin"), Buffer.from([1, 2, 3]));
        expect([...(await fs.readFile(join(base, "b.bin")))]).toEqual([
          1, 2, 3,
        ]);

        const file: FileLike = fs.createFile({ text: "from-file-like" });
        await fs.writeFile(join(base, "fl.txt"), file);
        expect(await fs.readTextFile(join(base, "fl.txt"))).toBe(
          "from-file-like",
        );
      });

      it("throws when reading a missing file", async () => {
        const { fs, base } = await setup();
        await expect(fs.readFile(join(base, "nope.txt"))).rejects.toThrow();
      });

      it("appends to an existing file instead of replacing it", async () => {
        const { fs, base } = await setup();
        const path = join(base, "log.jsonl");

        await fs.writeFile(path, "first\n");
        await fs.appendFile(path, "second\n");
        await fs.appendFile(path, "third\n");

        expect(await fs.readTextFile(path)).toBe("first\nsecond\nthird\n");
      });

      it("creates the file when appending to a path that does not exist", async () => {
        const { fs, base } = await setup();
        const path = join(base, "fresh.jsonl");

        await fs.appendFile(path, "line\n");

        expect(await fs.exists(path)).toBe(true);
        expect(await fs.readTextFile(path)).toBe("line\n");
      });

      it("appends binary payloads byte for byte", async () => {
        const { fs, base } = await setup();
        const path = join(base, "b.bin");

        await fs.appendFile(path, Buffer.from([1, 2]));
        await fs.appendFile(path, Buffer.from([3]));

        expect([...(await fs.readFile(path))]).toEqual([1, 2, 3]);
      });

      it("round-trips JSON through writeJsonFile/readJsonFile", async () => {
        const { fs, base } = await setup();
        const value = { name: "alepha", nested: { n: 1 } };
        await fs.writeJsonFile(join(base, "conf.json"), value);
        expect(await fs.readJsonFile(join(base, "conf.json"))).toEqual(value);
        // Pretty-printed, because humans read these files in git diffs.
        expect(await fs.readTextFile(join(base, "conf.json"))).toContain("\n");
      });
    });

    describe("stat", () => {
      it("reports size and kind for files and directories", async () => {
        const { fs, base } = await setup();
        await fs.writeFile(join(base, "f.txt"), "12345");

        const file = await fs.stat(join(base, "f.txt"));
        expect(file.size).toBe(5);
        expect(file.isFile).toBe(true);
        expect(file.isDirectory).toBe(false);
        expect(file.mtimeMs).toBeGreaterThan(0);

        const dir = await fs.stat(base);
        expect(dir.isDirectory).toBe(true);
        expect(dir.isFile).toBe(false);
      });

      it("throws on a missing path", async () => {
        const { fs, base } = await setup();
        await expect(fs.stat(join(base, "nope"))).rejects.toThrow();
      });
    });

    describe("readFileStream", () => {
      it("streams the file content", async () => {
        const { fs, base } = await setup();
        await fs.writeFile(join(base, "s.txt"), "streamed-content");
        const stream = await fs.readFileStream(join(base, "s.txt"));
        expect(await streamToString(stream)).toBe("streamed-content");
      });

      it("throws on a missing file", async () => {
        const { fs, base } = await setup();
        await expect(fs.readFileStream(join(base, "nope"))).rejects.toThrow();
      });
    });

    describe("createFile", () => {
      it("builds a readable FileLike from a stored path", async () => {
        const { fs, base } = await setup();
        await fs.writeFile(join(base, "doc.md"), "# hello");
        const file = fs.createFile({ path: join(base, "doc.md") });
        expect(file.name).toBe("doc.md");
        expect(await file.text()).toBe("# hello");
        expect(await streamToString(file.stream())).toBe("# hello");
      });

      it("serves stream() repeatedly from buffer and text sources", async () => {
        const { fs } = await setup();
        const file = fs.createFile({ buffer: Buffer.from("again"), name: "a" });
        expect(await streamToString(file.stream())).toBe("again");
        expect(await streamToString(file.stream())).toBe("again");
      });
    });
  });
}
