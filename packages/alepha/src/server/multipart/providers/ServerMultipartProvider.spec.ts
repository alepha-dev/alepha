import { Alepha, t } from "alepha";
import { $action, ServerProvider } from "alepha/server";
import { describe, expect, test } from "vitest";
import { AlephaServerMultipart } from "../index.ts";

class App {
  upload = $action({
    schema: {
      body: t.object({
        file: t.file(),
      }),
      response: t.text(),
    },
    handler: ({ body }) => {
      expect(body.file).toBeDefined();
      expect(body.file.name).toBe("test.txt");
      expect(body.file.size).toBe(12);
      expect(body.file.type).toBe("text/plain");
      expect(body.file.lastModified).toBeGreaterThan(0);
      return `File ${body.file.name} uploaded successfully.`;
    },
  });
}

describe("ServerMultipartProvider", () => {
  test("ServerMultipartProvider - hello", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaServerMultipart).with(App);
    await alepha.start();

    const file = new File(["test content"], "test.txt", { type: "text/plain" });
    const body = new FormData();
    body.append("file", file);

    const resp = await fetch(
      `${alepha.inject(ServerProvider).hostname}/api/upload`,
      {
        method: "POST",
        body,
      },
    );

    const text = await resp.text();
    expect(resp.status).toBe(200);
    expect(text).toBe(`File test.txt uploaded successfully.`);
  });

  test("ServerMultipartProvider - local", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaServerMultipart).with(App);
    await alepha.start();

    const file = new File(["test content"], "test.txt", { type: "text/plain" });

    const resp = await alepha.inject(App).upload.run({
      body: {
        file,
      },
    });

    expect(resp).toBe(`File test.txt uploaded successfully.`);
  });
});

