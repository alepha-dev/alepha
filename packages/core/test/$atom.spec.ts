import { describe, expect, it } from "vitest";
import { Alepha, type State } from "../src";
import { $atom } from "../src/descriptors/$atom.ts";
import { $use } from "../src/descriptors/$use.ts";
import { t } from "../src/providers/TypeProvider.ts";

describe("$atom", () => {
  const count = $atom({
    name: "count",
    schema: t.object({
      value: t.number(),
    }),
    default: {
      value: 0,
    },
  });

  class App {
    count = $use(count);
  }

  it("should be get/set with state manager", () => {
    const alepha = Alepha.create();

    expect(alepha.state.get(count).value).toBe(0);

    alepha.state.set(count, { value: 42 });
    expect(alepha.state.get(count).value).toBe(42);
  });

  it("should create virtual getter", () => {
    const alepha = Alepha.create();
    const app = alepha.inject(App);

    expect(app.count.value).toBe(0);

    alepha.state.set(count, { value: 42 });
    expect(app.count.value).toBe(42);

    alepha.state.set("count" as keyof State, { value: 23 });
    expect(app.count.value).toBe(23);
  });
});
