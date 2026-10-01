import { Alepha } from "alepha";
import { beforeEach, describe, expect, it } from "vitest";

import { MemoryFileSystemProvider } from "../providers/MemoryFileSystemProvider.ts";

describe("MemoryFileSystemProvider", () => {
  let alepha: Alepha;
  let fs: MemoryFileSystemProvider;

  beforeEach(() => {
    alepha = Alepha.create();
    fs = alepha.inject(MemoryFileSystemProvider);
  });

  describe("writeFile/readFile", () => {
    it("should write and read string data", async () => {
      await fs.writeFile("/test.txt", "hello world");
      const content = await fs.readFile("/test.txt");
      expect(content.toString("utf-8")).toBe("hello world");
    });

    it("should write and read buffer data", async () => {
      const buf = Buffer.from("binary data");
      await fs.writeFile("/file.bin", buf);
      const content = await fs.readFile("/file.bin");
      expect(content).toEqual(buf);
    });

    it("should overwrite existing files", async () => {
      await fs.writeFile("/file.txt", "first");
      await fs.writeFile("/file.txt", "second");

      const content = await fs.readTextFile("/file.txt");
      expect(content).toBe("second");
    });

    it("should throw ENOENT when reading missing file", async () => {
      await expect(fs.readFile("/missing.txt")).rejects.toThrow("ENOENT");
    });
  });

  describe("readTextFile", () => {
    it("should return string content", async () => {
      await fs.writeFile("/hello.txt", "world");
      expect(await fs.readTextFile("/hello.txt")).toBe("world");
    });
  });

  describe("readJsonFile", () => {
    it("should parse JSON content", async () => {
      await fs.writeFile("/data.json", JSON.stringify({ key: "value" }));
      const data = await fs.readJsonFile("/data.json");
      expect(data).toEqual({ key: "value" });
    });
  });

  describe("mkdir", () => {
    it("should create a directory", async () => {
      await fs.mkdir("/mydir");
      expect(await fs.exists("/mydir")).toBe(true);
    });

    it("should create recursive directories", async () => {
      await fs.mkdir("a/b/c", { recursive: true });
      expect(await fs.exists("a")).toBe(true);
      expect(await fs.exists("a/b")).toBe(true);
      expect(await fs.exists("a/b/c")).toBe(true);
    });

    it("should create recursive directories from an absolute path", async () => {
      // Parents were rebuilt without the leading slash, so `/app/src` was
      // registered as `app/src` and `exists()` said no — diverging from the
      // node provider, where `mkdir -p` makes every parent visible.
      await fs.mkdir("/app/src/users", { recursive: true });

      expect(await fs.exists("/app")).toBe(true);
      expect(await fs.exists("/app/src")).toBe(true);
      expect(await fs.exists("/app/src/users")).toBe(true);
    });

    it("should tolerate a duplicate mkdir by default, like the node provider", async () => {
      // recursive AND force both default to true — the old behavior threw
      // EEXIST here while NodeFileSystemProvider succeeded, so code passed
      // its tests and failed in production (or vice versa).
      await fs.mkdir("/dir");
      await fs.mkdir("/dir"); // no error
      expect(await fs.exists("/dir")).toBe(true);
    });

    it("should throw EEXIST only when recursive and force are both disabled", async () => {
      await fs.mkdir("/dir");
      await expect(
        fs.mkdir("/dir", { recursive: false, force: false }),
      ).rejects.toThrow("EEXIST");
    });

    it("should register parents even without an explicit recursive flag", async () => {
      await fs.mkdir("/a/b/c");
      expect(await fs.exists("/a")).toBe(true);
      expect(await fs.exists("/a/b")).toBe(true);
    });

    it("should throw ENOENT for a non-recursive mkdir with a missing parent", async () => {
      await expect(
        fs.mkdir("/no/such/parent", { recursive: false }),
      ).rejects.toThrow("ENOENT");
    });

    it("should not throw for duplicate recursive mkdir", async () => {
      await fs.mkdir("/dir", { recursive: true });
      await fs.mkdir("/dir", { recursive: true }); // no error
      expect(await fs.exists("/dir")).toBe(true);
    });
  });

  describe("rm", () => {
    it("should remove a file", async () => {
      await fs.writeFile("/file.txt", "data");
      await fs.rm("/file.txt");
      expect(await fs.exists("/file.txt")).toBe(false);
    });

    it("should remove directory recursively", async () => {
      await fs.mkdir("/dir");
      await fs.writeFile("/dir/a.txt", "a");
      await fs.writeFile("/dir/b.txt", "b");
      await fs.mkdir("/dir/sub");
      await fs.writeFile("/dir/sub/c.txt", "c");

      await fs.rm("/dir", { recursive: true });

      expect(await fs.exists("/dir")).toBe(false);
      expect(await fs.exists("/dir/a.txt")).toBe(false);
      expect(await fs.exists("/dir/sub/c.txt")).toBe(false);
    });

    it("should throw EISDIR for directory without recursive", async () => {
      await fs.mkdir("/dir");
      await expect(fs.rm("/dir")).rejects.toThrow("EISDIR");
    });

    it("should throw ENOENT for missing path without force", async () => {
      await expect(fs.rm("/missing")).rejects.toThrow("ENOENT");
    });

    it("should not throw for missing path with force", async () => {
      await fs.rm("/missing", { force: true }); // no error
    });
  });

  describe("cp", () => {
    it("should copy a file", async () => {
      await fs.writeFile("/src.txt", "content");
      await fs.cp("/src.txt", "/dest.txt");

      expect(await fs.readTextFile("/dest.txt")).toBe("content");
      expect(await fs.readTextFile("/src.txt")).toBe("content"); // original intact
    });

    it("should copy a directory with contents", async () => {
      await fs.mkdir("/src");
      await fs.writeFile("/src/a.txt", "a");
      await fs.writeFile("/src/b.txt", "b");

      await fs.cp("/src", "/dest");

      expect(await fs.exists("/dest")).toBe(true);
      expect(await fs.readTextFile("/dest/a.txt")).toBe("a");
      expect(await fs.readTextFile("/dest/b.txt")).toBe("b");
    });

    it("should copy nested directories, not just their files", async () => {
      await fs.mkdir("/src/nested/empty");
      await fs.writeFile("/src/nested/file.txt", "x");

      await fs.cp("/src", "/dest");

      expect(await fs.exists("/dest/nested")).toBe(true);
      expect(await fs.exists("/dest/nested/empty")).toBe(true);
      expect(await fs.readTextFile("/dest/nested/file.txt")).toBe("x");
    });

    it("should throw EEXIST instead of overwriting when force is false", async () => {
      await fs.writeFile("/src.txt", "new");
      await fs.writeFile("/dest.txt", "old");

      await expect(
        fs.cp("/src.txt", "/dest.txt", { force: false }),
      ).rejects.toThrow("EEXIST");
      expect(await fs.readTextFile("/dest.txt")).toBe("old");
    });

    it("should throw ENOENT for missing source", async () => {
      await expect(fs.cp("/missing", "/dest")).rejects.toThrow("ENOENT");
    });
  });

  describe("ls", () => {
    it("should list files and directories", async () => {
      await fs.mkdir("/root/sub");
      await fs.writeFile("/root/file.txt", "data");

      const entries = await fs.ls("/root");
      expect(entries).toContain("file.txt");
      expect(entries).toContain("sub");
    });

    it("should return only top-level entries by default", async () => {
      await fs.mkdir("/root/sub");
      await fs.writeFile("/root/sub/nested.txt", "data");

      const entries = await fs.ls("/root");
      expect(entries).toContain("sub");
      expect(entries).not.toContain("sub/nested.txt");
    });

    it("should return nested paths with recursive option", async () => {
      await fs.writeFile("/root/a.txt", "a");
      await fs.writeFile("/root/sub/b.txt", "b");

      const entries = await fs.ls("/root", { recursive: true });
      expect(entries).toContain("a.txt");
      expect(entries).toContain("sub/b.txt");
    });

    it("should exclude hidden files by default", async () => {
      await fs.writeFile("/root/.hidden", "h");
      await fs.writeFile("/root/visible", "v");

      const entries = await fs.ls("/root");
      expect(entries).toContain("visible");
      expect(entries).not.toContain(".hidden");
    });

    it("should include hidden files when requested", async () => {
      await fs.writeFile("/root/.hidden", "h");
      await fs.writeFile("/root/visible", "v");

      const entries = await fs.ls("/root", { hidden: true });
      expect(entries).toContain("visible");
      expect(entries).toContain(".hidden");
    });
  });

  describe("exists", () => {
    it("should return true for existing files", async () => {
      await fs.writeFile("/file.txt", "data");
      expect(await fs.exists("/file.txt")).toBe(true);
    });

    it("should return true for existing directories", async () => {
      await fs.mkdir("/dir");
      expect(await fs.exists("/dir")).toBe(true);
    });

    it("should see implicit parents of written files", async () => {
      // `writeFile` implies its parents — `ls` always knew that, while
      // `exists` and `rm` said ENOENT for the very same directory.
      await fs.writeFile("/a/b/file.txt", "data");
      expect(await fs.exists("/a")).toBe(true);
      expect(await fs.exists("/a/b")).toBe(true);
    });

    it("should return false for missing paths", async () => {
      expect(await fs.exists("/nope")).toBe(false);
    });
  });

  describe("implicit directories", () => {
    it("rm removes an implicit directory and its files", async () => {
      await fs.writeFile("/impl/one.txt", "1");
      await fs.writeFile("/impl/deep/two.txt", "2");

      await fs.rm("/impl", { recursive: true });

      expect(await fs.exists("/impl")).toBe(false);
      expect(await fs.exists("/impl/one.txt")).toBe(false);
      expect(await fs.exists("/impl/deep/two.txt")).toBe(false);
    });
  });

  describe("createFile", () => {
    it("should create from stored path", async () => {
      await fs.writeFile("/data.txt", "file content");
      const file = fs.createFile({ path: "/data.txt" });

      expect(file.name).toBe("data.txt");
      expect(file.size).toBe(Buffer.from("file content").byteLength);
      expect(await file.text()).toBe("file content");
    });

    it("should create from buffer", () => {
      const buf = Buffer.from("buffer data");
      const file = fs.createFile({ buffer: buf });

      expect(file.name).toBe("file");
      expect(file.type).toBe("application/octet-stream");
      expect(file.size).toBe(buf.byteLength);
    });

    it("should create from text", () => {
      const file = fs.createFile({ text: "some text" });

      expect(file.name).toBe("file.txt");
      expect(file.type).toBe("text/plain");
    });

    it("should throw for missing path", () => {
      expect(() => fs.createFile({ path: "/missing" })).toThrow("ENOENT");
    });

    it("should use custom name and type", async () => {
      await fs.writeFile("/raw", "data");
      const file = fs.createFile({
        path: "/raw",
        name: "custom.csv",
        type: "text/csv",
      });

      expect(file.name).toBe("custom.csv");
      expect(file.type).toBe("text/csv");
    });
  });

  describe("test utilities", () => {
    it("wasWritten should track writes", async () => {
      await fs.writeFile("/a.txt", "data");
      expect(fs.wasWritten("/a.txt")).toBe(true);
      expect(fs.wasWritten("/b.txt")).toBe(false);
    });

    it("wasWrittenMatching should match content pattern", async () => {
      await fs.writeFile("/config.json", '{ "debug": true }');
      expect(fs.wasWrittenMatching("/config.json", /debug/)).toBe(true);
      expect(fs.wasWrittenMatching("/config.json", /production/)).toBe(false);
    });

    it("should record Uint8Array payloads as text, not comma-joined bytes", async () => {
      // A plain Uint8Array ignores toString("utf-8") — the call log stored
      // "104,105" and wasWrittenMatching could never match.
      await fs.writeFile("/u8.txt", new TextEncoder().encode("hi"));
      expect(fs.wasWrittenMatching("/u8.txt", /^hi$/)).toBe(true);
    });

    it("wasDeleted should track deletes", async () => {
      await fs.writeFile("/file.txt", "data");
      await fs.rm("/file.txt");
      expect(fs.wasDeleted("/file.txt")).toBe(true);
      expect(fs.wasDeleted("/other.txt")).toBe(false);
    });

    it("wasWrittenMatching reads the LAST write, not the first", async () => {
      // A scaffolder that writes a placeholder and then rewrites the real
      // thing left this asserting on the placeholder: green on content the
      // run had already thrown away, red on content it had just fixed.
      await fs.writeFile("/app.ts", "// TODO: generated");
      await fs.writeFile("/app.ts", "export const app = 1;");

      expect(fs.wasWrittenMatching("/app.ts", /export const app/)).toBe(true);
      expect(fs.wasWrittenMatching("/app.ts", /TODO/)).toBe(false);

      // ...and the history is still reachable when it is the subject.
      expect(fs.wasEverWrittenMatching("/app.ts", /TODO/)).toBe(true);
    });

    it("a write that threw is not reported as written", async () => {
      fs.writeFileError = new Error("disk full");
      await expect(fs.writeFile("/never.txt", "data")).rejects.toThrow(
        "disk full",
      );

      expect(fs.wasWritten("/never.txt")).toBe(false);
    });

    it("a mkdir that threw is not reported, and neither is a failed rm", async () => {
      fs.mkdirError = new Error("mkdir failed");
      await expect(fs.mkdir("/dir")).rejects.toThrow("mkdir failed");
      expect(fs.mkdirCalls).toHaveLength(0);

      fs.mkdirError = null;
      await expect(fs.rm("/missing.txt")).rejects.toThrow("ENOENT");
      expect(fs.wasDeleted("/missing.txt")).toBe(false);
    });

    it("getFileContent should return string content", async () => {
      await fs.writeFile("/test.txt", "hello");
      expect(fs.getFileContent("/test.txt")).toBe("hello");
      expect(fs.getFileContent("/missing")).toBeUndefined();
    });
  });

  describe("error injection", () => {
    it("should throw mkdirError when set", async () => {
      fs.mkdirError = new Error("mkdir failed");
      await expect(fs.mkdir("/dir")).rejects.toThrow("mkdir failed");
    });

    it("should throw writeFileError when set", async () => {
      fs.writeFileError = new Error("write failed");
      await expect(fs.writeFile("/f.txt", "data")).rejects.toThrow(
        "write failed",
      );
    });

    it("should throw readFileError when set", async () => {
      fs.readFileError = new Error("read failed");
      await expect(fs.readFile("/f.txt")).rejects.toThrow("read failed");
    });
  });

  describe("reset", () => {
    it("should clear all state", async () => {
      await fs.writeFile("/file.txt", "data");
      await fs.mkdir("/dir");
      await fs.readFile("/file.txt");
      await fs.rm("/file.txt");

      fs.reset();

      expect(fs.files.size).toBe(0);
      expect(fs.directories.size).toBe(0);
      expect(fs.mtimes.size).toBe(0);
      expect(fs.writeFileCalls).toHaveLength(0);
      expect(fs.mkdirCalls).toHaveLength(0);
      expect(fs.rmCalls).toHaveLength(0);
      expect(fs.mkdirError).toBeNull();
      expect(fs.writeFileError).toBeNull();
      expect(fs.readFileError).toBeNull();
    });
  });
});
