import { Alepha, createPrimitive, Primitive } from "alepha";
import { describe, test } from "vitest";
import {
  $pipeline,
  createMiddleware,
  type Middleware,
  type MiddlewareMetadata,
} from "./$pipeline.ts";

// -----------------------------------------------------------------------------------------------------------------
// Test helpers — fake middleware factories
// -----------------------------------------------------------------------------------------------------------------

const $log = (label: string): Middleware => {
  const mw: any = <T extends (...args: any[]) => any>(handler: T): T => {
    return (async (...args: any[]) => {
      calls.push(`${label}:before`);
      const result = await handler(...args);
      calls.push(`${label}:after`);
      return result;
    }) as any;
  };
  mw.middleware = {
    name: "$log",
    options: { label },
  } satisfies MiddlewareMetadata;
  return mw;
};

const $double = (): Middleware => {
  const mw: any = <T extends (...args: any[]) => any>(handler: T): T => {
    return (async (...args: any[]) => {
      const result = await handler(...args);
      return result * 2;
    }) as any;
  };
  mw.middleware = { name: "$double" } satisfies MiddlewareMetadata;
  return mw;
};

const $gate = (allowed: boolean): Middleware => {
  const mw: any = <T extends (...args: any[]) => any>(handler: T): T => {
    return (async (...args: any[]) => {
      if (!allowed) throw new Error("Blocked");
      return handler(...args);
    }) as any;
  };
  mw.middleware = {
    name: "$gate",
    options: { allowed },
  } satisfies MiddlewareMetadata;
  return mw;
};

const $noMeta = (): Middleware => {
  return <T extends (...args: any[]) => any>(handler: T): T => {
    return (async (...args: any[]) => handler(...args)) as any;
  };
};

let calls: string[] = [];

// -----------------------------------------------------------------------------------------------------------------
// $pipeline — core behavior
// -----------------------------------------------------------------------------------------------------------------

describe("$pipeline", () => {
  test("no middleware returns handler unchanged", ({ expect }) => {
    const handler = (x: number) => x;
    const result = $pipeline({ handler });
    expect(result).toBe(handler);
  });

  test("empty use array returns handler unchanged", ({ expect }) => {
    const handler = (x: number) => x;
    const result = $pipeline({ use: [], handler });
    expect(result).toBe(handler);
  });

  test("single middleware wraps handler", async ({ expect }) => {
    const fn = $pipeline({
      use: [$double()],
      handler: async (x: number) => x + 1,
    });
    expect(await fn(5)).toBe(12); // (5 + 1) * 2
  });

  test("execution order: first in array = outermost = runs first", async ({
    expect,
  }) => {
    calls = [];
    const fn = $pipeline({
      use: [$log("a"), $log("b"), $log("c")],
      handler: async () => {
        calls.push("handler");
        return "ok";
      },
    });
    await fn();
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
    const fn = $pipeline({
      use: [$gate(false)],
      handler: async () => {
        calls.push("handler");
        return "ok";
      },
    });
    await expect(fn()).rejects.toThrowError("Blocked");
    expect(calls).toEqual([]);
  });

  test("middleware can transform return value", async ({ expect }) => {
    const fn = $pipeline({
      use: [$double()],
      handler: async (x: number) => x + 10,
    });
    expect(await fn(5)).toBe(30); // (5 + 10) * 2
  });

  test("middleware error propagates, handler never called", async ({
    expect,
  }) => {
    calls = [];
    const fn = $pipeline({
      use: [$log("a"), $gate(false), $log("b")],
      handler: async () => {
        calls.push("handler");
        return "ok";
      },
    });
    await expect(fn()).rejects.toThrowError("Blocked");
    expect(calls).toEqual(["a:before"]);
  });

  test("handler error propagates through middleware", async ({ expect }) => {
    calls = [];
    const fn = $pipeline({
      use: [$log("a")],
      handler: async () => {
        calls.push("handler");
        throw new Error("Handler failed");
      },
    });
    await expect(fn()).rejects.toThrowError("Handler failed");
    expect(calls).toEqual(["a:before", "handler"]);
  });

  test("async middleware works", async ({ expect }) => {
    const $delay: Middleware = <T extends (...args: any[]) => any>(
      handler: T,
    ): T => {
      return (async (...args: any[]) => {
        await new Promise((r) => setTimeout(r, 1));
        return handler(...args);
      }) as any;
    };
    const fn = $pipeline({
      use: [$delay],
      handler: async () => "ok",
    });
    expect(await fn()).toBe("ok");
  });

  test("returned function preserves handler signature", ({ expect }) => {
    const fn = $pipeline({
      use: [],
      handler: (a: string, b: number) => `${a}:${b}`,
    });
    expect(fn("hello", 42)).toBe("hello:42");
  });

  test("works with async handlers", async ({ expect }) => {
    const fn = $pipeline({
      use: [$double()],
      handler: async (x: number) => {
        await new Promise((r) => setTimeout(r, 1));
        return x + 1;
      },
    });
    expect(await fn(10)).toBe(22); // (10 + 1) * 2
  });

  test("preserves handler return value through middleware chain", async ({
    expect,
  }) => {
    calls = [];
    const fn = $pipeline({
      use: [$log("a"), $log("b")],
      handler: async () => ({ data: [1, 2, 3] }),
    });
    expect(await fn()).toEqual({ data: [1, 2, 3] });
  });

  test("multiple middleware compose correctly", async ({ expect }) => {
    const fn = $pipeline({
      use: [$double(), $double()],
      handler: async (x: number) => x,
    });
    expect(await fn(3)).toBe(12); // 3 * 2 * 2
  });
});

