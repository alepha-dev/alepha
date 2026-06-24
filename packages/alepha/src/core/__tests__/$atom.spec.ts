import { Alepha, type State } from "alepha";
import { describe, expect, it } from "vitest";
import { $atom } from "../primitives/$atom.ts";
import { $state } from "../primitives/$state.ts";
import { z } from "../providers/TypeProvider.ts";

describe("$atom", () => {
  const count = $atom({
    name: "count",
    schema: z.object({
      value: z.number(),
    }),
    default: {
      value: 0,
    },
  });

  class App {
    count = $state(count);
  }

  it("should be get/set with state manager", () => {
    const alepha = Alepha.create();

    expect(alepha.store.get(count).value).toBe(0);

    alepha.store.set(count, { value: 42 });
    expect(alepha.store.get(count).value).toBe(42);
  });

  it("should create virtual getter", () => {
    const alepha = Alepha.create();
    const app = alepha.inject(App);

    expect(app.count.value).toBe(0);

    alepha.store.set(count, { value: 42 });
    expect(app.count.value).toBe(42);

    alepha.store.set("count" as keyof State, { value: 23 });
    expect(app.count.value).toBe(23);
  });
});
