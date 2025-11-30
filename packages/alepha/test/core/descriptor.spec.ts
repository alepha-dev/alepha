import { describe, expect, it } from "vitest";
import { Alepha } from "../../src/core/Alepha.ts";
import { KIND } from "../../src/core/constants/KIND.ts";
import {
  createPrimitive,
  Primitive,
} from "../../src/core/helpers/primitive.ts";

describe("primitive", () => {
  it("should create custom primitives with key and identity methods", () => {
    class MyPrimitive extends Primitive<{ name?: string }> {
      key() {
        return this.options.name ?? this.config.propertyKey;
      }
      identity() {
        return `${this.config.service.name}:${this.key()}`;
      }
    }

    const $my = (options: { name?: string } = {}) =>
      createPrimitive(MyPrimitive, options);

    $my[KIND] = MyPrimitive;

    class TestApp {
      h1 = $my();
      h2 = $my({ name: "hello" });
    }

    const alepha = Alepha.create();
    const app = alepha.inject(TestApp);

    expect(app.h1.key()).toBe("h1");
    expect(app.h2.key()).toBe("hello");
    expect(app.h2.identity()).toBe("TestApp:hello");
  });
});
