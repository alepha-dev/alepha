import { $pipeline, Alepha } from "alepha";
import { describe, test } from "vitest";

import { $retry } from "../primitives/$retry.ts";

describe("$retry middleware", () => {
  test("retries handler on failure", async ({ expect }) => {
    const alepha = Alepha.create();

    let attempts = 0;
    class TestService {
      fn = $pipeline({
        use: [$retry({ max: 3, backoff: 0 })],
        handler: async () => {
          attempts++;
          if (attempts < 3) throw new Error("fail");
          return "ok";
        },
      });
    }

    const svc = alepha.inject(TestService);

    expect(await svc.fn()).toBe("ok");
    expect(attempts).toBe(3);
  });

  test("throws after max retries exceeded", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      fn = $pipeline({
        use: [$retry({ max: 2, backoff: 0 })],
        handler: async () => {
          throw new Error("always fails");
        },
      });
    }

    const svc = alepha.inject(TestService);

    await expect(svc.fn()).rejects.toThrowError("always fails");
  });

  test("passes handler arguments through", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      fn = $pipeline({
        use: [$retry({ max: 1 })],
        handler: async (a: number, b: number) => a + b,
      });
    }

    const svc = alepha.inject(TestService);

    expect(await svc.fn(3, 4)).toBe(7);
  });

  test("respects when predicate", async ({ expect }) => {
    const alepha = Alepha.create();

    let attempts = 0;
    class TestService {
      fn = $pipeline({
        use: [
          $retry({
            max: 5,
            backoff: 0,
            when: (err) => err.message === "retryable",
          }),
        ],
        handler: async () => {
          attempts++;
          if (attempts === 1) throw new Error("retryable");
          throw new Error("not retryable");
        },
      });
    }

    const svc = alepha.inject(TestService);

    await expect(svc.fn()).rejects.toThrowError("not retryable");
    expect(attempts).toBe(2);
  });

  test("has middleware metadata", ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      fn = $pipeline({
        use: [$retry({ max: 3 })],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);
    const meta = svc.fn.middlewares;
    expect(meta).toHaveLength(1);
    expect(meta[0].name).toBe("$retry");
  });
});
