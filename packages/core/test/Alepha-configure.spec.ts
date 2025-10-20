import { describe, expect, it } from "vitest";
import { $inject, Alepha } from "../src";

describe("Alepha#configure", () => {
  it("should configure service options", () => {
    class A {
      options = {
        name: "A",
      };
    }

    class B {
      a = $inject(A);
      getName() {
        return this.a.options.name;
      }
    }

    class C {
      options = {
        x: "C",
      };
    }

    const alepha = Alepha.create();
    const b = alepha.inject(B);
    alepha.configure(A, { name: "B" });
    alepha.configure(C, { x: "B" });

    expect(b.getName()).toBe("B");
    expect(alepha.graph()).toEqual({
      A: {
        from: ["B", "Alepha"],
      },
      B: {
        from: ["Alepha"],
      },
    });
  });

  it("should configure substituted services", () => {
    class Abstract {
      options = {
        name: "Abstract",
      };
    }

    class Impl1 implements Abstract {
      options = {
        name: "Impl1",
      };
    }

    class Impl2 implements Abstract {
      options = {
        name: "Impl2",
      };
    }

    const alepha = Alepha.create().with({ provide: Abstract, use: Impl1 });

    alepha.configure(Impl1, { name: "hey1" });
    alepha.configure(Impl2, { name: "hey2" });

    expect(alepha.inject(Abstract).options.name).toBe("hey1");
    expect(alepha.graph()).toEqual({
      Impl1: { from: ["Alepha"], as: ["Abstract"] },
    });
  });
});
