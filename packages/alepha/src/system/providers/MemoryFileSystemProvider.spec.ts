import { Alepha } from "alepha";
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryFileSystemProvider } from "./MemoryFileSystemProvider.ts";

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

    it("should throw EEXIST for duplicate non-recursive mkdir", async () => {
      await fs.mkdir("/dir");
      await expect(fs.mkdir("/dir")).rejects.toThrow("EEXIST");
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

    it("should throw ENOENT for missing source", async () => {
      await expect(fs.cp("/missing", "/dest")).rejects.toThrow("ENOENT");
    });
  });

  describe("mv", () => {
    it("should move a file", async () => {
      await fs.writeFile("/old.txt", "data");
      await fs.mv("/old.txt", "/new.txt");

      expect(await fs.exists("/old.txt")).toBe(false);
      expect(await fs.readTextFile("/new.txt")).toBe("data");
    });

    it("should move a directory with contents", async () => {
      await fs.mkdir("/old");
      await fs.writeFile("/old/file.txt", "hello");

      await fs.mv("/old", "/new");

      expect(await fs.exists("/old")).toBe(false);
      expect(await fs.exists("/old/file.txt")).toBe(false);
      expect(await fs.exists("/new")).toBe(true);
      expect(await fs.readTextFile("/new/file.txt")).toBe("hello");
    });

    it("should throw ENOENT for missing source", async () => {
      await expect(fs.mv("/missing", "/dest")).rejects.toThrow("ENOENT");
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

    it("should return false for missing paths", async () => {
      expect(await fs.exists("/nope")).toBe(false);
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

    it("wasRead should track reads", async () => {
      await fs.writeFile("/file.txt", "data");
      await fs.readFile("/file.txt");
      expect(fs.wasRead("/file.txt")).toBe(true);
      expect(fs.wasRead("/other.txt")).toBe(false);
    });

    it("wasDeleted should track deletes", async () => {
      await fs.writeFile("/file.txt", "data");
      await fs.rm("/file.txt");
      expect(fs.wasDeleted("/file.txt")).toBe(true);
      expect(fs.wasDeleted("/other.txt")).toBe(false);
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
      expect(fs.writeFileCalls).toHaveLength(0);
      expect(fs.readFileCalls).toHaveLength(0);
      expect(fs.mkdirCalls).toHaveLength(0);
      expect(fs.rmCalls).toHaveLength(0);
      expect(fs.mkdirError).toBeNull();
      expect(fs.writeFileError).toBeNull();
      expect(fs.readFileError).toBeNull();
    });
  });
});
