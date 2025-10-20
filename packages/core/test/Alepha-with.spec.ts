import { expect, test } from "vitest";
import { Alepha } from "../src";

test("Alepha#with - from default import", async () => {
  const alepha = Alepha.create();

  alepha.with(await import("./fixtures/A.js"));

  expect(alepha.graph()).toEqual({
    A: {
      from: ["Alepha"],
    },
  });
});

test("Alepha#with - configuration", async () => {
  class A {
    options = {
      name: "default",
    };
    hello() {
      return `Hello, ${this.options.name}`;
    }
  }

  const alepha = Alepha.create();

  alepha.with(A, { name: "Alepha" });

  expect(alepha.inject(A).hello()).toBe("Hello, Alepha");
});
