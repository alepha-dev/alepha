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
      // A path under a file (not a directory): ENOTDIR, not EEXIST.
      fs.mkdir(`${import.meta.filename}/nested`),
    ).rejects.toThrow();
  });

  it("should resolve a relative path against the working directory", async () => {
    // The old `file://${path}` construction parsed the first segment of a
    // relative path as the URL HOST, so the file could never be found.
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
        const stream = Readable.toWeb(
          Readable.from(Buffer.from("Stream data")),
        ) as unknown as ReadableStream<Uint8Array>;
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
        const stream = Readable.toWeb(
          Readable.from(Buffer.from("{}")),
        ) as unknown as ReadableStream<Uint8Array>;
        const file = fs.createFile({
          stream,
          name: "config.json",
        });

        expect(file.type).toBe("application/json");
      });
    });

    describe("from response", () => {
      it("should read name, type and size from headers", async ({ expect }) => {
        const file = fs.createFile({
          response: new Response("payload", {
            headers: {
              "content-type": "text/plain",
              "content-length": "7",
              "content-disposition": 'attachment; filename="report.txt"',
            },
          }),
        });

        expect(file.name).toBe("report.txt");
        expect(file.type).toBe("text/plain");
        expect(file.size).toBe(7);
        expect(await file.text()).toBe("payload");
        // Memoised: the one-shot body serves repeat reads.
        expect(await file.text()).toBe("payload");
      });

      it("should decode an RFC 5987 filename*", async ({ expect }) => {
        const file = fs.createFile({
          response: new Response("x", {
            headers: {
              "content-disposition":
                "attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf",
            },
          }),
        });
        expect(file.name).toBe("résumé.pdf");
      });

      it("should ignore an unparseable content-length", ({ expect }) => {
        const file = fs.createFile({
          response: new Response("x", {
            headers: { "content-length": "banana" },
          }),
        });
        expect(file.size).toBe(0);
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
});
