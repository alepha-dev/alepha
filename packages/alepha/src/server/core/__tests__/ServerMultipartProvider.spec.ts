import { Alepha, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $action, AlephaServer, ServerProvider } from "alepha/server";
import { describe, test } from "vitest";

import {
  multipartOptions,
  ServerMultipartProvider,
} from "../providers/ServerMultipartProvider.ts";

class App {
  upload = $action({
    schema: {
      body: z.object({
        file: z.file(),
      }),
      response: z.text(),
    },
    handler: ({ body }) => {
      return `${body.file.name} (${body.file.size}b, ${body.file.type})`;
    },
  });
}

describe("ServerMultipartProvider", () => {
  test("should upload file via HTTP", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaServer).with(App);
    await alepha.start();

    const file = new File(["test content"], "test.txt", { type: "text/plain" });
    const body = new FormData();
    body.append("file", file);

    const resp = await fetch(
      `${alepha.inject(ServerProvider).hostname}/api/upload`,
      { method: "POST", body },
    );

    expect(resp.status).toBe(200);
    expect(await resp.text()).toBe("test.txt (12b, text/plain)");
  });

  test("should upload file locally via run()", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaServer).with(App);
    await alepha.start();

    const file = new File(["test content"], "test.txt", { type: "text/plain" });

    const result = await alepha.inject(App).upload.run({
      body: { file },
    });

    expect(result).toBe("test.txt (12b, text/plain)");
  });

  test("should read file content via text()", async ({ expect }) => {
    class TextApp {
      upload = $action({
        schema: {
          body: z.object({ file: z.file() }),
          response: z.text(),
        },
        handler: async ({ body }) => body.file.text(),
      });
    }

    const alepha = Alepha.create().with(AlephaServer).with(TextApp);
    await alepha.start();

    const file = new File(["hello world"], "hi.txt", { type: "text/plain" });
    const formData = new FormData();
    formData.append("file", file);

    const resp = await fetch(
      `${alepha.inject(ServerProvider).hostname}/api/upload`,
      { method: "POST", body: formData },
    );

    expect(await resp.text()).toBe("hello world");
  });

  test("should read file content via arrayBuffer()", async ({ expect }) => {
    class BufferApp {
      upload = $action({
        schema: {
          body: z.object({ file: z.file() }),
          response: z.text(),
        },
        handler: async ({ body }) => {
          const ab = await body.file.arrayBuffer();
          return new TextDecoder().decode(ab);
        },
      });
    }

    const alepha = Alepha.create().with(AlephaServer).with(BufferApp);
    await alepha.start();

    const file = new File(["buffer test"], "buf.txt", { type: "text/plain" });

    const result = await alepha.inject(BufferApp).upload.run({
      body: { file },
    });

    expect(result).toBe("buffer test");
  });

  test("should handle binary file uploads", async ({ expect }) => {
    class BinaryApp {
      upload = $action({
        schema: {
          body: z.object({ file: z.file() }),
          response: z.text(),
        },
        handler: async ({ body }) => {
          const ab = await body.file.arrayBuffer();
          const bytes = new Uint8Array(ab);
          return `${body.file.name}: ${bytes.length}b, ${body.file.type}`;
        },
      });
    }

    const alepha = Alepha.create().with(AlephaServer).with(BinaryApp);
    await alepha.start();

    const binary = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const file = new File([binary], "image.png", { type: "image/png" });

    const result = await alepha.inject(BinaryApp).upload.run({
      body: { file },
    });

    expect(result).toBe("image.png: 6b, image/png");
  });

  test("should handle empty file", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaServer).with(App);
    await alepha.start();

    const file = new File([], "empty.txt", { type: "text/plain" });

    const result = await alepha.inject(App).upload.run({
      body: { file },
    });

    expect(result).toBe("empty.txt (0b, text/plain)");
  });

  test("should handle mixed file and text fields", async ({ expect }) => {
    class MixedApp {
      upload = $action({
        schema: {
          body: z.object({
            name: z.text(),
            description: z.text(),
            file: z.file(),
          }),
          response: z.text(),
        },
        handler: ({ body }) =>
          `${body.name}: ${body.description} (${body.file.size}b)`,
      });
    }

    const alepha = Alepha.create().with(AlephaServer).with(MixedApp);
    await alepha.start();

    const file = new File(["content"], "doc.txt", { type: "text/plain" });

    const result = await alepha.inject(MixedApp).upload.run({
      body: {
        name: "Test Document",
        description: "A test file upload",
        file,
      },
    });

    expect(result).toBe("Test Document: A test file upload (7b)");
  });

  test("should not have filepath (no filesystem)", async ({ expect }) => {
    class PathApp {
      upload = $action({
        schema: {
          body: z.object({ file: z.file() }),
          response: z.text(),
        },
        handler: ({ body }) => String(body.file.filepath ?? "none"),
      });
    }

    const alepha = Alepha.create().with(AlephaServer).with(PathApp);
    await alepha.start();

    const file = new File(["data"], "f.txt", { type: "text/plain" });

    const result = await alepha.inject(PathApp).upload.run({
      body: { file },
    });

    expect(result).toBe("none");
  });
});

