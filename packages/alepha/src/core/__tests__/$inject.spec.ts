import {
  $context,
  $env,
  $inject,
  Alepha,
  CircularDependencyError,
  SchemaValidationError,
  type Service,
  z,
} from "alepha";
import { describe, expect, it } from "vitest";
import { MissingContextError } from "../errors/MissingContextError.ts";

describe("$inject", () => {
  it("should inject dependencies correctly", () => {
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

  it("should throw error when missing context", () => {
    class A {}

    class B {
      a = $inject(A);
    }

    expect(() => new B()).toThrow(MissingContextError);
  });
});

describe("$env", () => {
  it("should inject environment variables correctly", () => {
    class A {
      env = $env(
        z.object({
          N1: z.text(),
          N2: z.text({ default: "$N1" }),
        }),
      );
    }

    class B {
      a = $inject(A);
    }

    class C {
      b = $inject(B);
    }

    expect(
      Alepha.create({ env: { N1: "abc" } }).inject(C).b.a.env,
    ).toStrictEqual({
      N1: "abc",
      N2: "abc",
    });

    expect(
      Alepha.create({ env: { N1: "abc", N2: "efg" } }).inject(C).b.a.env,
    ).toStrictEqual({
      N1: "abc",
      N2: "efg",
    });

    expect(() => Alepha.create().inject(C)).toThrow(SchemaValidationError);
  });
});

describe("$inject - circular dependencies", () => {
  it("should detect circular dependencies", () => {
    const superInject = (type: Service) => {
      const { alepha } = $context();
      alepha.inject(Module); // <- trying to "#get" during a tree walk is bad

      // consider using "#register" instead
      // register check if the type is already registered (or pending) before calling #get

      return alepha.inject(type);
    };

    class A {}

    class Module {
      a = superInject(A);
    }

    class Test {
      hi = superInject(A);
    }

    expect(() => Alepha.create().inject(Test)).toThrow(
      new CircularDependencyError("Module", ["Test"]),
    );
  });

  it("should fix circular dependencies with proper registration", () => {
    const superInject = <T extends object>(type: Service<T>): T => {
      const { alepha } = $context();
      alepha.with(Module); // <- replace .get by .with to fix circular dependency
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
  it("should handle class inheritance correctly", () => {
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
