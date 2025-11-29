import { $inject, Alepha } from "alepha";
import { describe, expect, it } from "vitest";

class A {}

class B {}

class C {
  a = $inject(A);
}

class D {
  alepha = $inject(Alepha);
  constructor() {
    if (this.alepha.has(A)) {
      this.alepha.with(B);
    }
  }
}

describe("Alepha#has", () => {
  it("should check if service is registered", () => {
    const container = new Alepha();
    expect(container.has(A)).toBe(false);
    expect(container.has(B)).toBe(false);
    expect(container.has(C)).toBe(false);
    container.with(C);
    expect(container.has(A)).toBe(true);
    expect(container.has(B)).toBe(false);
    expect(container.has(C)).toBe(true);
  });

  it("should check service dependencies", () => {
    const container = new Alepha().with(D);
    expect(container.has(D)).toBe(true);
    expect(container.has(B)).toBe(false);
    const container2 = new Alepha().with(D).with(A);
    expect(container2.has(D)).toBe(true);
    expect(container2.has(B)).toBe(false);
  });
});
