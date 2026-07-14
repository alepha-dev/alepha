import { describe, expect, it } from "vitest";
import { Alepha } from "../Alepha.ts";
import { AlephaError } from "../errors/AlephaError.ts";
import { $atom } from "../primitives/$atom.ts";
import { $computed } from "../primitives/$computed.ts";
import { z } from "../providers/TypeProvider.ts";

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
});
