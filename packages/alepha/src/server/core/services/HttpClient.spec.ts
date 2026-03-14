import { Alepha } from "alepha";
import { describe, it, test } from "vitest";
import {
  $action,
  $route,
  BadRequestError,
  HttpClient,
  HttpError,
  ServerProvider,
} from "../index.ts";

describe("HttpClient", () => {
  test("should fetch a URL", async ({ expect }) => {
    const alepha = Alepha.create();
    class TestApp {
      root = $route({
        path: "/",
        handler: () => "Hello, World!",
      });
    }
    const client = alepha.with(TestApp).inject(HttpClient);
    await alepha.start();

    const resp = await client.fetch<string>(
      `${alepha.inject(ServerProvider).hostname}`,
    );

    // response looks like Axios response
    expect(resp.data).toBe("Hello, World!");
  });

  test("should throw on Error", async ({ expect }) => {
    const alepha = Alepha.create();
    class TestApp {
      root = $route({
        path: "/",
        handler: () => {
          throw new BadRequestError();
        },
      });
    }
    const client = alepha.with(TestApp).inject(HttpClient);
    await alepha.start();

    const resp = await client
      .fetch<string>(`${alepha.inject(ServerProvider).hostname}`)
      .catch((e) => e);

    expect(resp).toBeInstanceOf(HttpError);
    expect(HttpError.toJSON(resp)).toEqual({
      error: "BadRequestError",
      message: "Invalid request body",
      status: 400,
      requestId: expect.any(String),
    });
  });

  test("should handle empty query params", async ({ expect }) => {
    const alepha = Alepha.create();
    const client = alepha.inject(HttpClient);
    await alepha.start();

    expect(client.queryParams("", {}, {})).toEqual("");
  });

  test("should handle simple query params", async ({ expect }) => {
    const alepha = Alepha.create();
    const client = alepha.inject(HttpClient);
    await alepha.start();

    expect(
      client.queryParams(
        "",
        {},
        {
          query: {
            hello: "world",
            a: "b",
          },
        },
      ),
    ).toEqual("?hello=world&a=b");
  });

  test("should handle undefined query params", async ({ expect }) => {
    const alepha = Alepha.create();
    const client = alepha.inject(HttpClient);
    await alepha.start();

    expect(
      client.queryParams(
        "",
        {},
        {
          query: {
            hello: undefined as any,
            a: "b",
          },
        },
      ),
    ).toEqual("?a=b");
  });

  describe("request deduplication", () => {
    it("should not deduplicate POST requests", async ({ expect }) => {
      let callCount = 0;

      const alepha = Alepha.create();
      class TestApp {
        counter = $action({
          method: "POST",
          handler: () => {
            callCount++;
            return { count: callCount };
          },
        });
      }
      const client = alepha.with(TestApp).inject(HttpClient);
      await alepha.start();
      const hostname = alepha.inject(ServerProvider).hostname;

      const [res1, res2] = await Promise.all([
        client.fetch(`${hostname}/api/counter`, { method: "POST" }),
        client.fetch(`${hostname}/api/counter`, { method: "POST" }),
      ]);

      expect(callCount).toBe(2);
      expect(res1.data).not.toBe(res2.data);
    });
  });

  test("should handle json", async ({ expect }) => {
    const alepha = Alepha.create();
    const client = alepha.inject(HttpClient);
    await alepha.start();

    expect(
      client.queryParams(
        "",
        {},
        {
          query: {
            tags: ["a", "b"],
            user: { name: "john" },
          },
        },
      ),
    ).toEqual(
      `?tags=${encodeURIComponent(JSON.stringify(["a", "b"]))}&user=${encodeURIComponent(JSON.stringify({ name: "john" }))}`,
    );
  });
});
