import { $pipeline, Alepha } from "alepha";
import { describe, test } from "vitest";

import { $throttle } from "../primitives/$throttle.ts";
import { DateTimeProvider } from "../providers/DateTimeProvider.ts";

// -----------------------------------------------------------------------------------------------------------------
// $throttle — core behavior
// -----------------------------------------------------------------------------------------------------------------

describe("$throttle", () => {
  test("calls within rate pass through instantly", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      fn = $pipeline({
        use: [$throttle({ rate: 5, per: [1, "seconds"] })],
        handler: async (x: number) => x * 2,
      });
    }

    const svc = alepha.inject(TestService);

    // 5 calls within rate limit
    for (let i = 0; i < 5; i++) {
      expect(await svc.fn(i)).toBe(i * 2);
    }
  });

  test("handler arguments and return value are preserved", async ({
    expect,
  }) => {
    const alepha = Alepha.create();

    class TestService {
      fn = $pipeline({
        use: [$throttle({ rate: 10, per: [1, "seconds"] })],
        handler: async (a: number, b: number) => a + b,
      });
    }

    const svc = alepha.inject(TestService);
    expect(await svc.fn(3, 4)).toBe(7);
  });

  test("handler errors propagate", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      fn = $pipeline({
        use: [$throttle({ rate: 10, per: [1, "seconds"] })],
        handler: async () => {
          throw new Error("Failed");
        },
      });
    }

    const svc = alepha.inject(TestService);
    await expect(svc.fn()).rejects.toThrowError("Failed");
  });

  test("excess calls are delayed, not rejected", async ({ expect }) => {
    const alepha = Alepha.create();
    alepha.inject(DateTimeProvider);
    let callCount = 0;

    class TestService {
      fn = $pipeline({
        use: [$throttle({ rate: 2, per: [100, "milliseconds"] })],
        handler: async () => {
          callCount++;
          return "ok";
        },
      });
    }

    const svc = alepha.inject(TestService);

    // Exhaust the 2 tokens
    await svc.fn();
    await svc.fn();
    expect(callCount).toBe(2);

    // Third call should be delayed (wait for token refill), not rejected
    const promise = svc.fn();
    // It will eventually resolve
    expect(await promise).toBe("ok");
    expect(callCount).toBe(3);
  });

  test("tokens refill over time", async ({ expect }) => {
    const alepha = Alepha.create();
    let callCount = 0;

    class TestService {
      fn = $pipeline({
        use: [$throttle({ rate: 2, per: [50, "milliseconds"] })],
        handler: async () => ++callCount,
      });
    }

    const svc = alepha.inject(TestService);

    // Exhaust tokens
    await svc.fn();
    await svc.fn();

    // Wait for refill
    await new Promise((r) => setTimeout(r, 60));

    // Should have tokens again
    const result = await svc.fn();
    expect(result).toBe(3);
  });
});

// -----------------------------------------------------------------------------------------------------------------
// $throttle — metadata
// -----------------------------------------------------------------------------------------------------------------

describe("$throttle metadata", () => {
  test("has middleware metadata", ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      fn = $pipeline({
        use: [$throttle({ rate: 10, per: [1, "seconds"] })],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);
    const meta = svc.fn.middlewares;
    expect(meta).toHaveLength(1);
    expect(meta[0].name).toBe("$throttle");
  });
});
