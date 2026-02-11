import { Alepha, createPrimitive, Primitive } from "alepha";
import { describe, test } from "vitest";
import {
  $pipeline,
  type Middleware,
  type MiddlewareMetadata,
} from "./$pipeline.ts";
import { $scope } from "./$scope.ts";

// -----------------------------------------------------------------------------------------------------------------
// $scope — core behavior
// -----------------------------------------------------------------------------------------------------------------

describe("$scope", () => {
  test("wraps handler in ALS context", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      scoped = $pipeline({
        use: [$scope()],
        handler: async () => {
          alepha.context.set("test-key", "test-value");
          return alepha.context.get<string>("test-key");
        },
      });
    }

    const svc = alepha.inject(TestService);
    const result = await svc.scoped();
    expect(result).toBe("test-value");
  });

  test("scope is isolated per invocation", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      scoped = $pipeline({
        use: [$scope()],
        handler: async (value: string) => {
          alepha.context.set("key", value);
          return alepha.context.get<string>("key");
        },
      });
    }

    const svc = alepha.inject(TestService);
    const [a, b] = await Promise.all([
      svc.scoped("first"),
      svc.scoped("second"),
    ]);
    expect(a).toBe("first");
    expect(b).toBe("second");
  });

  test("throws when already inside a scope", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      scoped = $pipeline({
        use: [$scope()],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);

    // Wrap in an existing ALS context to simulate $action behavior
    await alepha.context.run(async () => {
      await expect(svc.scoped()).rejects.toThrowError(
        "$scope: already inside a scope",
      );
    });
  });

  test("throws with helpful message mentioning host primitives", async ({
    expect,
  }) => {
    const alepha = Alepha.create();

    class TestService {
      scoped = $pipeline({
        use: [$scope()],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);

    await alepha.context.run(async () => {
      await expect(svc.scoped()).rejects.toThrowError(
        /host primitives.*\$action.*\$job.*\$page.*include \$scope by default/,
      );
    });
  });

  test("handler return value is preserved", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      scoped = $pipeline({
        use: [$scope()],
        handler: async () => ({ data: [1, 2, 3] }),
      });
    }

    const svc = alepha.inject(TestService);
    expect(await svc.scoped()).toEqual({ data: [1, 2, 3] });
  });

  test("handler errors propagate through scope", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      scoped = $pipeline({
        use: [$scope()],
        handler: async () => {
          throw new Error("Handler failed");
        },
      });
    }

    const svc = alepha.inject(TestService);
    await expect(svc.scoped()).rejects.toThrowError("Handler failed");
  });

  test("handler arguments are passed through", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      scoped = $pipeline({
        use: [$scope()],
        handler: async (a: number, b: number) => a + b,
      });
    }

    const svc = alepha.inject(TestService);
    expect(await svc.scoped(3, 4)).toBe(7);
  });
});

// -----------------------------------------------------------------------------------------------------------------
// $scope — edge cases
// -----------------------------------------------------------------------------------------------------------------

describe("$scope edge cases", () => {
  test("double $scope in same pipeline throws on invocation", async ({
    expect,
  }) => {
    const alepha = Alepha.create();

    class TestService {
      scoped = $pipeline({
        use: [$scope(), $scope()],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);
    // Outer $scope creates context, inner $scope detects it and throws
    await expect(svc.scoped()).rejects.toThrowError(
      "$scope: already inside a scope",
    );
  });

  test("scope does not leak state to outer context", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      scoped = $pipeline({
        use: [$scope()],
        handler: async () => {
          alepha.context.set("leaked", "secret");
          return "ok";
        },
      });
    }

    const svc = alepha.inject(TestService);
    await svc.scoped();
    // Outside the scope, context should not exist
    expect(alepha.context.exists()).toBe(false);
  });

  test("works with sync handler", async ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      scoped = $pipeline({
        use: [$scope()],
        handler: (x: number) => x * 2,
      });
    }

    const svc = alepha.inject(TestService);
    expect(await svc.scoped(5)).toBe(10);
  });
});

// -----------------------------------------------------------------------------------------------------------------
// $scope — metadata
// -----------------------------------------------------------------------------------------------------------------

describe("$scope metadata", () => {
  test("has middleware metadata", ({ expect }) => {
    const alepha = Alepha.create();

    class TestService {
      scoped = $pipeline({
        use: [$scope()],
        handler: async () => "ok",
      });
    }

    const svc = alepha.inject(TestService);
    const meta = (svc.scoped as any).__middlewares as MiddlewareMetadata[];
    expect(meta).toHaveLength(1);
    expect(meta[0]).toEqual({ name: "$scope" });
  });
});

// -----------------------------------------------------------------------------------------------------------------
// $scope — composition with other middleware
// -----------------------------------------------------------------------------------------------------------------

describe("$scope composition", () => {
  test("composes with other middleware in pipeline", async ({ expect }) => {
    const calls: string[] = [];
    const alepha = Alepha.create();

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

    class TestService {
      scoped = $pipeline({
        use: [$scope(), $log("inner")],
        handler: async () => {
          calls.push("handler");
          return "ok";
        },
      });
    }

    const svc = alepha.inject(TestService);
    await svc.scoped();

    expect(calls).toEqual(["inner:before", "handler", "inner:after"]);
  });

  test("context is available to inner middleware", async ({ expect }) => {
    const alepha = Alepha.create();

    const $setKey: Middleware = <T extends (...args: any[]) => any>(
      handler: T,
    ): T => {
      return (async (...args: any[]) => {
        alepha.context.set("injected", "by-middleware");
        return handler(...args);
      }) as any;
    };

    class TestService {
      scoped = $pipeline({
        use: [$scope(), $setKey],
        handler: async () => {
          return alepha.context.get<string>("injected");
        },
      });
    }

    const svc = alepha.inject(TestService);
    const result = await svc.scoped();
    expect(result).toBe("by-middleware");
  });

  test("works inside fake host primitive", async ({ expect }) => {
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
      action = createPrimitive(FakeAction, {
        use: [$scope()],
        handler: async (key: string, value: string) => {
          alepha.context.set(key, value);
          return alepha.context.get<string>(key);
        },
      });
    }

    const ctrl = alepha.inject(TestController);
    const result = await ctrl.action.run("hello", "world");
    expect(result).toBe("world");
  });
});
