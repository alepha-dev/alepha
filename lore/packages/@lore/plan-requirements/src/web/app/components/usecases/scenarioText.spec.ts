import { describe, it } from "vitest";

import { scenarioToText, textToScenario } from "./scenarioText.ts";

/**
 * The use case form edits the scenario as text (#E153): what it writes it
 * must read back, keys and methods included.
 */
describe("scenarioText", () => {
  const useCase = {
    actors: [
      { personaId: 10, number: 2, name: "Léa", role: "primary" as const },
    ],
    steps: [
      { id: 1, position: 1, actorPersonaId: 10, text: "Opens the basket" },
      { id: 2, position: 2, text: "The shop computes the total" },
    ],
    alternatives: [{ id: 1, key: "2a", text: "Expired code" }],
    criteria: [
      {
        id: 1,
        key: "C2",
        position: 1,
        givenText: "a basket",
        whenText: "she pays",
        thenText: "an order exists",
        method: "e2e" as const,
      },
      {
        id: 2,
        key: "C5",
        position: 2,
        text: "A receipt is mailed",
        method: "manual" as const,
        alternativeKey: "2a",
      },
    ],
  };

  it("reads back what it writes", ({ expect }) => {
    const text = scenarioToText(useCase);
    expect(text.steps).toBe(
      "A2: Opens the basket\nThe shop computes the total",
    );
    const back = textToScenario(text, new Map([[2, 10]]));

    expect(back.steps).toEqual([
      { actorPersonaId: 10, text: "Opens the basket" },
      { text: "The shop computes the total" },
    ]);
    expect(back.alternatives).toEqual([{ key: "2a", text: "Expired code" }]);
    expect(back.criteria).toEqual([
      {
        key: "C2",
        givenText: "a basket",
        whenText: "she pays",
        thenText: "an order exists",
        method: "e2e",
      },
      {
        key: "C5",
        text: "A receipt is mailed",
        method: "manual",
        alternativeKey: "2a",
      },
    ]);
  });

  it("takes a block with no header as a new criterion", ({ expect }) => {
    const back = textToScenario(
      {
        steps: "",
        alternatives: "",
        criteria: "Given a code\nWhen it expires\nThen it is refused",
      },
      new Map(),
    );
    expect(back.criteria).toEqual([
      {
        givenText: "a code",
        whenText: "it expires",
        thenText: "it is refused",
      },
    ]);
  });
});