// -----------------------------------------------------------------------------------------------------------------
// $pipeline — metadata
// -----------------------------------------------------------------------------------------------------------------

describe("$pipeline metadata", () => {
  test("__middlewares is set on wrapped handler", async ({ expect }) => {
    const fn = $pipeline({
      use: [$log("auth"), $double()],
      handler: async () => "ok",
    });
    const meta = (fn as any).__middlewares as MiddlewareMetadata[];
    expect(meta).toHaveLength(2);
    expect(meta[0]).toEqual({ name: "$log", options: { label: "auth" } });
    expect(meta[1]).toEqual({ name: "$double" });
  });

  test("__middlewares preserves order", async ({ expect }) => {
    const fn = $pipeline({
      use: [$gate(true), $log("x"), $double()],
      handler: async () => "ok",
    });
    const meta = (fn as any).__middlewares as MiddlewareMetadata[];
    expect(meta.map((m) => m.name)).toEqual(["$gate", "$log", "$double"]);
  });

  test("middleware without .middleware metadata is filtered out", async ({
    expect,
  }) => {
    const fn = $pipeline({
      use: [$log("a"), $noMeta(), $double()],
      handler: async () => "ok",
    });
    const meta = (fn as any).__middlewares as MiddlewareMetadata[];
    expect(meta).toHaveLength(2);
    expect(meta.map((m) => m.name)).toEqual(["$log", "$double"]);
  });

  test("no metadata when no middleware", ({ expect }) => {
    const handler = () => "ok";
    const fn = $pipeline({ handler });
    expect((fn as any).__middlewares).toBeUndefined();
  });
});

// -----------------------------------------------------------------------------------------------------------------
// $pipeline in DI context
// -----------------------------------------------------------------------------------------------------------------

describe("$pipeline in class context", () => {
  test("works as class field with Alepha.create()", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      transform = $pipeline({
        use: [$double()],
        handler: (x: number) => x + 1,
      });
    }

    const svc = alepha.inject(TestService);
    expect(await svc.transform(5)).toBe(12); // (5 + 1) * 2
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

  test("pipeline with no middleware works as plain handler", ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      greet = $pipeline({
        use: [],
        handler: (name: string) => `Hello ${name}`,
      });
    }

    const svc = alepha.inject(TestService);
    expect(svc.greet("World")).toBe("Hello World");
  });
});

