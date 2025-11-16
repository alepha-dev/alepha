import { describe, expect, it } from "vitest";
import { $inject, Alepha, TooLateSubstitutionError } from "../../src/core";

describe("Alepha#with", () => {
  it("should allow substitution", () => {
    class A {
      value = "a";
    }

    class M {
      a = $inject(A);
    }

    expect(
      Alepha.create()
        .with({
          provide: A,
          use: class extends A {
            value = "z";
          },
        })
        .inject(M).a.value,
    ).toBe("z");
  });

  class A {
    a = "a";
  }

  class B {
    a = "b";
  }

  class C {
    a = "c";
  }

  class M {
    a = $inject(A);
  }

  it("should allow optional substitution", () => {
    const T1 = Alepha.create().with(M);
    expect(T1.inject(M).a.a).toBe("a");

    const T2 = Alepha.create().with({
      provide: A,
      use: B,
    });
    expect(T2.inject(M).a.a).toBe("b");

    const T3 = Alepha.create();
    T3.with({
      provide: A,
      use: C,
      optional: true,
    });
    expect(T3.inject(M).a.a).toBe("c");

    const T4 = Alepha.create();
    T4.with(M);
    T4.with({
      provide: A,
      use: C,
      optional: true,
    });
    expect(T1.inject(M).a.a).toBe("a");
  });

  it("should reject substitution of already registered service", () => {
    const T5 = Alepha.create();
    T5.with(M);
    expect(() =>
      T5.with({
        provide: A,
        use: C,
        optional: false, // should throw, because the default is already set
      }),
    ).toThrow(TooLateSubstitutionError);
  });
});
