import { describe, expect, it } from "vitest";
import { Alepha } from "../../src/core/Alepha.ts";
import { KIND } from "../../src/core/constants/KIND.ts";
import {
  createDescriptor,
  Descriptor,
} from "../../src/core/helpers/descriptor.ts";

describe("descriptor", () => {
  it("should create custom descriptors with key and identity methods", () => {
    class MyDescriptor extends Descriptor<{ name?: string }> {
      key() {
        return this.options.name ?? this.config.propertyKey;
      }
      identity() {
        return `${this.config.service.name}:${this.key()}`;
      }
    }

    const $my = (options: { name?: string } = {}) =>
      createDescriptor(MyDescriptor, options);

    $my[KIND] = MyDescriptor;

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
