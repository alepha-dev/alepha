import { Alepha, t } from "@alepha/core";
import { $action, ServerProvider } from "@alepha/server";
import { describe, expect, test } from "vitest";
import { AlephaServerMultipart } from "../src";

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
