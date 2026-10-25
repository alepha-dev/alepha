import { AsyncLocalStorage } from "node:async_hooks";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Alepha } from "../Alepha.ts";
import { AlephaError } from "../errors/AlephaError.ts";
import { $atom } from "../primitives/$atom.ts";
import { $computed } from "../primitives/$computed.ts";
import { AlsProvider } from "../providers/AlsProvider.ts";
import { z } from "../providers/ZodProvider.ts";

describe("$computed", () => {
  const cart = $atom({
    name: "test.computed.cart",
    schema: z.object({
      items: z.array(z.object({ price: z.number(), qty: z.number() })),
    }),
    default: { items: [] },
  });

  const total = $computed({
    name: "test.computed.total",
    deps: [cart],
    get: (c) => c.items.reduce((sum, item) => sum + item.price * item.qty, 0),
  });

  const doubled = $computed({
    name: "test.computed.doubled",
    deps: [total],
    get: (t) => t * 2,
  });

  it("computes from dependency defaults", () => {
    const alepha = Alepha.create();
    expect(alepha.store.get(total)).toBe(0);
  });

  it("reflects dependency mutations", () => {
    const alepha = Alepha.create();
    alepha.store.set(cart, { items: [{ price: 10, qty: 2 }] });
    expect(alepha.store.get(total)).toBe(20);
  });

  it("supports computed-on-computed", () => {
    const alepha = Alepha.create();
    alepha.store.set(cart, { items: [{ price: 5, qty: 1 }] });
    expect(alepha.store.get(doubled)).toBe(10);
  });

  it("lists transitive dependency keys", () => {
    expect(doubled.keys()).toEqual(["test.computed.cart"]);
  });

  it("cannot be set", () => {
    const alepha = Alepha.create();
    expect(() => alepha.store.set(total as any, 5)).toThrow(AlephaError);
  });

  it("is never exported for hydration", () => {
    const alepha = Alepha.create();
    alepha.store.get(total);
    expect(Object.keys(alepha.store.exportAtoms())).not.toContain(
      "test.computed.total",
    );
  });

  it("is readable through alepha.get", () => {
    const alepha = Alepha.create();
    alepha.store.set(cart, { items: [{ price: 3, qty: 3 }] });
    expect(alepha.get(total)).toBe(9);
  });

  // "Keeps ALS fork-scoped deps correct for free" is the stated design
  // rationale for $computed's no-cache decision (see this file's brief and
  // $computed.ts's JSDoc) — exercise it directly instead of trusting code
  // inspection. `AlsProvider.create` defaults to a no-op (`fork()` becomes a
  // plain function call); swap in a real `AsyncLocalStorage` for this block
  // only, mirroring `fork.spec.ts`.
  describe("inside a fork", () => {
    const originalAlsCreate = AlsProvider.create;

    beforeAll(() => {
      AlsProvider.create = () => new AsyncLocalStorage();
    });

    afterAll(() => {
      AlsProvider.create = originalAlsCreate;
    });

    it("resolves a dependency from the fork's own value, not the app store's", () => {
      const alepha = new Alepha();
      alepha.store.set(cart, { items: [{ price: 10, qty: 1 }] });
      expect(alepha.store.get(total)).toBe(10);

      alepha.fork(() => {
        alepha.store.set(cart, { items: [{ price: 2, qty: 3 }] });
        expect(alepha.store.get(total)).toBe(6);
      });

      // The fork-scoped mutation must not leak back into the app-level store.
      expect(alepha.store.get(total)).toBe(10);
    });
  });

  describe("circular dependencies", () => {
    it("throws AlephaError instead of overflowing the stack", () => {
      const cycleA = $computed({
        name: "test.computed.cycleA",
        deps: [],
        get: () => 0,
      });
      const cycleB = $computed({
        name: "test.computed.cycleB",
        deps: [cycleA],
        get: (v: number) => v + 1,
      });

      // `deps` is `readonly` only at the type level — nothing stops a
      // caller from mutating the underlying array at runtime and building a
      // genuine cycle. That's exactly what this test does to exercise the
      // guard; there is no supported public API to construct a cycle any
      // other way.
      (cycleA.options.deps as unknown[]).push(cycleB);

      expect(() => cycleA.keys()).toThrow(AlephaError);

      const alepha = Alepha.create();
      expect(() => alepha.store.get(cycleA)).toThrow(AlephaError);
    });
  });
});
