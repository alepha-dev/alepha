import { Alepha, z } from "alepha";
import { $action, ServerProvider } from "alepha/server";
import { FileSystemProvider, NodeFileSystemProvider } from "alepha/system";
import { describe, test } from "vitest";

import { $swagger } from "../index.ts";

class App {
  docs = $swagger({
    info: {
      title: "Test API",
      description: "This is a test API",
      version: "1.0.0",
    },
    prefix: "/test",
    ui: true,
  });

  hello = $action({
    schema: {
      response: z.object({
        message: z.text(),
      }),
    },
    handler: async () => {
      return {
        message: "Hello world",
      };
    },
  });
}

describe("Swagger UI", () => {
  // The UI page is served from the package's real on-disk assets — the
  // memory default has nothing to serve.
  const alepha = Alepha.create()
    .with({ provide: FileSystemProvider, use: NodeFileSystemProvider })
    .with(App);
  const server = alepha.inject(ServerProvider);

  test("ui", async ({ expect }) => {
    const html = await fetch(`${server.hostname}/test/`).then((it) =>
      it.text(),
    );
    expect(html).toContain('<div id="swagger-ui"></div>');

    const initializer = await fetch(
      `${server.hostname}/test/swagger-initializer.js`,
    ).then((it) => it.text());
    expect(initializer).toContain("SwaggerUIBundle");

    const json = await fetch(`${server.hostname}/test/json`).then((it) =>
      it.text(),
    );
    expect(json).toContain("Test API");
    expect(json).toContain("hello");
  });
});
