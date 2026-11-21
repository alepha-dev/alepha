import { Alepha, createPrimitive } from "alepha";
import { describe, it } from "vitest";

import {
  $pipeline,
  createMiddleware,
  type Middleware,
  PipelinePrimitive,
} from "../primitives/$pipeline.ts";

// -----------------------------------------------------------------------------------------------------------------
// Test helpers: fake middleware factories
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
// $pipeline as a Primitive
// -----------------------------------------------------------------------------------------------------------------

describe("$pipeline", () => {
  it("creates a PipelinePrimitive instance", ({ expect }) => {
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

  it("callable applies middleware and returns result", async ({ expect }) => {
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

  it("execution order: first in array = outermost = runs first", async ({
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

  it("middleware can short-circuit (skip handler)", async ({ expect }) => {
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
    await expect(svc.fn()).rejects.toThrow("Blocked");
    expect(calls).toEqual([]);
  });

  it("middleware can transform return value", async ({ expect }) => {
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

  it("multiple pipelines in same class", async ({ expect }) => {
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

  it("handler can access class instance via closure", async ({ expect }) => {
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
// PipelinePrimitive: .middlewares getter
// -----------------------------------------------------------------------------------------------------------------

describe("PipelinePrimitive.middlewares", () => {
  it("returns middleware metadata", ({ expect }) => {
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

  it("middleware without metadata returns undefined entry", ({ expect }) => {
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
  it("host primitive applies use array to handler", async ({ expect }) => {
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

  it("middleware can block handler in host primitive", async ({ expect }) => {
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
    await expect(ctrl.secured.invoke()).rejects.toThrow("Blocked");
    expect(calls).toEqual([]);
  });

  it("host primitive without use array works normally", async ({ expect }) => {
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
// $pipeline: edge cases
// -----------------------------------------------------------------------------------------------------------------

describe("$pipeline edge cases", () => {
  it("middleware that skips next returns its own value", async ({ expect }) => {
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

  it("same middleware used twice works independently", async ({ expect }) => {
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
// createMiddleware helper
// -----------------------------------------------------------------------------------------------------------------

describe("createMiddleware", () => {
  it("creates middleware with metadata (name only)", ({ expect }) => {
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

  it("creates middleware with metadata (name + options)", ({ expect }) => {
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

  it("provides alepha instance to handler", async ({ expect }) => {
    const alepha = Alepha.create();
    const seen: Alepha[] = [];

    class TestService {
      fn = $pipeline({
        use: [
          createMiddleware({
            name: "$test",
            handler: ({ alepha: a, next }) => {
              seen.push(a);
              return next;
            },
          }),
        ],
        handler: () => "ok",
      });
    }

    // Middlewares are applied on the first run, not when the service is built.
    expect(await alepha.inject(TestService).fn()).toBe("ok");
    expect(seen).toEqual([alepha]);
  });

  it("handler can inject providers via alepha", async ({ expect }) => {
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
});
