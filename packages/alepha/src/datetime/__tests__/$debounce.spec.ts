import { $pipeline, Alepha } from "alepha";
import { describe, test } from "vitest";

import { $debounce } from "../primitives/$debounce.ts";

// -----------------------------------------------------------------------------------------------------------------
// $debounce — core behavior
// -----------------------------------------------------------------------------------------------------------------

describe("$debounce", () => {
  test("single call executes handler normally", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      fn = $pipeline({
        use: [$debounce({ delay: [50, "milliseconds"] })],
        handler: async (x: number) => x * 2,
      });
    }

    const svc = alepha.inject(TestService);
    expect(await svc.fn(5)).toBe(10);
  });

  test("concurrent same-key calls share one execution", async ({ expect }) => {
    const alepha = Alepha.create();
    let handlerCalls = 0;

    class TestService {
      fn = $pipeline({
        use: [$debounce({ delay: [50, "milliseconds"], key: () => "same" })],
        handler: async () => {
          handlerCalls++;
          return "result";
        },
      });
    }

    const svc = alepha.inject(TestService);

    // Fire 3 concurrent calls with same key
    const [a, b, c] = await Promise.all([svc.fn(), svc.fn(), svc.fn()]);

    expect(a).toBe("result");
    expect(b).toBe("result");
    expect(c).toBe("result");
    expect(handlerCalls).toBe(1); // Handler ran only once
  });

  test("different keys execute independently", async ({ expect }) => {
    const alepha = Alepha.create();
    let handlerCalls = 0;

    class TestService {
      fn = $pipeline({
        use: [
          $debounce({
            delay: [50, "milliseconds"],
            key: (...args: any[]) => String(args[0]),
          }),
        ],
        handler: async (x: number) => {
          handlerCalls++;
          return x * 2;
        },
      });
    }

    const svc = alepha.inject(TestService);

    const [a, b] = await Promise.all([svc.fn(1), svc.fn(2)]);

    expect(a).toBe(2);
    expect(b).toBe(4);
    expect(handlerCalls).toBe(2); // Two different keys = two executions
  });

  test("after execution completes, next call starts fresh", async ({
    expect,
  }) => {
    const alepha = Alepha.create();
    let handlerCalls = 0;

    class TestService {
      fn = $pipeline({
        use: [$debounce({ delay: [10, "milliseconds"], key: () => "same" })],
        handler: async () => ++handlerCalls,
      });
    }

    const svc = alepha.inject(TestService);

    const first = await svc.fn();
    expect(first).toBe(1);

    // Wait for pending to clear
    await new Promise((r) => setTimeout(r, 20));

    const second = await svc.fn();
    expect(second).toBe(2);
    expect(handlerCalls).toBe(2);
  });

  test("handler error propagates to all callers", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      fn = $pipeline({
        use: [$debounce({ delay: [50, "milliseconds"], key: () => "same" })],
        handler: async () => {
          throw new Error("Boom");
        },
      });
    }

    const svc = alepha.inject(TestService);

    const results = await Promise.allSettled([svc.fn(), svc.fn()]);

    expect(results[0].status).toBe("rejected");
    expect(results[1].status).toBe("rejected");
    expect((results[0] as PromiseRejectedResult).reason.message).toBe("Boom");
    expect((results[1] as PromiseRejectedResult).reason.message).toBe("Boom");
  });

  test("defaults key to JSON.stringify(args)", async ({ expect }) => {
    const alepha = Alepha.create();
    let handlerCalls = 0;

    class TestService {
      fn = $pipeline({
        use: [$debounce({ delay: [50, "milliseconds"] })],
        handler: async (x: number) => {
          handlerCalls++;
          return x;
        },
      });
    }

    const svc = alepha.inject(TestService);

    // Same args → same default key → coalesced
    const [a, b] = await Promise.all([svc.fn(42), svc.fn(42)]);
    expect(a).toBe(42);
    expect(b).toBe(42);
    expect(handlerCalls).toBe(1);
  });
});

// -----------------------------------------------------------------------------------------------------------------
// $debounce — metadata
// -----------------------------------------------------------------------------------------------------------------

describe("$debounce metadata", () => {
  test("has middleware metadata", ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      fn = $pipeline({
        use: [$debounce({ delay: [200, "milliseconds"] })],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);
    const meta = svc.fn.middlewares;
    expect(meta).toHaveLength(1);
    expect(meta[0].name).toBe("$debounce");
  });
});
