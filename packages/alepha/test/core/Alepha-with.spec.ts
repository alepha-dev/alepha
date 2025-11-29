import { Alepha } from "alepha";
import { expect, test } from "vitest";

test("Alepha#with - from default import", async () => {
  const alepha = Alepha.create();

  alepha.with(await import("./fixtures/A.js"));

  const graph = alepha.graph();

  expect(graph.A).toEqual({
    from: ["Alepha"],
  });
});
