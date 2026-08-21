import { Alepha, type State } from "alepha";
import { describe, expect, it } from "vitest";

import { AlephaError } from "../errors/AlephaError.ts";
import { $atom } from "../primitives/$atom.ts";
import { $store } from "../primitives/$store.ts";
import { z } from "../providers/ZodProvider.ts";

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
    count = $store(count);
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

describe("$atom: serverOnly + persist is a contradiction", () => {
  it("throws AlephaError when combined with persist: cookie", () => {
    expect(() =>
      $atom({
        name: "test.extras.serverOnlyCookie",
        schema: z.object({ token: z.string() }),
        default: { token: "" },
        serverOnly: true,
        persist: "cookie",
      }),
    ).toThrow(AlephaError);
  });

  it("throws AlephaError when combined with persist: localStorage", () => {
    expect(() =>
      $atom({
        name: "test.extras.serverOnlyLocalStorage",
        schema: z.object({ token: z.string() }),
        default: { token: "" },
        serverOnly: true,
        persist: "localStorage",
      }),
    ).toThrow(AlephaError);
  });

  it("does not throw when only serverOnly is set", () => {
    expect(() =>
      $atom({
        name: "test.extras.serverOnlyAlone",
        schema: z.object({ token: z.string() }),
        default: { token: "" },
        serverOnly: true,
      }),
    ).not.toThrow();
  });

  it("does not throw when only persist is set", () => {
    expect(() =>
      $atom({
        name: "test.extras.persistAlone",
        schema: z.object({ token: z.string() }),
        default: { token: "" },
        persist: "cookie",
      }),
    ).not.toThrow();
  });
});
