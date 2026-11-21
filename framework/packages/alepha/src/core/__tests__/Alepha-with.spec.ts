import { Alepha } from "alepha";
import { describe, it } from "vitest";

describe("Alepha#with", () => {
  it("should register the services of a default import", async ({ expect }) => {
    const alepha = Alepha.create();

    alepha.with(await import("./fixtures/A.js"));

    const graph = alepha.graph();

    expect(graph.A).toEqual({
      from: ["Alepha"],
    });
  });
});
