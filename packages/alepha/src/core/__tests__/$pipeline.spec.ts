import { Alepha, createPrimitive } from "alepha";
import { describe, test } from "vitest";
import {
  $pipeline,
  createMiddleware,
  type Middleware,
  PipelinePrimitive,
} from "../primitives/$pipeline.ts";

// -----------------------------------------------------------------------------------------------------------------
// Test helpers — fake middleware factories
// -----------------------------------------------------------------------------------------------------------------

const $log = (label: string): Middleware => {
  return createMiddleware({
    name: "$log",
    options: { label },
    handler: ({ next }) => {
      return async (...args) => {
        calls.push(`${label}:before`);
        const result = await next(...args);
        calls.push(`${label}:after`);
        return result;
      };
    },
  });
};

const $double = (): Middleware => {
  return createMiddleware({
    name: "$double",
    handler: ({ next }) => {
      return async (...args) => {
        const result = await next(...args);
        return result * 2;
      };
    },
  });
};

const $gate = (allowed: boolean): Middleware => {
  return createMiddleware({
    name: "$gate",
    options: { allowed },
    handler: ({ next }) => {
      return async (...args: any[]) => {
        if (!allowed) throw new Error("Blocked");
        return next(...args);
      };
    },
  });
};

const $noMeta = (): Middleware => {
  return <T extends (...args: any[]) => any>(handler: T): T => {
    return (async (...args: any[]) => handler(...args)) as any;
  };
};

let calls: string[] = [];

// -----------------------------------------------------------------------------------------------------------------
// $pipeline — as a Primitive
// -----------------------------------------------------------------------------------------------------------------

describe("$pipeline", () => {
  test("creates a PipelinePrimitive instance", ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      fn = $pipeline({
        use: [$double()],
        handler: async (x: number) => x + 1,
      });
    }

    const svc = alepha.inject(TestService);
    expect(svc.fn).toBeInstanceOf(PipelinePrimitive);
  });

  test("callable applies middleware and returns result", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      fn = $pipeline({
        use: [$double()],
        handler: (x: number) => x + 1,
      });
    }

    const svc = alepha.inject(TestService);
    expect(await svc.fn(5)).toBe(12); // (5 + 1) * 2
  });

  test("execution order: first in array = outermost = runs first", async ({
    expect,
  }) => {
    calls = [];
    const alepha = Alepha.create();

    class TestService {
      fn = $pipeline({
        use: [$log("a"), $log("b"), $log("c")],
        handler: async () => {
          calls.push("handler");
          return "ok";
        },
      });
    }

    const svc = alepha.inject(TestService);
    await svc.fn();
    expect(calls).toEqual([
      "a:before",
      "b:before",
      "c:before",
      "handler",
      "c:after",
      "b:after",
      "a:after",
    ]);
  });

  test("middleware can short-circuit (skip handler)", async ({ expect }) => {
    calls = [];
    const alepha = Alepha.create();

    class TestService {
      fn = $pipeline({
        use: [$gate(false)],
        handler: async () => {
          calls.push("handler");
          return "ok";
        },
      });
    }

    const svc = alepha.inject(TestService);
    await expect(svc.fn()).rejects.toThrowError("Blocked");
    expect(calls).toEqual([]);
  });

  test("middleware can transform return value", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      fn = $pipeline({
        use: [$double()],
        handler: async (x: number) => x + 10,
      });
    }

    const svc = alepha.inject(TestService);
    expect(await svc.fn(5)).toBe(30); // (5 + 10) * 2
  });

  test("multiple pipelines in same class", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      add = $pipeline({
        use: [$double()],
        handler: (x: number) => x + 1,
      });

      multiply = $pipeline({
        use: [$double()],
        handler: (x: number) => x * 3,
      });
    }

    const svc = alepha.inject(TestService);
    expect(await svc.add(5)).toBe(12);
    expect(await svc.multiply(5)).toBe(30);
  });

  test("sync handler with middleware returns Promise at runtime", async ({
    expect,
  }) => {
    const alepha = Alepha.create();

    class TestService {
      fn = $pipeline({
        use: [$double()],
        handler: (x: number) => x + 1,
      });
    }

    const svc = alepha.inject(TestService);
    const result = svc.fn(5);
    expect(result).toBeInstanceOf(Promise);
    expect(await result).toBe(12);
  });

  test("handler can access class instance via closure", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      protected value = 42;

      fn = $pipeline({
        use: [$double()],
        handler: () => this.value,
      });
    }

    const svc = alepha.inject(TestService);
    expect(await svc.fn()).toBe(84); // 42 * 2
  });
});

