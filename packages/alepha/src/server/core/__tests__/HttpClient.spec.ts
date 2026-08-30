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

/**
 * The trace line printed every request header verbatim, so a request carrying
 * a session cookie or a bearer token wrote the credential itself into the
 * log. Either is enough to act as the user, so neither can be there whatever
 * the level is set to.
 */
describe("HttpClient trace redaction", () => {
  class TestHttpClient extends HttpClient {
    public testRedactHeaders = (headers: HeadersInit | undefined) =>
      this.redactHeaders(headers) as Record<string, string> | undefined;
  }

  const client = () => Alepha.create().inject(TestHttpClient);

  it("redacts every credential-bearing header", ({ expect }) => {
    expect(
      client().testRedactHeaders({
        authorization: "Bearer super-secret",
        cookie: "tokens=super-secret",
        "content-type": "application/json",
      }),
    ).toEqual({
      authorization: "[redacted]",
      cookie: "[redacted]",
      "content-type": "application/json",
    });
  });

  it("handles every HeadersInit shape, and lowercases the names", ({
    expect,
  }) => {
    // A caller may pass a plain object, an entry array or a `Headers`, and a
    // header name is case-insensitive: `Cookie` must redact like `cookie`.
    expect(client().testRedactHeaders(new Headers({ Cookie: "a=b" }))).toEqual({
      cookie: "[redacted]",
    });
    expect(client().testRedactHeaders([["Authorization", "Bearer x"]])).toEqual(
      { authorization: "[redacted]" },
    );
  });

  it("leaves an absent header list alone", ({ expect }) => {
    expect(client().testRedactHeaders(undefined)).toBeUndefined();
  });

  /**
   * The redaction must not be paid for when nothing is listening.
   *
   * The trace's argument object is built before `log.trace` is ever called,
   * so `redactHeaders` ran on every single `fetch()` whatever the level was,
   * allocating a `Headers` and copying every entry into a fresh object for a
   * line that is off in production. `HttpClient` is on the hot path: SSR,
   * forwarded remote actions, `/api/_batch`.
   */
  it("does not build the redaction when TRACE is off", async ({ expect }) => {
    class CountingHttpClient extends HttpClient {
      public redactions = 0;
      protected redactHeaders(headers: HeadersInit | undefined): unknown {
        this.redactions++;
        return super.redactHeaders(headers);
      }
    }

    const alepha = Alepha.create();
    const counting = alepha.inject(CountingHttpClient);
    await alepha.start();
    // The suite itself runs at TRACE, which is what makes the other specs in
    // this repo able to assert on log output. Set the level this test is
    // actually about, rather than muting the logger globally.
    alepha.store.set("alepha.logger.level", "info");

    // Nothing is listening on port 1, so this fails before any response is
    // parsed. The trace happens first, which is exactly what is being
    // measured: the counter would already be 1 if the guard were missing.
    await counting
      .fetch("http://127.0.0.1:1/never", { headers: { cookie: "a=b" } })
      .catch(() => undefined);

    expect(counting.redactions).toBe(0);

    // And it is genuinely the level doing it, not a call path that stopped
    // reaching the trace at all.
    alepha.store.set("alepha.logger.level", "trace");
    await counting
      .fetch("http://127.0.0.1:1/never", { headers: { cookie: "a=b" } })
      .catch(() => undefined);

    expect(counting.redactions).toBe(1);
  });
});
