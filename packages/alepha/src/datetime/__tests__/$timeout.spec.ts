import { $pipeline, Alepha } from "alepha";
import { describe, test } from "vitest";

import { $timeout } from "../primitives/$timeout.ts";
import { DateTimeProvider } from "../providers/DateTimeProvider.ts";

// -----------------------------------------------------------------------------------------------------------------
// $timeout — core behavior
// -----------------------------------------------------------------------------------------------------------------

describe("$timeout", () => {
  test("handler that completes before deadline returns normally", async ({
    expect,
  }) => {
    const alepha = Alepha.create();

    class TestService {
      fn = $pipeline({
        use: [$timeout([1, "seconds"])],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);
    expect(await svc.fn()).toBe("ok");
  });

  test("handler that exceeds deadline rejects", async ({ expect }) => {
    const alepha = Alepha.create();
    const dt = alepha.inject(DateTimeProvider);

    class TestService {
      fn = $pipeline({
        use: [$timeout([50, "milliseconds"])],
        handler: async () => {
          await dt.wait([200, "milliseconds"]);
          return "too late";
        },
      });
    }

    const svc = alepha.inject(TestService);
    await expect(svc.fn()).rejects.toThrowError(
      "$timeout: handler exceeded deadline",
    );
  });

  test("handler return value is preserved", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      fn = $pipeline({
        use: [$timeout([1, "seconds"])],
        handler: async () => ({ data: [1, 2, 3] }),
      });
    }

    const svc = alepha.inject(TestService);
    expect(await svc.fn()).toEqual({ data: [1, 2, 3] });
  });

  test("handler arguments are passed through", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      fn = $pipeline({
        use: [$timeout([1, "seconds"])],
        handler: async (a: number, b: number) => a + b,
      });
    }

    const svc = alepha.inject(TestService);
    expect(await svc.fn(3, 4)).toBe(7);
  });

  test("handler errors propagate (not masked by timeout)", async ({
    expect,
  }) => {
    const alepha = Alepha.create();

    class TestService {
      fn = $pipeline({
        use: [$timeout([1, "seconds"])],
        handler: async () => {
          throw new Error("Handler failed");
        },
      });
    }

    const svc = alepha.inject(TestService);
    await expect(svc.fn()).rejects.toThrowError("Handler failed");
  });

  test("accepts number (milliseconds) as duration", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      fn = $pipeline({
        use: [$timeout(1000)],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);
    expect(await svc.fn()).toBe("ok");
  });
});

// -----------------------------------------------------------------------------------------------------------------
// $timeout — metadata
// -----------------------------------------------------------------------------------------------------------------

describe("$timeout metadata", () => {
  test("has middleware metadata with name and options", ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      fn = $pipeline({
        use: [$timeout([30, "seconds"])],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);
    const meta = svc.fn.middlewares;
    expect(meta).toHaveLength(1);
    expect(meta[0]).toEqual({
      name: "$timeout",
      options: { duration: [30, "seconds"] },
    });
  });
});

// -----------------------------------------------------------------------------------------------------------------
// $timeout — composition
// -----------------------------------------------------------------------------------------------------------------

describe("$timeout composition", () => {
  test("composes with other middleware", async ({ expect }) => {
    const calls: string[] = [];
    const alepha = Alepha.create();

    class TestService {
      fn = $pipeline({
        use: [
          $timeout([1, "seconds"]),
          // Inline logging middleware
          ((handler: any) =>
            async (...args: any[]) => {
              calls.push("log:before");
              const result = await handler(...args);
              calls.push("log:after");
              return result;
            }) as any,
        ],
        handler: async () => {
          calls.push("handler");
          return "ok";
        },
      });
    }

    const svc = alepha.inject(TestService);
    await svc.fn();
    expect(calls).toEqual(["log:before", "handler", "log:after"]);
  });

  test("timeout fires even when inner middleware is slow", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    const dt = alepha.inject(DateTimeProvider);

    class TestService {
      fn = $pipeline({
        use: [
          $timeout([50, "milliseconds"]),
          // Slow middleware that delays before calling handler
          ((handler: any) =>
            async (...args: any[]) => {
              await dt.wait([200, "milliseconds"]);
              return handler(...args);
            }) as any,
        ],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);
    await expect(svc.fn()).rejects.toThrowError(
      "$timeout: handler exceeded deadline",
    );
  });
});
