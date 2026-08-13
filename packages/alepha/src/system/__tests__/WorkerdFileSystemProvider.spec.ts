import { Alepha } from "alepha";
import { beforeEach, describe, expect, it } from "vitest";
import { WorkerdFileSystemProvider } from "../providers/WorkerdFileSystemProvider.ts";

/**
 * Reads a web ReadableStream fully as a string.
 */
const readStream = async (stream: ReadableStream): Promise<string> => {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
};

describe("WorkerdFileSystemProvider", () => {
  let fs: WorkerdFileSystemProvider;

  beforeEach(() => {
    fs = Alepha.create().inject(WorkerdFileSystemProvider);
  });

  describe("join", () => {
    it("joins and normalizes segments", () => {
      expect(fs.join("a", "b", "c")).toBe("a/b/c");
      expect(fs.join("a/", "/b")).toBe("a/b");
      expect(fs.join("a", "./b")).toBe("a/b");
      expect(fs.join("a", "b", "..", "c")).toBe("a/c");
      expect(fs.join(".")).toBe(".");
    });
  });

  describe("createFile from text", () => {
    it("builds a FileLike with web streams", async () => {
      const file = fs.createFile({ text: "hello", name: "greeting.txt" });

      expect(file.name).toBe("greeting.txt");
      expect(file.type).toBe("text/plain");
      expect(file.size).toBe(5);
      expect(await file.text()).toBe("hello");
      expect(await readStream(file.stream() as ReadableStream)).toBe("hello");
      // A fresh stream per call.
      expect(await readStream(file.stream() as ReadableStream)).toBe("hello");
    });
  });

  describe("createFile from buffer / arrayBuffer", () => {
    it("accepts a node Buffer", async () => {
      const file = fs.createFile({
        buffer: Buffer.from("buffered"),
        name: "b.bin",
      });
      expect(await file.text()).toBe("buffered");
      expect(file.size).toBe(8);
    });

    it("accepts an ArrayBuffer", async () => {
      const file = fs.createFile({
        arrayBuffer: new TextEncoder().encode("raw").buffer as ArrayBuffer,
        name: "r.bin",
      });
      expect(await file.text()).toBe("raw");
    });
  });

  describe("createFile from response", () => {
    const makeResponse = (headers: Record<string, string> = {}) =>
      new Response("payload", { headers });

    it("reads name, type and size from headers", async () => {
      const file = fs.createFile({
        response: makeResponse({
          "content-type": "text/plain",
          "content-length": "7",
          "content-disposition": 'attachment; filename="report.txt"',
        }),
      });

      expect(file.name).toBe("report.txt");
      expect(file.type).toBe("text/plain");
      expect(file.size).toBe(7);
      expect(await file.text()).toBe("payload");
    });

    it("decodes an RFC 5987 filename*", async () => {
      const file = fs.createFile({
        response: makeResponse({
          "content-disposition":
            "attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf",
        }),
      });
      expect(file.name).toBe("résumé.pdf");
    });

    it("supports text() after arrayBuffer() — the body is memoised", async () => {
      // A Response body reads once; without memoisation the second accessor
      // threw "Body already read".
      const file = fs.createFile({ response: makeResponse() });

      const ab = await file.arrayBuffer();
      expect(new TextDecoder().decode(ab)).toBe("payload");
      expect(await file.text()).toBe("payload");
      expect(await file.text()).toBe("payload");
      // Once buffered, stream() serves from the copy too.
      expect(await readStream(file.stream() as ReadableStream)).toBe("payload");
    });

    it("ignores an unparseable content-length", () => {
      const file = fs.createFile({
        response: makeResponse({ "content-length": "banana" }),
      });
      expect(file.size).toBe(0);
    });

    it("throws when the response has no body", () => {
      expect(() => fs.createFile({ response: new Response(null) })).toThrow(
        "Response has no body stream",
      );
    });
  });

  describe("createFile from stream", () => {
    it("memoises the source and serves repeat reads", async () => {
      const file = fs.createFile({
        stream: new Blob(["streamed"]).stream(),
        name: "s.txt",
        size: 8,
      });

      expect(await file.text()).toBe("streamed");
      // The one-shot source is drained — these come from the buffer.
      expect(await file.text()).toBe("streamed");
      expect(await readStream(file.stream() as ReadableStream)).toBe(
        "streamed",
      );
    });
  });

  describe("unsupported operations", () => {
    it("rejects the path source", () => {
      expect(() => fs.createFile({ path: "/tmp/x" })).toThrow(
        /not supported in edge runtimes/,
      );
    });

    it("throws a clear error for every filesystem operation", async () => {
      await expect(fs.rm("/x")).rejects.toThrow(/edge runtimes/);
      await expect(fs.cp("/x", "/y")).rejects.toThrow(/edge runtimes/);
      await expect(fs.mkdir("/x")).rejects.toThrow(/edge runtimes/);
      await expect(fs.ls("/x")).rejects.toThrow(/edge runtimes/);
      await expect(fs.exists("/x")).rejects.toThrow(/edge runtimes/);
      await expect(fs.stat("/x")).rejects.toThrow(/edge runtimes/);
      await expect(fs.readFile("/x")).rejects.toThrow(/edge runtimes/);
      await expect(fs.readFileStream("/x")).rejects.toThrow(/edge runtimes/);
      await expect(fs.readTextFile("/x")).rejects.toThrow(/edge runtimes/);
      await expect(fs.readJsonFile("/x")).rejects.toThrow(/edge runtimes/);
      await expect(fs.writeFile("/x", "y")).rejects.toThrow(/edge runtimes/);
      await expect(fs.writeJsonFile("/x", {})).rejects.toThrow(/edge runtimes/);
    });
  });
});
