import { Readable } from "node:stream";
import { Alepha } from "alepha";
import { beforeEach, describe, expect, it } from "vitest";
import { AlephaSystem } from "../index.ts";
import { NodeFileSystemProvider } from "../providers/NodeFileSystemProvider.ts";

describe("NodeFileSystemProvider hardening", () => {
  const create = () => {
    const alepha = Alepha.create();
    return alepha.inject(NodeFileSystemProvider);
  };

  it("should surface a real mkdir failure instead of swallowing it", async () => {
    // `force !== false` did `.catch(() => {})`, so EACCES / ENOSPC / EROFS all
    // vanished and the failure surfaced far from its cause on a later write.
    // `recursive: true` already makes EEXIST a no-op, so the catch protected
    // nothing.
    const fs = create();

    await expect(
      // A path under a file (not a directory) — ENOTDIR, not EEXIST.
      fs.mkdir(`${import.meta.filename}/nested`),
    ).rejects.toThrow();
  });

  it("should build a file URL that survives a relative path", async () => {
    // `file://${path}` parses the first segment of a relative path as the URL
    // HOST, so the file could never be found.
    const fs = create();

    const file = fs.createFile({ path: "package.json" });

    expect(file.name).toBe("package.json");
    await expect(file.text()).resolves.toContain('"name"');
  });
});