describe("ServerMultipartProvider - Size Limits", () => {
  test("should reject file exceeding individual file size limit", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaServer).with(App);
    alepha.store.mut(multipartOptions, () => ({
      limit: 10_000_000,
      fileLimit: 100,
      fileCount: 10,
    }));
    await alepha.start();

    const file = new File(["x".repeat(200)], "large.txt", {
      type: "text/plain",
    });
    const formData = new FormData();
    formData.append("file", file);

    const resp = await fetch(
      `${alepha.inject(ServerProvider).hostname}/api/upload`,
      { method: "POST", body: formData },
    );

    expect(resp.status).toBe(413);
    const body = await resp.json();
    expect(body.message).toMatch(/exceeds size limit/i);
  });

  test("should reject request exceeding total size limit", async ({
    expect,
  }) => {
    class MultiFileApp {
      upload = $action({
        schema: {
          body: z.object({
            file1: z.file(),
            file2: z.file(),
          }),
          response: z.text(),
        },
        handler: () => "ok",
      });
    }

    const alepha = Alepha.create().with(AlephaServer).with(MultiFileApp);
    alepha.store.mut(multipartOptions, () => ({
      limit: 150,
      fileLimit: 100,
      fileCount: 10,
    }));
    await alepha.start();

    const file1 = new File(["x".repeat(80)], "f1.txt", {
      type: "text/plain",
    });
    const file2 = new File(["y".repeat(80)], "f2.txt", {
      type: "text/plain",
    });
    const formData = new FormData();
    formData.append("file1", file1);
    formData.append("file2", file2);

    const resp = await fetch(
      `${alepha.inject(ServerProvider).hostname}/api/upload`,
      { method: "POST", body: formData },
    );

    expect(resp.status).toBe(413);
    const body = await resp.json();
    expect(body.message).toMatch(/size limit exceeded/i);
  });

  test("should abort oversized streamed upload without buffering it", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaServer).with(App);
    alepha.store.mut(multipartOptions, () => ({
      limit: 1_000,
      fileLimit: 100_000_000,
      fileCount: 10,
    }));
    await alepha.start();

    // Chunked transfer-encoding: no content-length header, so the fail-fast
    // header check can't fire. The stream itself must be cut at `limit` —
    // otherwise formData() buffers the entire body into RAM (DoS).
    const boundary = "----alepha-test-boundary";
    const encoder = new TextEncoder();
    const head = encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="big.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    );
    const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
    const chunk = new Uint8Array(1024).fill(120);
    const totalChunks = 200; // ~200 KB against a 1 KB limit

    let pulled = 0;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(head);
      },
      pull(controller) {
        if (pulled < totalChunks) {
          pulled++;
          controller.enqueue(chunk);
        } else {
          controller.enqueue(tail);
          controller.close();
        }
      },
    });

    const request = new Request("http://localhost/api/upload", {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body,
      duplex: "half",
    } as RequestInit);

    const provider = alepha.inject(ServerMultipartProvider);
    const route = {
      schema: { body: z.object({ file: z.file() }) },
    } as never;

    await expect(provider.parseMultipart(route, request)).rejects.toThrow(
      /size limit/i,
    );

    // The parser must stop reading at the limit, not consume the stream.
    expect(pulled).toBeLessThan(totalChunks);
  });

  test("should reject request with too many files", async ({ expect }) => {
    class ManyFilesApp {
      upload = $action({
        schema: {
          body: z.object({
            file1: z.file(),
            file2: z.file(),
            file3: z.file(),
          }),
          response: z.text(),
        },
        handler: () => "ok",
      });
    }

    const alepha = Alepha.create().with(AlephaServer).with(ManyFilesApp);
    alepha.store.mut(multipartOptions, () => ({
      limit: 10_000_000,
      fileLimit: 5_000_000,
      fileCount: 2,
    }));
    await alepha.start();

    const formData = new FormData();
    formData.append("file1", new File(["a"], "f1.txt", { type: "text/plain" }));
    formData.append("file2", new File(["b"], "f2.txt", { type: "text/plain" }));
    formData.append("file3", new File(["c"], "f3.txt", { type: "text/plain" }));

    const resp = await fetch(
      `${alepha.inject(ServerProvider).hostname}/api/upload`,
      { method: "POST", body: formData },
    );

    expect(resp.status).toBe(413);
    const body = await resp.json();
    expect(body.message).toMatch(/Too many files/i);
  });

  test("should accept file exactly at the size limit", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaServer).with(App);
    alepha.store.mut(multipartOptions, () => ({
      limit: 10_000_000,
      fileLimit: 100,
      fileCount: 10,
    }));
    await alepha.start();

    const file = new File(["x".repeat(100)], "exact.txt", {
      type: "text/plain",
    });

    const result = await alepha.inject(App).upload.run({
      body: { file },
    });

    expect(result).toBe("exact.txt (100b, text/plain)");
  });

  test("should reject file just over the size limit", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaServer).with(App);
    alepha.store.mut(multipartOptions, () => ({
      limit: 10_000_000,
      fileLimit: 100,
      fileCount: 10,
    }));
    await alepha.start();

    const file = new File(["x".repeat(101)], "over.txt", {
      type: "text/plain",
    });
    const formData = new FormData();
    formData.append("file", file);

    const resp = await fetch(
      `${alepha.inject(ServerProvider).hostname}/api/upload`,
      { method: "POST", body: formData },
    );

    expect(resp.status).toBe(413);
    const body = await resp.json();
    expect(body.message).toMatch(/exceeds size limit/i);
  });

  test("should reject via content-length pre-check", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaServer).with(App);
    alepha.store.mut(multipartOptions, () => ({
      limit: 50,
      fileLimit: 5_000_000,
      fileCount: 10,
    }));
    await alepha.start();

    const file = new File(["x".repeat(1000)], "big.txt", {
      type: "text/plain",
    });
    const formData = new FormData();
    formData.append("file", file);

    const resp = await fetch(
      `${alepha.inject(ServerProvider).hostname}/api/upload`,
      { method: "POST", body: formData },
    );

    expect(resp.status).toBe(413);
    const body = await resp.json();
    expect(body.message).toMatch(/size limit exceeded/i);
  });

  test("should count only file fields toward file count limit", async ({
    expect,
  }) => {
    class TextAndFilesApp {
      upload = $action({
        schema: {
          body: z.object({
            field1: z.text(),
            field2: z.text(),
            field3: z.text(),
            file1: z.file(),
            file2: z.file(),
          }),
          response: z.text(),
        },
        handler: () => "success",
      });
    }

    const alepha = Alepha.create().with(AlephaServer).with(TextAndFilesApp);
    alepha.store.mut(multipartOptions, () => ({
      limit: 10_000_000,
      fileLimit: 5_000_000,
      fileCount: 2,
    }));
    await alepha.start();

    const result = await alepha.inject(TextAndFilesApp).upload.run({
      body: {
        field1: "a",
        field2: "b",
        field3: "c",
        file1: new File(["x"], "f1.txt", { type: "text/plain" }),
        file2: new File(["y"], "f2.txt", { type: "text/plain" }),
      },
    });

    expect(result).toBe("success");
  });

  test("should use default limits", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaServer).with(App);
    await alepha.start();

    const file = new File(["x".repeat(1000)], "normal.txt", {
      type: "text/plain",
    });

    const result = await alepha.inject(App).upload.run({
      body: { file },
    });

    expect(result).toBe("normal.txt (1000b, text/plain)");
  });
});