describe("ServerMultipartProvider - Size Limits", () => {
  test("should reject file exceeding individual file size limit", async ({
    expect,
  }) => {
    class LargeFileApp {
      upload = $action({
        schema: {
          body: t.object({
            file: t.file(),
          }),
          response: t.text(),
        },
        handler: ({ body }) => `File ${body.file.name} uploaded.`,
      });
    }

    // Set a very small file limit (100 bytes) via env config
    const alepha = Alepha.create({
      env: { SERVER_MULTIPART_FILE_LIMIT: "100" },
    })
      .with(AlephaServerMultipart)
      .with(LargeFileApp);
    await alepha.start();

    // Create a file larger than the limit
    const largeContent = "x".repeat(200);
    const file = new File([largeContent], "large.txt", { type: "text/plain" });
    const formData = new FormData();
    formData.append("file", file);

    // Use HTTP request - validation happens at HTTP layer
    const resp = await fetch(
      `${alepha.inject(ServerProvider).hostname}/api/upload`,
      {
        method: "POST",
        body: formData,
      },
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
        handler: ({ body }) =>
          `Files ${body.file1.name} and ${body.file2.name} uploaded.`,
      });
    }

    // Set total limit to 150 bytes, individual file limit to 100 bytes
    const alepha = Alepha.create({
      env: {
        SERVER_MULTIPART_LIMIT: "150",
        SERVER_MULTIPART_FILE_LIMIT: "100",
      },
    })
      .with(AlephaServerMultipart)
      .with(MultiFileApp);
    await alepha.start();

    // Create two files that individually fit but together exceed the limit
    const file1 = new File(["x".repeat(80)], "file1.txt", {
      type: "text/plain",
    });
    const file2 = new File(["y".repeat(80)], "file2.txt", {
      type: "text/plain",
    });
    const formData = new FormData();
    formData.append("file1", file1);
    formData.append("file2", file2);

    // Use HTTP request - validation happens at HTTP layer
    const resp = await fetch(
      `${alepha.inject(ServerProvider).hostname}/api/upload`,
      {
        method: "POST",
        body: formData,
      },
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
        handler: () => "uploaded",
      });
    }

    // Set file count limit to 2
    const alepha = Alepha.create({
      env: { SERVER_MULTIPART_FILE_COUNT: "2" },
    })
      .with(AlephaServerMultipart)
      .with(ManyFilesApp);
    await alepha.start();

    const file1 = new File(["content1"], "file1.txt", { type: "text/plain" });
    const file2 = new File(["content2"], "file2.txt", { type: "text/plain" });
    const file3 = new File(["content3"], "file3.txt", { type: "text/plain" });
    const formData = new FormData();
    formData.append("file1", file1);
    formData.append("file2", file2);
    formData.append("file3", file3);

    // Use HTTP request - validation happens at HTTP layer
    const resp = await fetch(
      `${alepha.inject(ServerProvider).hostname}/api/upload`,
      {
        method: "POST",
        body: formData,
      },
    );

    expect(resp.status).toBe(413);
    const body = await resp.json();
    expect(body.message).toMatch(/Too many files/i);
  });

  test("should accept file exactly at the size limit", async ({ expect }) => {
    class ExactLimitApp {
      upload = $action({
        schema: {
          body: t.object({
            file: t.file(),
          }),
          response: t.text(),
        },
        handler: ({ body }) => `File size: ${body.file.size}`,
      });
    }

    // Set file limit to exactly 100 bytes
    const alepha = Alepha.create({
      env: { SERVER_MULTIPART_FILE_LIMIT: "100" },
    })
      .with(AlephaServerMultipart)
      .with(ExactLimitApp);
    await alepha.start();

    // Create a file exactly at the limit
    const content = "x".repeat(100);
    const file = new File([content], "exact.txt", { type: "text/plain" });

    const result = await alepha.inject(ExactLimitApp).upload.run({
      body: { file },
    });

    expect(result).toBe("File size: 100");
  });

  test("should accept file just under the size limit", async ({ expect }) => {
    class UnderLimitApp {
      upload = $action({
        schema: {
          body: t.object({
            file: t.file(),
          }),
          response: t.text(),
        },
        handler: ({ body }) => `File size: ${body.file.size}`,
      });
    }

    // Set file limit to 100 bytes
    const alepha = Alepha.create({
      env: { SERVER_MULTIPART_FILE_LIMIT: "100" },
    })
      .with(AlephaServerMultipart)
      .with(UnderLimitApp);
    await alepha.start();

    // Create a file just under the limit
    const content = "x".repeat(99);
    const file = new File([content], "under.txt", { type: "text/plain" });

    const result = await alepha.inject(UnderLimitApp).upload.run({
      body: { file },
    });

    expect(result).toBe("File size: 99");
  });

  test("should reject file just over the size limit", async ({ expect }) => {
    class OverLimitApp {
      upload = $action({
        schema: {
          body: t.object({
            file: t.file(),
          }),
          response: t.text(),
        },
        handler: ({ body }) => `File size: ${body.file.size}`,
      });
    }

    // Set file limit to 100 bytes
    const alepha = Alepha.create({
      env: { SERVER_MULTIPART_FILE_LIMIT: "100" },
    })
      .with(AlephaServerMultipart)
      .with(OverLimitApp);
    await alepha.start();

    // Create a file just over the limit
    const content = "x".repeat(101);
    const file = new File([content], "over.txt", { type: "text/plain" });
    const formData = new FormData();
    formData.append("file", file);

    // Use HTTP request - validation happens at HTTP layer
    const resp = await fetch(
      `${alepha.inject(ServerProvider).hostname}/api/upload`,
      {
        method: "POST",
        body: formData,
      },
    );

    expect(resp.status).toBe(413);
    const body = await resp.json();
    expect(body.message).toMatch(/exceeds size limit/i);
  });

  test("should handle empty file upload", async ({ expect }) => {
    class EmptyFileApp {
      upload = $action({
        schema: {
          body: t.object({
            file: t.file(),
          }),
          response: t.text(),
        },
        handler: ({ body }) => `File size: ${body.file.size}`,
      });
    }

    const alepha = Alepha.create()
      .with(AlephaServerMultipart)
      .with(EmptyFileApp);
    await alepha.start();

    // Create an empty file
    const file = new File([], "empty.txt", { type: "text/plain" });

    const result = await alepha.inject(EmptyFileApp).upload.run({
      body: { file },
    });

    expect(result).toBe("File size: 0");

    await alepha.stop();
  });

  test("should reject via HTTP when content-length exceeds limit", async ({
    expect,
  }) => {
    class ContentLengthApp {
      upload = $action({
        schema: {
          body: t.object({
            file: t.file(),
          }),
          response: t.text(),
        },
        handler: ({ body }) => `uploaded`,
      });
    }

    // Set a very small total limit
    const alepha = Alepha.create({
      env: { SERVER_MULTIPART_LIMIT: "50" },
    })
      .with(AlephaServerMultipart)
      .with(ContentLengthApp);
    await alepha.start();

    const largeContent = "x".repeat(1000);
    const file = new File([largeContent], "large.txt", { type: "text/plain" });
    const formData = new FormData();
    formData.append("file", file);

    const resp = await fetch(
      `${alepha.inject(ServerProvider).hostname}/api/upload`,
      {
        method: "POST",
        body: formData,
      },
    );

    expect(resp.status).toBe(413);
    const body = await resp.json();
    expect(body.message).toMatch(/size limit exceeded/i);
  });

  test("should use default limits when env vars not set", async ({
    expect,
  }) => {
    class DefaultLimitsApp {
      upload = $action({
        schema: {
          body: t.object({
            file: t.file(),
          }),
          response: t.text(),
        },
        handler: ({ body }) => `File size: ${body.file.size}`,
      });
    }

    // Create with no env config to use defaults
    const alepha = Alepha.create()
      .with(AlephaServerMultipart)
      .with(DefaultLimitsApp);
    await alepha.start();

    // Create a reasonable file (should work with default 5MB limit)
    const content = "x".repeat(1000);
    const file = new File([content], "normal.txt", { type: "text/plain" });

    const result = await alepha.inject(DefaultLimitsApp).upload.run({
      body: { file },
    });

    expect(result).toBe("File size: 1000");
  });

  test("should handle mixed file and text fields with size limits", async ({
    expect,
  }) => {
    class MixedFieldsApp {
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
          `${body.name}: ${body.description} (${body.file.size} bytes)`,
      });
    }

    const alepha = Alepha.create({
      env: { SERVER_MULTIPART_FILE_LIMIT: "1000" },
    })
      .with(AlephaServerMultipart)
      .with(MixedFieldsApp);
    await alepha.start();

    const file = new File(["content"], "doc.txt", { type: "text/plain" });

    const result = await alepha.inject(MixedFieldsApp).upload.run({
      body: {
        name: "Test Document",
        description: "A test file upload",
        file,
      },
    });

    expect(result).toBe("Test Document: A test file upload (7 bytes)");
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

    // Set file count limit to 2 - should only count file fields, not text
    const alepha = Alepha.create({
      env: { SERVER_MULTIPART_FILE_COUNT: "2" },
    })
      .with(AlephaServerMultipart)
      .with(TextAndFilesApp);
    await alepha.start();

    const file1 = new File(["content1"], "file1.txt", { type: "text/plain" });
    const file2 = new File(["content2"], "file2.txt", { type: "text/plain" });

    // Should succeed - only 2 files even though 5 total fields
    const result = await alepha.inject(TextAndFilesApp).upload.run({
      body: {
        field1: "text1",
        field2: "text2",
        field3: "text3",
        file1,
        file2,
      },
    });

    expect(result).toBe("success");
  });

  test("should handle binary file uploads with size limits", async ({
    expect,
  }) => {
    class BinaryFileApp {
      upload = $action({
        schema: {
          body: t.object({
            file: t.file(),
          }),
          response: t.text(),
        },
        handler: ({ body }) =>
          `Binary file: ${body.file.name}, ${body.file.size} bytes, ${body.file.type}`,
      });
    }

    const alepha = Alepha.create({
      env: { SERVER_MULTIPART_FILE_LIMIT: "1000" },
    })
      .with(AlephaServerMultipart)
      .with(BinaryFileApp);
    await alepha.start();

    // Create binary content
    const binaryContent = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const file = new File([binaryContent], "image.png", { type: "image/png" });

    const result = await alepha.inject(BinaryFileApp).upload.run({
      body: { file },
    });

    expect(result).toBe("Binary file: image.png, 6 bytes, image/png");
  });
});
