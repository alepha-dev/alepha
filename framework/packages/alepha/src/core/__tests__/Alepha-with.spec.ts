import { Alepha } from "alepha";
import { describe, expect, it } from "vitest";

describe("Alepha#with", () => {
  it("should register the services of a default import", async () => {
    const alepha = Alepha.create();

    alepha.with(await import("./fixtures/A.js"));

    const graph = alepha.graph();

    expect(graph.A).toEqual({
      from: ["Alepha"],
    });
  });
});