/**
 * The parser's own `finally` cancels the source — but only if its generator is
 * driven to completion or explicitly returned, and the two paths that matter
 * do neither: a streamed field leaves the iterator suspended on purpose, and a
 * blown limit throws from the part's own iterator, not from `parse`.
 */
describe("ServerMultipartProvider - source cleanup", () => {
  const BOUNDARY = "----AlephaCleanup";

  /**
   * A multipart request whose body reports whether it was cancelled.
   *
   * Delivered in small chunks and followed by an epilogue nobody reads, so the
   * source is still open at the moment cleanup should happen. A stream that has
   * already closed itself cannot report a cancellation — `cancel()` is not
   * called on a source that is done — which makes an exhausted body useless as
   * evidence either way.
   */
  const trackedRequest = (raw: string) => {
    const state = { cancelled: false };
    const bytes = new TextEncoder().encode(`${raw}${"e".repeat(4096)}`);
    let at = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (at >= bytes.length) {
          controller.close();
          return;
        }
        controller.enqueue(bytes.subarray(at, at + 64));
        at += 64;
      },
      cancel() {
        state.cancelled = true;
      },
    });
    const request = new Request("http://localhost/api/upload", {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    return { request, state };
  };

  const bodyOf = (content: string) =>
    `--${BOUNDARY}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="a.bin"\r\n` +
    `Content-Type: application/octet-stream\r\n\r\n` +
    `${content}\r\n` +
    `--${BOUNDARY}--\r\n`;

  const caps = (maxFileBytes: number) => ({
    maxFileBytes,
    maxTotalBytes: 10_000_000,
    maxParts: 10,
    maxHeaderBytes: 16 * 1024,
  });

  test("cancels the body when a limit refuses a buffered field", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaServer);
    await alepha.start();
    const provider = alepha.inject(ServerMultipartProvider);
    const route = { schema: { body: z.object({ file: z.file() }) } } as never;

    const { request, state } = trackedRequest(bodyOf("x".repeat(5000)));

    await expect(
      provider.parseMultipart(route, request, caps(100)),
    ).rejects.toThrow();

    expect(state.cancelled).toBe(true);
  });

  test("cancels the body once a streamed field has been drained", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaServer);
    await alepha.start();
    const provider = alepha.inject(ServerMultipartProvider);
    const route = { schema: { body: z.object({ file: z.stream() }) } } as never;

    const { request, state } = trackedRequest(bodyOf("hello"));

    const body = await provider.parseMultipart(route, request, caps(1_000_000));
    const part = body.file as { data: AsyncIterable<Uint8Array> };

    // Still open while the handler owns the bytes — cancelling here is exactly
    // the bug the hand-driven iterator exists to avoid.
    expect(state.cancelled).toBe(false);

    for await (const _ of part.data) {
      // drain
    }

    expect(state.cancelled).toBe(true);
  });
});

