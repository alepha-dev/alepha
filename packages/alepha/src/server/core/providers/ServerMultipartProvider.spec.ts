import { Alepha, t } from "alepha";
import { $action, AlephaServer, ServerProvider } from "alepha/server";
import { describe, test } from "vitest";
import { multipartOptions } from "./ServerMultipartProvider.ts";

class App {
  upload = $action({
    schema: {
      body: t.object({
        file: t.file(),
      }),
      response: t.text(),
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
          body: t.object({ file: t.file() }),
          response: t.text(),
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
          body: t.object({ file: t.file() }),
          response: t.text(),
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
          body: t.object({ file: t.file() }),
          response: t.text(),
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
          body: t.object({
            name: t.text(),
            description: t.text(),
            file: t.file(),
          }),
          response: t.text(),
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
          body: t.object({ file: t.file() }),
          response: t.text(),
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
          body: t.object({
            file1: t.file(),
            file2: t.file(),
          }),
          response: t.text(),
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

  test("should reject request with too many files", async ({ expect }) => {
    class ManyFilesApp {
      upload = $action({
        schema: {
          body: t.object({
            file1: t.file(),
            file2: t.file(),
            file3: t.file(),
          }),
          response: t.text(),
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
          body: t.object({
            field1: t.text(),
            field2: t.text(),
            field3: t.text(),
            file1: t.file(),
            file2: t.file(),
          }),
          response: t.text(),
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