// -----------------------------------------------------------------------------------------------------------------
// PipelinePrimitive — .middlewares getter
// -----------------------------------------------------------------------------------------------------------------

describe("PipelinePrimitive.middlewares", () => {
  test("returns middleware metadata", ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      fn = $pipeline({
        use: [$log("auth"), $double(), $gate(true)],
        handler: () => 1,
      });
    }

    const svc = alepha.inject(TestService);
    expect(svc.fn.middlewares).toHaveLength(3);
    expect(svc.fn.middlewares.map((m) => m.name)).toEqual([
      "$log",
      "$double",
      "$gate",
    ]);
  });

  test("middleware without metadata returns undefined entry", ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      fn = $pipeline({
        use: [$log("a"), $noMeta(), $double()],
        handler: () => "ok",
      });
    }

    const svc = alepha.inject(TestService);
    expect(svc.fn.middlewares).toHaveLength(3);
    expect(svc.fn.middlewares[0]).toEqual({
      name: "$log",
      options: { label: "a" },
    });
    expect(svc.fn.middlewares[1]).toBeUndefined();
    expect(svc.fn.middlewares[2]).toEqual({ name: "$double" });
  });
});

// -----------------------------------------------------------------------------------------------------------------
// PipelinePrimitive as base class (simulates $action pattern)
// -----------------------------------------------------------------------------------------------------------------

describe("PipelinePrimitive as base class", () => {
  test("host primitive applies use array to handler", async ({ expect }) => {
    calls = [];
    const alepha = Alepha.create();

    class FakeAction extends PipelinePrimitive {
      async invoke(...args: any[]) {
        return this.run(...args);
      }
    }

    class TestController {
      greet = createPrimitive(FakeAction, {
        use: [$log("auth"), $log("rateLimit")],
        handler: (name: string) => {
          calls.push("handler");
          return `Hello ${name}`;
        },
      });
    }

    const ctrl = alepha.inject(TestController);
    const result = await ctrl.greet.invoke("World");

    expect(result).toBe("Hello World");
    expect(calls).toEqual([
      "auth:before",
      "rateLimit:before",
      "handler",
      "rateLimit:after",
      "auth:after",
    ]);
  });

  test("middleware can block handler in host primitive", async ({ expect }) => {
    calls = [];
    const alepha = Alepha.create();

    class FakeAction extends PipelinePrimitive {
      async invoke(...args: any[]) {
        return this.run(...args);
      }
    }

    class TestController {
      secured = createPrimitive(FakeAction, {
        use: [$gate(false)],
        handler: () => {
          calls.push("handler");
          return "secret";
        },
      });
    }

    const ctrl = alepha.inject(TestController);
    await expect(ctrl.secured.invoke()).rejects.toThrowError("Blocked");
    expect(calls).toEqual([]);
  });

  test("middleware metadata available via .middlewares", ({ expect }) => {
    const alepha = Alepha.create();

    class FakeAction extends PipelinePrimitive {}

    class TestController {
      action = createPrimitive(FakeAction, {
        use: [$log("auth"), $double(), $gate(true)],
        handler: () => 1,
      });
    }

    const ctrl = alepha.inject(TestController);
    expect(ctrl.action.middlewares).toHaveLength(3);
    expect(ctrl.action.middlewares.map((m) => m.name)).toEqual([
      "$log",
      "$double",
      "$gate",
    ]);
  });

  test("host primitive without use array works normally", async ({
    expect,
  }) => {
    const alepha = Alepha.create();

    class FakeAction extends PipelinePrimitive {
      async invoke(...args: any[]) {
        return this.run(...args);
      }
    }

    class TestController {
      simple = createPrimitive(FakeAction, {
        handler: (x: number) => x * 2,
      });
    }

    const ctrl = alepha.inject(TestController);
    expect(await ctrl.simple.invoke(7)).toBe(14);
  });
});

