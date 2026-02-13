import { $pipeline, Alepha } from "alepha";
import { describe, test } from "vitest";
import { $memoize } from "./$memoize.ts";

// -----------------------------------------------------------------------------------------------------------------
// $memoize — core behavior
// -----------------------------------------------------------------------------------------------------------------

describe("$memoize", () => {
  test("caches handler result in-process", async ({ expect }) => {
    const alepha = Alepha.create();

    let calls = 0;
    class TestService {
      fn = $pipeline({
        use: [$memoize()],
        handler: async (id: string) => {
          calls++;
          return `result:${id}`;
        },
      });
    }

    const svc = alepha.inject(TestService);

    expect(await svc.fn("a")).toBe("result:a");
    expect(await svc.fn("a")).toBe("result:a");
    expect(calls).toBe(1);

    // Different arg = different key
    expect(await svc.fn("b")).toBe("result:b");
    expect(calls).toBe(2);
  });

  test("handler arguments and return value are preserved", async ({
    expect,
  }) => {
    const alepha = Alepha.create();

    class TestService {
      fn = $pipeline({
        use: [$memoize()],
        handler: async (a: number, b: number) => a + b,
      });
    }

    const svc = alepha.inject(TestService);
    expect(await svc.fn(3, 4)).toBe(7);
  });

  test("handler errors propagate (not cached)", async ({ expect }) => {
    const alepha = Alepha.create();

    let calls = 0;
    class TestService {
      fn = $pipeline({
        use: [$memoize()],
        handler: async () => {
          calls++;
          throw new Error("Failed");
        },
      });
    }

    const svc = alepha.inject(TestService);
    await expect(svc.fn()).rejects.toThrowError("Failed");
    await expect(svc.fn()).rejects.toThrowError("Failed");
    // Each call invokes handler since errors are not cached
    expect(calls).toBe(2);
  });

  test("caches falsy values (0, empty string, false, null)", async ({
    expect,
  }) => {
    const alepha = Alepha.create();

    let calls = 0;
    class TestService {
      fn = $pipeline({
        use: [$memoize()],
        handler: async (x: any) => {
          calls++;
          return x;
        },
      });
    }

    const svc = alepha.inject(TestService);

    expect(await svc.fn(0)).toBe(0);
    expect(await svc.fn(0)).toBe(0);

    expect(await svc.fn("")).toBe("");
    expect(await svc.fn("")).toBe("");

    expect(await svc.fn(false)).toBe(false);
    expect(await svc.fn(false)).toBe(false);

    expect(await svc.fn(null)).toBe(null);
    expect(await svc.fn(null)).toBe(null);

    expect(calls).toBe(4); // one per distinct arg
  });

  test("custom key function", async ({ expect }) => {
    const alepha = Alepha.create();

    let calls = 0;
    class TestService {
      fn = $pipeline({
        use: [$memoize({ key: (id: string, _extra: string) => id })],
        handler: async (id: string, extra: string) => {
          calls++;
          return `${id}:${extra}`;
        },
      });
    }

    const svc = alepha.inject(TestService);

    expect(await svc.fn("a", "x")).toBe("a:x");
    // Same key, different extra — returns cached
    expect(await svc.fn("a", "y")).toBe("a:x");
    expect(calls).toBe(1);
  });
});

// -----------------------------------------------------------------------------------------------------------------
// $memoize — max size / eviction
// -----------------------------------------------------------------------------------------------------------------

describe("$memoize max size", () => {
  test("evicts oldest entry when max is reached", async ({ expect }) => {
    const alepha = Alepha.create();

    let calls = 0;
    class TestService {
      fn = $pipeline({
        use: [$memoize({ max: 2 })],
        handler: async (id: string) => {
          calls++;
          return `v${calls}:${id}`;
        },
      });
    }

    const svc = alepha.inject(TestService);

    expect(await svc.fn("a")).toBe("v1:a"); // stored: [a]
    expect(await svc.fn("b")).toBe("v2:b"); // stored: [a, b]

    // "a" and "b" are cached
    expect(await svc.fn("a")).toBe("v1:a");
    expect(await svc.fn("b")).toBe("v2:b");
    expect(calls).toBe(2);

    // Adding "c" evicts "a" (oldest)
    expect(await svc.fn("c")).toBe("v3:c"); // stored: [b, c]
    expect(calls).toBe(3);

    // "a" was evicted — recomputed
    expect(await svc.fn("a")).toBe("v4:a"); // stored: [c, a]
    expect(calls).toBe(4);

    // "b" was evicted by "a" — recomputed
    expect(await svc.fn("b")).toBe("v5:b");
    expect(calls).toBe(5);
  });
});

// -----------------------------------------------------------------------------------------------------------------
// $memoize — metadata
// -----------------------------------------------------------------------------------------------------------------

describe("$memoize metadata", () => {
  test("has middleware metadata", ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      fn = $pipeline({
        use: [$memoize({ max: 100 })],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);
    const meta = svc.fn.middlewares;
    expect(meta).toHaveLength(1);
    expect(meta[0].name).toBe("$memoize");
  });

  test("metadata includes options", ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      fn = $pipeline({
        use: [$memoize({ max: 50 })],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);
    const meta = svc.fn.middlewares;
    expect(meta[0].options).toEqual({ max: 50 });
  });

  test("metadata without options", ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      fn = $pipeline({
        use: [$memoize()],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);
    const meta = svc.fn.middlewares;
    expect(meta[0].name).toBe("$memoize");
  });
});
