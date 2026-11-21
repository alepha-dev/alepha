import {
  $context,
  $inject,
  Alepha,
  CircularDependencyError,
  type Service,
} from "alepha";
import { describe, it } from "vitest";

import { MissingContextError } from "../errors/MissingContextError.ts";

describe("$inject", () => {
  it("should inject dependencies correctly", ({ expect }) => {
    class A {
      hello = "world";
    }

    class B {
      a = $inject(A);
    }

    class C {
      b = $inject(B);
      a = $inject(A);
    }

    const ctx = new Alepha();
    const c1 = ctx.inject(C);
    expect(c1.b.a.hello).toBe("world");

    const c2 = ctx.inject(C);
    c2.b.a.hello = "test";

    expect(c1.b.a.hello).toBe("test");
    expect(c2.b.a.hello).toBe("test");
    expect(c2.a.hello).toBe("test");
  });

  it("should throw error when missing context", ({ expect }) => {
    class A {}

    class B {
      a = $inject(A);
    }

    expect(() => new B()).toThrow(MissingContextError);
  });
});

describe("$inject - circular dependencies", () => {
  it("should detect circular dependencies", ({ expect }) => {
    const superInject = (type: Service) => {
      const { alepha } = $context();
      alepha.inject(Module); // <- injecting during a tree walk is bad

      // `with` is the fix: it checks whether the type is already registered
      // (or pending) before it injects

      return alepha.inject(type);
    };

    class A {}

    class Module {
      a = superInject(A);
    }

    class Test {
      hi = superInject(A);
    }

    // The reported chain is the cycle itself (from the repeated service
    // onward), not the callers above it: Module re-enters Module.
    expect(() => Alepha.create().inject(Test)).toThrow(
      new CircularDependencyError({ provider: "Module", parents: ["Module"] }),
    );
  });

  it("should fix circular dependencies with proper registration", ({
    expect,
  }) => {
    const superInject = <T extends object>(type: Service<T>): T => {
      const { alepha } = $context();
      alepha.with(Module); // <- `with` in place of `inject` avoids the circular dependency
      return alepha.inject(type);
    };

    class A {
      hello = "world";
    }

    class Module {
      a = superInject(A);
    }

    class Test {
      hi = superInject(A);
    }

    expect(Alepha.create().inject(Test).hi.hello).toBe("world");
  });
});

describe("$inject - inheritance", () => {
  it("should handle class inheritance correctly", ({ expect }) => {
    const logs: string[] = [];
    class P1 {
      constructor() {
        logs.push("P1");
      }
    }
    class P2 {
      constructor() {
        logs.push("P2");
      }
    }

    class R1 {
      p1 = $inject(P1);
    }

    class R2 extends R1 {}

    class R3 extends R1 {
      p2 = $inject(P2);
    }

    const ctx = Alepha.create();

    const r2 = ctx.inject(R2);
    expect(r2.p1).toBeInstanceOf(P1);
    expect(logs).toEqual(["P1"]);

    const r3 = ctx.inject(R3);
    expect(r3.p2).toBeInstanceOf(P2);

    // just be to ensure that P1 is not created again (because R3 extends R1)
    expect(logs).toEqual(["P1", "P2"]);
  });
});

describe("$inject - throwing constructors", () => {
  it("should report the original error on every retry, not a phantom cycle", ({
    expect,
  }) => {
    class Boom {
      constructor() {
        throw new Error("boom-original");
      }
    }

    const alepha = new Alepha();
    expect(() => alepha.inject(Boom)).toThrow("boom-original");
    // Before the finally-guard in Alepha.new(), Boom stayed in the pending
    // stack and this retry threw CircularDependencyError instead.
    expect(() => alepha.inject(Boom)).toThrow("boom-original");
  });

  it("should restore the $context cursor after a constructor throws", ({
    expect,
  }) => {
    class Boom {
      constructor() {
        throw new Error("boom");
      }
    }

    const alepha = new Alepha();
    expect(() => alepha.inject(Boom)).toThrow("boom");
    expect(() => $context()).toThrow(MissingContextError);
  });

  it("should keep injecting other services after a failed instantiation", ({
    expect,
  }) => {
    class Boom {
      constructor() {
        throw new Error("boom");
      }
    }
    class Fine {
      value = "ok";
    }

    const alepha = new Alepha();
    expect(() => alepha.inject(Boom)).toThrow("boom");
    expect(alepha.inject(Fine).value).toBe("ok");
  });
});

describe("$inject - circular dependency reporting", () => {
  it("should report the full cycle path in the error message", ({ expect }) => {
    class A {
      b = $inject(B);
    }
    class B {
      c = $inject(C);
    }
    class C {
      a = $inject(A);
    }

    const alepha = new Alepha();
    let message = "";
    try {
      alepha.inject(A);
    } catch (error) {
      expect(error).toBeInstanceOf(CircularDependencyError);
      message = (error as Error).message;
    }
    expect(message).toContain("A -> B -> C -> A");
  });
});