describe("NodeFileSystem", () => {
  let fs: NodeFileSystemProvider;

  beforeEach(() => {
    const alepha = Alepha.create().with(AlephaSystem);
    fs = alepha.inject(NodeFileSystemProvider);
  });

  describe("createFile with object API", () => {
    describe("from text", () => {
      it("should create a file from text content", async ({ expect }) => {
        const file = fs.createFile({
          text: "Hello, world!",
          name: "greeting.txt",
        });

        expect(file.name).toBe("greeting.txt");
        expect(file.type).toBe("text/plain");
        expect(file.size).toBe(13);
        expect(await file.text()).toBe("Hello, world!");
      });

      it("should use default name if not provided", async ({ expect }) => {
        const file = fs.createFile({
          text: "Hello",
        });

        expect(file.name).toBe("file.txt");
        expect(file.type).toBe("text/plain");
      });

      it("should allow custom type", async ({ expect }) => {
        const file = fs.createFile({
          text: '{"key": "value"}',
          name: "data.json",
          type: "application/json",
        });

        expect(file.type).toBe("application/json");
      });
    });

    describe("from buffer", () => {
      it("should create a file from a Buffer", async ({ expect }) => {
        const buffer = Buffer.from("Hello, buffer!");
        const file = fs.createFile({
          buffer,
          name: "test.txt",
        });

        expect(file.name).toBe("test.txt");
        expect(file.type).toBe("text/plain");
        expect(file.size).toBe(14);
        expect(await file.text()).toBe("Hello, buffer!");
      });

      it("should detect content type from filename", async ({ expect }) => {
        const buffer = Buffer.from("PNG data");
        const file = fs.createFile({
          buffer,
          name: "image.png",
        });

        expect(file.type).toBe("image/png");
      });

      it("should allow type override", async ({ expect }) => {
        const buffer = Buffer.from("data");
        const file = fs.createFile({
          buffer,
          name: "file.bin",
          type: "application/custom",
        });

        expect(file.type).toBe("application/custom");
      });
    });

    describe("from arrayBuffer", () => {
      it("should create a file from an ArrayBuffer", async ({ expect }) => {
        const arrayBuffer = new ArrayBuffer(8);
        const view = new Uint8Array(arrayBuffer);
        view[0] = 72; // 'H'
        view[1] = 101; // 'e'
        view[2] = 108; // 'l'
        view[3] = 108; // 'l'
        view[4] = 111; // 'o'

        const file = fs.createFile({
          arrayBuffer,
          name: "test.txt",
        });

        expect(file.name).toBe("test.txt");
        expect(file.type).toBe("text/plain");
        const text = await file.text();
        expect(text.substring(0, 5)).toBe("Hello");
      });
    });

    describe("from stream", () => {
      it("should create a file from a Readable stream", async ({ expect }) => {
        const stream = Readable.from(Buffer.from("Stream data"));
        const file = fs.createFile({
          stream,
          name: "data.txt",
          size: 11,
        });

        expect(file.name).toBe("data.txt");
        expect(file.type).toBe("text/plain");
        expect(file.size).toBe(11);
        expect(await file.text()).toBe("Stream data");
      });

      it("should detect content type from filename", async ({ expect }) => {
        const stream = Readable.from(Buffer.from("{}"));
        const file = fs.createFile({
          stream,
          name: "config.json",
        });

        expect(file.type).toBe("application/json");
      });
    });

    describe("from Web File", () => {
      it("should create a file from a Web File object", async ({ expect }) => {
        // Create a mock Web File
        const webFile = new File(["Hello from File"], "document.txt", {
          type: "text/plain",
        });

        const file = fs.createFile({
          file: webFile,
        });

        expect(file.name).toBe("document.txt");
        expect(file.type).toBe("text/plain");
        expect(await file.text()).toBe("Hello from File");
      });

      it("should allow overriding Web File properties", async ({ expect }) => {
        const webFile = new File(["content"], "old.txt", {
          type: "text/plain",
        });

        const file = fs.createFile({
          file: webFile,
          name: "new.txt",
          type: "text/custom",
        });

        expect(file.name).toBe("new.txt");
        expect(file.type).toBe("text/custom");
      });
    });

    describe("from URL", () => {
      it("should create a file from a file:// URL", async ({ expect }) => {
        // This test would require an actual file, so we just test the structure
        const file = fs.createFile({
          url: "file:///tmp/test.txt",
          name: "test.txt",
        });

        expect(file.name).toBe("test.txt");
        expect(file.type).toBe("text/plain");
      });

      it("should extract filename from URL path", async ({ expect }) => {
        const file = fs.createFile({
          url: "https://example.com/path/to/image.png",
        });

        expect(file.name).toBe("image.png");
        expect(file.type).toBe("image/png");
      });

      it("should allow name override", async ({ expect }) => {
        const file = fs.createFile({
          url: "https://example.com/download",
          name: "custom.pdf",
        });

        expect(file.name).toBe("custom.pdf");
        expect(file.type).toBe("application/pdf");
      });
    });

    describe("error handling", () => {
      it("should throw error for invalid options", ({ expect }) => {
        expect(() => {
          // @ts-expect-error - testing invalid options
          fs.createFile({});
        }).toThrow("Invalid createFile options");
      });
    });
  });

  describe("filesystem operations", () => {
    const tmpDir = "/tmp/alepha-file-test";

    describe("mkdir", () => {
      it("should create a directory", async ({ expect }) => {
        // Ensure tmpDir exists
        await fs.mkdir(tmpDir, { recursive: true });

        const testDir = `${tmpDir}/mkdir-test-${Date.now()}`;

        await fs.mkdir(testDir);

        // Verify directory was created
        const files = await fs.ls(tmpDir);
        expect(files.some((f) => f.includes("mkdir-test"))).toBe(true);

        // Cleanup
        await fs.rm(testDir, { recursive: true, force: true });
      });

      it("should create nested directories with recursive option", async ({
        expect,
      }) => {
        const testDir = `${tmpDir}/nested/path/to/dir-${Date.now()}`;

        await fs.mkdir(testDir, { recursive: true });

        // Verify directory was created
        const files = await fs.ls(`${tmpDir}/nested/path/to`);
        expect(files.some((f) => f.includes("dir-"))).toBe(true);

        // Cleanup
        await fs.rm(`${tmpDir}/nested`, { recursive: true, force: true });
      });
    });

    describe("ls", () => {
      it("should list files in a directory", async ({ expect }) => {
        const testDir = `${tmpDir}/ls-test-${Date.now()}`;
        await fs.mkdir(testDir, { recursive: true });

        // Create test files using Node.js fs
        const { writeFile } = await import("node:fs/promises");
        await writeFile(`${testDir}/file1.txt`, "content1");
        await writeFile(`${testDir}/file2.txt`, "content2");
        await writeFile(`${testDir}/.hidden`, "hidden");

        const files = await fs.ls(testDir);

        expect(files).toContain("file1.txt");
        expect(files).toContain("file2.txt");
        expect(files).not.toContain(".hidden"); // Hidden files excluded by default

        // Cleanup
        await fs.rm(testDir, { recursive: true, force: true });
      });

      it("should list hidden files with hidden option", async ({ expect }) => {
        const testDir = `${tmpDir}/ls-hidden-test-${Date.now()}`;
        await fs.mkdir(testDir, { recursive: true });

        const { writeFile } = await import("node:fs/promises");
        await writeFile(`${testDir}/.hidden`, "hidden");

        const files = await fs.ls(testDir, { hidden: true });

        expect(files).toContain(".hidden");

        // Cleanup
        await fs.rm(testDir, { recursive: true, force: true });
      });

      it("should list files recursively", async ({ expect }) => {
        const testDir = `${tmpDir}/ls-recursive-test-${Date.now()}`;
        await fs.mkdir(`${testDir}/subdir`, { recursive: true });

        const { writeFile } = await import("node:fs/promises");
        await writeFile(`${testDir}/file1.txt`, "content1");
        await writeFile(`${testDir}/subdir/file2.txt`, "content2");

        const files = await fs.ls(testDir, { recursive: true });

        expect(files).toContain("file1.txt");
        expect(files).toContain("subdir");
        expect(files.some((f) => f.includes("subdir/file2.txt"))).toBe(true);

        // Cleanup
        await fs.rm(testDir, { recursive: true, force: true });
      });
    });

    describe("cp", () => {
      it("should copy a file", async ({ expect }) => {
        const testDir = `${tmpDir}/cp-test-${Date.now()}`;
        await fs.mkdir(testDir, { recursive: true });

        const { writeFile } = await import("node:fs/promises");
        await writeFile(`${testDir}/source.txt`, "content");

        await fs.cp(`${testDir}/source.txt`, `${testDir}/dest.txt`);

        const files = await fs.ls(testDir);
        expect(files).toContain("source.txt");
        expect(files).toContain("dest.txt");

        // Cleanup
        await fs.rm(testDir, { recursive: true, force: true });
      });

      it("should copy a directory recursively", async ({ expect }) => {
        const testDir = `${tmpDir}/cp-dir-test-${Date.now()}`;
        await fs.mkdir(`${testDir}/source/subdir`, { recursive: true });

        const { writeFile } = await import("node:fs/promises");
        await writeFile(`${testDir}/source/file.txt`, "content");
        await writeFile(`${testDir}/source/subdir/nested.txt`, "nested");

        await fs.cp(`${testDir}/source`, `${testDir}/dest`);

        const destFiles = await fs.ls(`${testDir}/dest`, { recursive: true });
        expect(destFiles).toContain("file.txt");
        expect(destFiles.some((f) => f.includes("subdir/nested.txt"))).toBe(
          true,
        );

        // Cleanup
        await fs.rm(testDir, { recursive: true, force: true });
      });
    });

    describe("mv", () => {
      it("should move/rename a file", async ({ expect }) => {
        const testDir = `${tmpDir}/mv-test-${Date.now()}`;
        await fs.mkdir(testDir, { recursive: true });

        const { writeFile } = await import("node:fs/promises");
        await writeFile(`${testDir}/old.txt`, "content");

        await fs.mv(`${testDir}/old.txt`, `${testDir}/new.txt`);

        const files = await fs.ls(testDir);
        expect(files).not.toContain("old.txt");
        expect(files).toContain("new.txt");

        // Cleanup
        await fs.rm(testDir, { recursive: true, force: true });
      });

      it("should move a directory", async ({ expect }) => {
        const testDir = `${tmpDir}/mv-dir-test-${Date.now()}`;
        await fs.mkdir(`${testDir}/olddir`, { recursive: true });

        const { writeFile } = await import("node:fs/promises");
        await writeFile(`${testDir}/olddir/file.txt`, "content");

        await fs.mv(`${testDir}/olddir`, `${testDir}/newdir`);

        const files = await fs.ls(testDir);
        expect(files).not.toContain("olddir");
        expect(files).toContain("newdir");

        const newDirFiles = await fs.ls(`${testDir}/newdir`);
        expect(newDirFiles).toContain("file.txt");

        // Cleanup
        await fs.rm(testDir, { recursive: true, force: true });
      });
    });

    describe("rm", () => {
      it("should remove a file", async ({ expect }) => {
        const testDir = `${tmpDir}/rm-test-${Date.now()}`;
        await fs.mkdir(testDir, { recursive: true });

        const { writeFile } = await import("node:fs/promises");
        await writeFile(`${testDir}/file.txt`, "content");

        await fs.rm(`${testDir}/file.txt`);

        const files = await fs.ls(testDir);
        expect(files).not.toContain("file.txt");

        // Cleanup
        await fs.rm(testDir, { recursive: true, force: true });
      });

      it("should remove a directory recursively", async ({ expect }) => {
        const testDir = `${tmpDir}/rm-dir-test-${Date.now()}`;
        await fs.mkdir(`${testDir}/dir/subdir`, { recursive: true });

        const { writeFile } = await import("node:fs/promises");
        await writeFile(`${testDir}/dir/file.txt`, "content");

        await fs.rm(`${testDir}/dir`, { recursive: true });

        const files = await fs.ls(testDir);
        expect(files).not.toContain("dir");

        // Cleanup
        await fs.rm(testDir, { recursive: true, force: true });
      });

      it("should not throw error with force option", async ({ expect }) => {
        await expect(
          fs.rm(`${tmpDir}/non-existent-${Date.now()}.txt`, { force: true }),
        ).resolves.not.toThrow();
      });
    });
  });
});