describe("ServerMultipartProvider - the clock", () => {
  test("names an unnamed part from the injected clock", async ({ expect }) => {
    // `materialise` falls back to `${field}_${now}` when a part carries no
    // filename. Reading the wall clock directly there made that name — and the
    // `lastModified` beside it — untestable, and `DateTimeProvider` exists
    // precisely so time is a dependency like any other.
    const alepha = Alepha.create().with(AlephaServer);
    await alepha.start();

    const clock = alepha.inject(DateTimeProvider);
    clock.pause();
    // Away from wall time, or the assertion passes on a wall clock too and
    // proves nothing — a paused clock still reads "now" on the millisecond it
    // was paused.
    await clock.travel(365, "days");
    const now = clock.nowMillis();

    const provider = alepha.inject(ServerMultipartProvider);
    const boundary = "----AlephaClock";
    const raw =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"\r\n` +
      `Content-Type: text/plain\r\n\r\n` +
      `hi\r\n` +
      `--${boundary}--\r\n`;

    const request = new Request("http://localhost/api/upload", {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body: raw,
    });

    const body = await provider.parseMultipart(
      { schema: { body: z.object({ file: z.file() }) } } as never,
      request,
    );

    const file = body.file as { name: string; lastModified: number };
    expect(file.name).toBe(`file_${now}`);
    expect(file.lastModified).toBe(now);
  });
});
