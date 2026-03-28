import { $pipeline, Alepha } from "alepha";
import { AlephaCache } from "alepha/cache";
import { AlephaServer, HttpError, type ServerRequest } from "alepha/server";
import { describe, test } from "vitest";
import { AlephaServerRateLimit } from "../index.ts";
import { $rateLimit } from "../primitives/$rateLimit.ts";

// -----------------------------------------------------------------------------------------------------------------
// Test helpers
// -----------------------------------------------------------------------------------------------------------------

const createFakeRequest = (ip = "127.0.0.1"): ServerRequest => {
  const headers: Record<string, string> = {};
  return {
    ip,
    headers: {},
    method: "GET",
    url: "/test",
    path: "/test",
    query: {},
    params: {},
    body: undefined,
    reply: {
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
      _headers: headers,
    },
  } as any;
};

// -----------------------------------------------------------------------------------------------------------------
// $rateLimit — core behavior
// -----------------------------------------------------------------------------------------------------------------

describe("$rateLimit", () => {
  test("allows requests within limit", async ({ expect }) => {
    const alepha = Alepha.create()
      .with(AlephaCache)
      .with(AlephaServer)
      .with(AlephaServerRateLimit);

    class TestService {
      fn = $pipeline({
        use: [$rateLimit({ max: 5, windowMs: 60000 })],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);
    await alepha.start();

    await alepha.context.run(async () => {
      alepha.set("alepha.http.request", createFakeRequest());
      expect(await svc.fn()).toBe("ok");
    });

    await alepha.stop();
  });

  test("throws HttpError 429 when limit exceeded", async ({ expect }) => {
    const alepha = Alepha.create()
      .with(AlephaCache)
      .with(AlephaServer)
      .with(AlephaServerRateLimit);

    class TestService {
      fn = $pipeline({
        use: [$rateLimit({ max: 2, windowMs: 60000 })],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);
    await alepha.start();

    await alepha.context.run(async () => {
      alepha.set("alepha.http.request", createFakeRequest());

      // First two pass
      expect(await svc.fn()).toBe("ok");
      expect(await svc.fn()).toBe("ok");

      // Third fails
      await expect(svc.fn()).rejects.toThrowError("Too Many Requests");
    });

    await alepha.stop();
  });

  test("falls back to global key when no request context", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with(AlephaCache)
      .with(AlephaServer)
      .with(AlephaServerRateLimit);

    class TestService {
      fn = $pipeline({
        use: [$rateLimit({ max: 2, windowMs: 60000 })],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);
    await alepha.start();

    // No request context — uses "global" key
    expect(await svc.fn()).toBe("ok");
    expect(await svc.fn()).toBe("ok");
    await expect(svc.fn()).rejects.toThrowError("Too Many Requests");

    await alepha.stop();
  });

  test("uses custom key function without request context", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with(AlephaCache)
      .with(AlephaServer)
      .with(AlephaServerRateLimit);

    class TestService {
      fn = $pipeline({
        use: [
          $rateLimit({
            max: 1,
            windowMs: 60000,
            key: (id: string) => `user:${id}`,
          }),
        ],
        handler: async (id: string) => `ok:${id}`,
      });
    }

    const svc = alepha.inject(TestService);
    await alepha.start();

    // Different keys = different buckets
    expect(await svc.fn("a")).toBe("ok:a");
    expect(await svc.fn("b")).toBe("ok:b");

    // Same key = shared bucket, limit exceeded
    await expect(svc.fn("a")).rejects.toThrowError("Too Many Requests");

    await alepha.stop();
  });

  test("sets rate limit headers on response", async ({ expect }) => {
    const alepha = Alepha.create()
      .with(AlephaCache)
      .with(AlephaServer)
      .with(AlephaServerRateLimit);

    class TestService {
      fn = $pipeline({
        use: [$rateLimit({ max: 5, windowMs: 60000 })],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);
    await alepha.start();

    await alepha.context.run(async () => {
      const req = createFakeRequest();
      alepha.set("alepha.http.request", req);

      await svc.fn();

      const headers = (req.reply as any)._headers;
      expect(headers["X-RateLimit-Limit"]).toBe("5");
      expect(headers["X-RateLimit-Remaining"]).toBe("4");
      expect(headers["X-RateLimit-Reset"]).toBeDefined();
    });

    await alepha.stop();
  });

  test("different IPs have separate limits", async ({ expect }) => {
    const alepha = Alepha.create()
      .with(AlephaCache)
      .with(AlephaServer)
      .with(AlephaServerRateLimit);

    class TestService {
      fn = $pipeline({
        use: [$rateLimit({ max: 1, windowMs: 60000 })],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);
    await alepha.start();

    // First IP
    await alepha.context.run(async () => {
      alepha.set("alepha.http.request", createFakeRequest("10.0.0.1"));
      expect(await svc.fn()).toBe("ok");
    });

    // Second IP — separate bucket
    await alepha.context.run(async () => {
      alepha.set("alepha.http.request", createFakeRequest("10.0.0.2"));
      expect(await svc.fn()).toBe("ok");
    });

    await alepha.stop();
  });

  test("handler arguments are passed through", async ({ expect }) => {
    const alepha = Alepha.create()
      .with(AlephaCache)
      .with(AlephaServer)
      .with(AlephaServerRateLimit);

    class TestService {
      fn = $pipeline({
        use: [$rateLimit({ max: 10, windowMs: 60000 })],
        handler: async (a: number, b: number) => a + b,
      });
    }

    const svc = alepha.inject(TestService);
    await alepha.start();

    await alepha.context.run(async () => {
      alepha.set("alepha.http.request", createFakeRequest());
      expect(await svc.fn(3, 4)).toBe(7);
    });

    await alepha.stop();
  });

  test("thrown error is HttpError with status 429", async ({ expect }) => {
    const alepha = Alepha.create()
      .with(AlephaCache)
      .with(AlephaServer)
      .with(AlephaServerRateLimit);

    class TestService {
      fn = $pipeline({
        use: [$rateLimit({ max: 1, windowMs: 60000 })],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);
    await alepha.start();

    await alepha.context.run(async () => {
      alepha.set("alepha.http.request", createFakeRequest());

      await svc.fn(); // Use up the limit

      try {
        await svc.fn();
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(HttpError);
        expect((error as HttpError).status).toBe(429);
      }
    });

    await alepha.stop();
  });
});

// -----------------------------------------------------------------------------------------------------------------
// $rateLimit — metadata
// -----------------------------------------------------------------------------------------------------------------

describe("$rateLimit metadata", () => {
  test("has middleware metadata", ({ expect }) => {
    const alepha = Alepha.create()
      .with(AlephaCache)
      .with(AlephaServer)
      .with(AlephaServerRateLimit);

    class TestService {
      fn = $pipeline({
        use: [$rateLimit({ max: 100, windowMs: 60000 })],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);
    const meta = svc.fn.middlewares;
    expect(meta).toHaveLength(1);
    expect(meta[0].name).toBe("$rateLimit");
  });
});