// -----------------------------------------------------------------------------------------------------------------
// Fake host primitive with $pipeline (simulates $action)
// -----------------------------------------------------------------------------------------------------------------

describe("fake host primitive with $pipeline", () => {
  test("host primitive applies use array to handler", async ({ expect }) => {
    calls = [];
    const alepha = Alepha.create();

    class FakeAction extends Primitive<{
      use?: Middleware[];
      handler: (...args: any[]) => any;
    }> {
      protected wrappedHandler = $pipeline({
        use: this.options.use,
        handler: this.options.handler,
      });

      async run(...args: any[]) {
        return this.wrappedHandler(...args);
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
    const result = await ctrl.greet.run("World");

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

    class FakeAction extends Primitive<{
      use?: Middleware[];
      handler: (...args: any[]) => any;
    }> {
      protected wrappedHandler = $pipeline({
        use: this.options.use,
        handler: this.options.handler,
      });

      async run(...args: any[]) {
        return this.wrappedHandler(...args);
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
    await expect(ctrl.secured.run()).rejects.toThrowError("Blocked");
    expect(calls).toEqual([]);
  });

  test("middleware metadata available on wrapped handler", async ({
    expect,
  }) => {
    const alepha = Alepha.create();

    class FakeAction extends Primitive<{
      use?: Middleware[];
      handler: (...args: any[]) => any;
    }> {
      protected wrappedHandler = $pipeline({
        use: this.options.use,
        handler: this.options.handler,
      });
    }

    class TestController {
      action = createPrimitive(FakeAction, {
        use: [$log("auth"), $double(), $gate(true)],
        handler: () => 1,
      });
    }

    const ctrl = alepha.inject(TestController);
    const meta = (ctrl.action as any).wrappedHandler
      .__middlewares as MiddlewareMetadata[];
    expect(meta).toHaveLength(3);
    expect(meta.map((m) => m.name)).toEqual(["$log", "$double", "$gate"]);
  });

  test("host primitive without use array works normally", async ({
    expect,
  }) => {
    const alepha = Alepha.create();

    class FakeAction extends Primitive<{
      use?: Middleware[];
      handler: (...args: any[]) => any;
    }> {
      protected wrappedHandler = $pipeline({
        handler: this.options.handler,
      });

      async run(...args: any[]) {
        return this.wrappedHandler(...args);
      }
    }

    class TestController {
      simple = createPrimitive(FakeAction, {
        handler: (x: number) => x * 2,
      });
    }

    const ctrl = alepha.inject(TestController);
    expect(await ctrl.simple.run(7)).toBe(14);
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
      const mw: any = <T extends (...args: any[]) => any>(_handler: T): T => {
        return (async () => "intercepted") as any;
      };
      mw.middleware = { name: "$shortCircuit" } satisfies MiddlewareMetadata;
      return mw;
    };

    calls = [];
    const fn = $pipeline({
      use: [$shortCircuit()],
      handler: async () => {
        calls.push("handler");
        return "original";
      },
    });

    expect(await fn()).toBe("intercepted");
    expect(calls).toEqual([]);
  });

  test("sync handler with middleware returns Promise at runtime", async ({
    expect,
  }) => {
    const fn = $pipeline({
      use: [$double()],
      handler: (x: number) => x + 1,
    });

    const result = fn(5);
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
    const meta = (svc.fn as any).__middlewares as MiddlewareMetadata[];
    expect(meta).toHaveLength(1);
    expect(meta[0]).toEqual({ name: "$test" });
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
    const meta = (svc.fn as any).__middlewares as MiddlewareMetadata[];
    expect(meta[0]).toEqual({ name: "$test", options: { ttl: 5000 } });
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
