import { $pipeline, Alepha } from "alepha";
import { AlephaServer } from "alepha/server";
import { describe, test } from "vitest";
import { AlephaServerCors } from "../index.ts";
import { $cors } from "../primitives/$cors.ts";

// -----------------------------------------------------------------------------------------------------------------
// $cors — core behavior
// -----------------------------------------------------------------------------------------------------------------

describe("$cors", () => {
  test("applies CORS headers to request", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaServer).with(AlephaServerCors);

    class TestService {
      fn = $pipeline({
        use: [$cors({ origin: "https://app.example.com" })],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);

    await alepha.context.run(async () => {
      const headers: Record<string, string> = {};
      alepha.set("alepha.http.request", {
        headers: { origin: "https://app.example.com" },
        reply: {
          setHeader: (name: string, value: string) => {
            headers[name] = value;
          },
        },
      } as any);

      expect(await svc.fn()).toBe("ok");
      expect(headers["Access-Control-Allow-Origin"]).toBe(
        "https://app.example.com",
      );
    });
  });

  test("throws AlephaError when no request context", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaServer).with(AlephaServerCors);

    class TestService {
      fn = $pipeline({
        use: [$cors()],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);

    await expect(svc.fn()).rejects.toThrowError(
      "$cors requires a request context",
    );
  });

  test("does not set origin header when origin is disallowed", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaServer).with(AlephaServerCors);

    class TestService {
      fn = $pipeline({
        use: [$cors({ origin: "https://allowed.example.com" })],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);

    await alepha.context.run(async () => {
      const headers: Record<string, string> = {};
      alepha.set("alepha.http.request", {
        headers: { origin: "https://disallowed.example.com" },
        reply: {
          setHeader: (name: string, value: string) => {
            headers[name] = value;
          },
        },
      } as any);

      expect(await svc.fn()).toBe("ok");
      expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
    });
  });

  test("applies credentials header when enabled", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaServer).with(AlephaServerCors);

    class TestService {
      fn = $pipeline({
        use: [$cors({ origin: "*", credentials: true })],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);

    await alepha.context.run(async () => {
      const headers: Record<string, string> = {};
      alepha.set("alepha.http.request", {
        headers: { origin: "https://any.example.com" },
        reply: {
          setHeader: (name: string, value: string) => {
            headers[name] = value;
          },
        },
      } as any);

      await svc.fn();
      expect(headers["Access-Control-Allow-Credentials"]).toBe("true");
    });
  });

  test("applies methods and headers", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaServer).with(AlephaServerCors);

    class TestService {
      fn = $pipeline({
        use: [
          $cors({
            origin: "*",
            methods: ["GET", "POST"],
            headers: ["X-Custom"],
          }),
        ],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);

    await alepha.context.run(async () => {
      const headers: Record<string, string> = {};
      alepha.set("alepha.http.request", {
        headers: { origin: "https://any.example.com" },
        reply: {
          setHeader: (name: string, value: string) => {
            headers[name] = value;
          },
        },
      } as any);

      await svc.fn();
      expect(headers["Access-Control-Allow-Methods"]).toBe("GET, POST");
      expect(headers["Access-Control-Allow-Headers"]).toBe("X-Custom");
    });
  });

  test("handler arguments are passed through", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaServer).with(AlephaServerCors);

    class TestService {
      fn = $pipeline({
        use: [$cors({ origin: "*" })],
        handler: async (a: number, b: number) => a + b,
      });
    }

    const svc = alepha.inject(TestService);

    await alepha.context.run(async () => {
      alepha.set("alepha.http.request", {
        headers: { origin: "https://any.example.com" },
        reply: { setHeader: () => {} },
      } as any);

      expect(await svc.fn(3, 4)).toBe(7);
    });
  });

  test("OPTIONS preflight returns 204 and skips handler", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaServer).with(AlephaServerCors);

    let handlerCalled = false;
    class TestService {
      fn = $pipeline({
        use: [$cors({ origin: "*" })],
        handler: async () => {
          handlerCalled = true;
          return "ok";
        },
      });
    }

    const svc = alepha.inject(TestService);

    await alepha.context.run(async () => {
      const headers: Record<string, string> = {};
      let status: number | undefined;
      alepha.set("alepha.http.request", {
        method: "OPTIONS",
        headers: { origin: "https://any.example.com" },
        reply: {
          setHeader: (name: string, value: string) => {
            headers[name] = value;
          },
          setStatus: (s: number) => {
            status = s;
          },
        },
      } as any);

      const result = await svc.fn();
      expect(result).toBeUndefined();
      expect(handlerCalled).toBe(false);
      expect(status).toBe(204);
      expect(headers["Access-Control-Allow-Origin"]).toBe(
        "https://any.example.com",
      );
    });
  });
});

// -----------------------------------------------------------------------------------------------------------------
// $cors — metadata
// -----------------------------------------------------------------------------------------------------------------

describe("$cors metadata", () => {
  test("has middleware metadata", ({ expect }) => {
    const alepha = Alepha.create().with(AlephaServer).with(AlephaServerCors);

    class TestService {
      fn = $pipeline({
        use: [$cors({ origin: "*" })],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);
    const meta = svc.fn.middlewares;
    expect(meta).toHaveLength(1);
    expect(meta[0].name).toBe("$cors");
  });
});