// -----------------------------------------------------------------------------------------------------------------
// $pipeline — edge cases
// -----------------------------------------------------------------------------------------------------------------

describe("$pipeline edge cases", () => {
  test("middleware that skips next returns its own value", async ({
    expect,
  }) => {
    const $shortCircuit = (): Middleware => {
      return <T extends (...args: any[]) => any>(_handler: T): T => {
        return (async () => "intercepted") as any;
      };
    };

    const alepha = Alepha.create();
    calls = [];

    class TestService {
      fn = $pipeline({
        use: [$shortCircuit()],
        handler: async () => {
          calls.push("handler");
          return "original";
        },
      });
    }

    const svc = alepha.inject(TestService);
    expect(await svc.fn()).toBe("intercepted");
    expect(calls).toEqual([]);
  });

  test("same middleware used twice works independently", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      fn = $pipeline({
        use: [$double(), $double()],
        handler: async (x: number) => x,
      });
    }

    const svc = alepha.inject(TestService);
    expect(await svc.fn(3)).toBe(12); // 3 * 2 * 2
  });
});

// -----------------------------------------------------------------------------------------------------------------
// createMiddleware — helper
// -----------------------------------------------------------------------------------------------------------------

describe("createMiddleware", () => {
  test("creates middleware with metadata (name only)", ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      fn = $pipeline({
        use: [
          createMiddleware({
            name: "$test",
            handler:
              ({ next }) =>
              async (...args) =>
                next(...args),
          }),
        ],
        handler: () => "ok",
      });
    }

    const svc = alepha.inject(TestService);
    expect(svc.fn.middlewares).toHaveLength(1);
    expect(svc.fn.middlewares[0]).toEqual({ name: "$test" });
  });

  test("creates middleware with metadata (name + options)", ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      fn = $pipeline({
        use: [
          createMiddleware({
            name: "$test",
            options: { ttl: 5000 },
            handler:
              ({ next }) =>
              async (...args) =>
                next(...args),
          }),
        ],
        handler: () => "ok",
      });
    }

    const svc = alepha.inject(TestService);
    expect(svc.fn.middlewares[0]).toEqual({
      name: "$test",
      options: { ttl: 5000 },
    });
  });

  test("provides alepha instance to handler", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      fn = $pipeline({
        use: [
          createMiddleware({
            name: "$test",
            handler: ({ alepha: a }) => {
              expect(a).toBe(alepha);
              return async (...args) => "ok";
            },
          }),
        ],
        handler: () => "ok",
      });
    }

    alepha.inject(TestService);
  });

  test("handler can inject providers via alepha", async ({ expect }) => {
    const alepha = Alepha.create();

    class Counter {
      value = 0;
    }

    class TestService {
      fn = $pipeline({
        use: [
          createMiddleware({
            name: "$counting",
            handler: ({ alepha, next }) => {
              const counter = alepha.inject(Counter);
              return async (...args) => {
                counter.value++;
                return next(...args);
              };
            },
          }),
        ],
        handler: () => "ok",
      });
    }

    const svc = alepha.inject(TestService);
    const counter = alepha.inject(Counter);

    await svc.fn();
    await svc.fn();
    expect(counter.value).toBe(2);
  });

  test("wraps handler correctly", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      fn = $pipeline({
        use: [
          createMiddleware({
            name: "$double",
            handler:
              ({ next }) =>
              async (...args) => {
                const result = await next(...args);
                return result * 2;
              },
          }),
        ],
        handler: (x: number) => x + 1,
      });
    }

    const svc = alepha.inject(TestService);
    expect(await svc.fn(5)).toBe(12); // (5 + 1) * 2
  });
});
