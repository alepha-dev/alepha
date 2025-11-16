import { Alepha, t } from "alepha/core";
import { describe, it } from "vitest";
import { $action, HttpError } from "../../src/server";

describe("ServerBodyParserProvider", () => {
  it("should handle simple body", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestApp {
      json = $action({
        schema: {
          body: t.object({
            message: t.text(),
          }),
          response: t.object({
            received: t.text(),
          }),
        },
        handler: ({ body }) => ({ received: body.message }),
      });
      string = $action({
        schema: {
          body: t.text(),
          response: t.object({
            received: t.text(),
          }),
        },
        handler: ({ body }) => ({ received: body }),
      });
    }

    const app = alepha.inject(TestApp);
    await alepha.start();

    expect(
      await app.json.run({
        body: { message: "Hello, World!" },
      }),
    ).toEqual({
      received: "Hello, World!",
    });

    expect(app.json.getBodyContentType()).toBe("application/json");

    expect(
      await app.string.run({
        body: "Hello, World!",
      }),
    ).toEqual({
      received: "Hello, World!",
    });

    expect(app.string.getBodyContentType()).toBe("text/plain");
  });

  it("should reject big payload", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestApp {
      test = $action({
        schema: {
          body: t.object({
            message: t.text({
              maxLength: 1000000, // allow up to 1 million characters (for http client validation)
            }),
          }),
          response: t.object({
            received: t.text(),
          }),
        },
        handler: ({ body }) => {
          return { received: body.message };
        },
      });
    }

    const app = alepha.inject(TestApp);
    await alepha.start();

    expect(
      await app.test
        .fetch({
          body: { message: "A".repeat(1000000) },
        })
        .catch((e) => HttpError.toJSON(e)),
    ).toEqual({
      error: "PayloadTooLargeError",
      status: 413,
      message: "Request body size limit exceeded",
      requestId: expect.any(String),
    });
  });
});
