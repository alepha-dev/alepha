import { expect, test } from "vitest";
import { Alepha } from "../../src/core";

test("Alepha#with - from default import", async () => {
  const alepha = Alepha.create();

  alepha.with(await import("./fixtures/A.js"));

  const graph = alepha.graph();

  expect(graph.A).toEqual({
    from: ["Alepha"],
  });
});
