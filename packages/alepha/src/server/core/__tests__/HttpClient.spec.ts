import { Alepha, z } from "alepha";
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

    const resp = await client.fetch(
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
      .fetch(`${alepha.inject(ServerProvider).hostname}`)
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
            return String(callCount);
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
      expect(res1.data).not.toEqual(res2.data);
    });
  });

  describe("path variables", () => {
    const pathVariables = async () => {
      const alepha = Alepha.create();
      const client = alepha.inject(HttpClient);
      await alepha.start();
      return (url: string, params: Record<string, any>) =>
        client.pathVariables(url, {}, { params });
    };

    it("should percent-encode a value", async ({ expect }) => {
      // Raw interpolation let `/`, `?`, `#` and spaces break or inject the URL.
      const build = await pathVariables();

      expect(build("/users/:id", { id: "John Doe" })).toBe("/users/John%20Doe");
      expect(build("/files/:name", { name: "a/b?c#d" })).toBe(
        "/files/a%2Fb%3Fc%23d",
      );
    });

    it("should treat `$&` in a value as literal text", async ({ expect }) => {
      // `$&`, `$'` and friends are replacement patterns: String.replace
      // expanded them against the match, corrupting the URL.
      const build = await pathVariables();

      expect(build("/search/:q", { q: "$&" })).toBe("/search/%24%26");
    });

    it("should not let `:id` consume the prefix of `:idType`", async ({
      expect,
    }) => {
      const build = await pathVariables();

      expect(build("/a/:idType/:id", { id: "1", idType: "sku" })).toBe(
        "/a/sku/1",
      );
    });

    it("should round-trip a value containing a space to the handler", async ({
      expect,
    }) => {
      // The client skipped encoding and the server skipped decoding, so this
      // only ever "worked" because both halves were broken.
      let received: string | undefined;

      class TestApp {
        getUser = $action({
          path: "/users/:id",
          schema: {
            params: z.object({ id: z.text() }),
            response: z.text(),
          },
          handler: ({ params }) => {
            received = params.id;
            return "ok";
          },
        });
      }

      const alepha = Alepha.create().with(TestApp);
      const app = alepha.inject(TestApp);
      await alepha.start();

      await app.getUser.fetch({ params: { id: "John Doe" } });

      expect(received).toBe("John Doe");
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
