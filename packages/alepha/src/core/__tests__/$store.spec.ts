import { describe, expect, it } from "vitest";
import { Alepha } from "../Alepha.ts";
import { $atom } from "../primitives/$atom.ts";
import { $computed } from "../primitives/$computed.ts";
import { $store } from "../primitives/$store.ts";
import { z } from "../providers/ZodProvider.ts";

describe("$store", () => {
  const cart = $atom({
    name: "test.store.cart",
    schema: z.object({
      items: z.array(z.object({ price: z.number() })),
    }),
    default: { items: [] },
  });

  const total = $computed({
    name: "test.store.total",
    deps: [cart],
    get: (c) => c.items.reduce((sum, it) => sum + it.price, 0),
  });

  describe("with an atom", () => {
    class App {
      cart = $store(cart);
    }

    it("should expose the current value", () => {
      const alepha = Alepha.create();
      const app = alepha.inject(App);

      expect(app.cart.items).toEqual([]);
    });

    it("should re-read on every access", () => {
      const alepha = Alepha.create();
      const app = alepha.inject(App);

      alepha.store.set(cart, { items: [{ price: 10 }] });

      expect(app.cart.items).toEqual([{ price: 10 }]);
    });
  });

  describe("with a computed", () => {
    class App {
      total = $store(total);
    }

    it("should derive the value from its dependencies", () => {
      const alepha = Alepha.create();
      const app = alepha.inject(App);

      expect(app.total).toBe(0);
    });

    /**
     * The reason the marker carries the target object rather than its key: a
     * computed has a `key` but no store entry under it, so a key-based lookup
     * would read `undefined` instead of deriving.
     */
    it("should re-derive when a dependency changes", () => {
      const alepha = Alepha.create();
      const app = alepha.inject(App);

      alepha.store.set(cart, { items: [{ price: 10 }, { price: 5 }] });

      expect(app.total).toBe(15);
    });

    it("should not register the computed as an atom", () => {
      const alepha = Alepha.create();
      alepha.inject(App);

      // A computed is derived on every read, never stored. Registering one
      // throws by design — reaching this point proves `$store` skipped it.
      expect(alepha.store.get(total)).toBe(0);
    });
  });
});
