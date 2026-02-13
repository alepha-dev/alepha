import { $pipeline, Alepha } from "alepha";
import { AlephaServer } from "alepha/server";
import { describe, test } from "vitest";
import { AlephaServerHelmet } from "../index.ts";
import { $helmet } from "./$helmet.ts";

// -----------------------------------------------------------------------------------------------------------------
// $helmet — core behavior
// -----------------------------------------------------------------------------------------------------------------

describe("$helmet", () => {
  test("applies default security headers on request reply", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaServer).with(AlephaServerHelmet);

    class TestService {
      fn = $pipeline({
        use: [$helmet()],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);

    await alepha.context.run(async () => {
      const headers: Record<string, string> = {};
      alepha.set("alepha.http.request", {
        headers: {},
        reply: {
          setHeader: (name: string, value: string) => {
            headers[name] = value;
          },
        },
      } as any);

      expect(await svc.fn()).toBe("ok");
      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["x-frame-options"]).toBe("SAMEORIGIN");
      expect(headers["referrer-policy"]).toBe(
        "strict-origin-when-cross-origin",
      );
    });
  });

  test("applies per-route overrides", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaServer).with(AlephaServerHelmet);

    class TestService {
      fn = $pipeline({
        use: [$helmet({ xFrameOptions: "DENY" })],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);

    await alepha.context.run(async () => {
      const headers: Record<string, string> = {};
      alepha.set("alepha.http.request", {
        headers: {},
        reply: {
          setHeader: (name: string, value: string) => {
            headers[name] = value;
          },
        },
      } as any);

      await svc.fn();
      expect(headers["x-frame-options"]).toBe("DENY");
    });
  });

  test("throws AlephaError when no request context", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaServer).with(AlephaServerHelmet);

    class TestService {
      fn = $pipeline({
        use: [$helmet()],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);

    await expect(svc.fn()).rejects.toThrowError(
      "$helmet requires a request context",
    );
  });

  test("passes handler arguments through", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaServer).with(AlephaServerHelmet);

    class TestService {
      fn = $pipeline({
        use: [$helmet()],
        handler: async (a: number, b: number) => a + b,
      });
    }

    const svc = alepha.inject(TestService);

    await alepha.context.run(async () => {
      alepha.set("alepha.http.request", {
        headers: {},
        reply: { setHeader: () => {} },
      } as any);

      expect(await svc.fn(3, 4)).toBe(7);
    });
  });
});

// -----------------------------------------------------------------------------------------------------------------
// $helmet — metadata
// -----------------------------------------------------------------------------------------------------------------

describe("$helmet metadata", () => {
  test("has middleware metadata", ({ expect }) => {
    const alepha = Alepha.create().with(AlephaServer).with(AlephaServerHelmet);

    class TestService {
      fn = $pipeline({
        use: [$helmet({ xFrameOptions: "DENY" })],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);
    const meta = svc.fn.middlewares;
    expect(meta).toHaveLength(1);
    expect(meta[0].name).toBe("$helmet");
    expect(meta[0].options).toEqual({ xFrameOptions: "DENY" });
  });

  test("has metadata with no options", ({ expect }) => {
    const alepha = Alepha.create().with(AlephaServer).with(AlephaServerHelmet);

    class TestService {
      fn = $pipeline({
        use: [$helmet()],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);
    const meta = svc.fn.middlewares;
    expect(meta).toHaveLength(1);
    expect(meta[0].name).toBe("$helmet");
  });
});
