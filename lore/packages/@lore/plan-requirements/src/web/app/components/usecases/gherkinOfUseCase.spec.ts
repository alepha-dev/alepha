import { describe, it } from "vitest";

import type { UseCaseResource } from "../../../../api/schemas/useCaseResourceSchema.ts";
import { gherkinOfUseCase } from "./gherkinOfUseCase.ts";

/**
 * Export as Gherkin (#E153, #Q3767).
 */
describe("gherkinOfUseCase", () => {
  it("writes the use case as a feature, one scenario per criterion", ({
    expect,
  }) => {
    const feature = gherkinOfUseCase({
      number: 7,
      title: "Create a promo code",
      actors: [{ personaId: 1, number: 2, name: "Léa", role: "primary" }],
      steps: [{ id: 1, position: 1, text: "Opens Promotions" }],
      criteria: [
        {
          id: 1,
          key: "C1",
          position: 1,
          givenText: "an active product",
          whenText: "Léa creates a code",
          thenText: "it is listed",
          method: "e2e",
        },
        {
          id: 2,
          key: "C3",
          position: 2,
          text: "It is refused",
          method: "manual",
          alternativeKey: "4a",
        },
      ],
    } as unknown as UseCaseResource);

    expect(feature).toBe(
      [
        "@U7",
        "Feature: Create a promo code",
        "  # Actors: Léa (primary)",
        "  # 1. Opens Promotions",
        "",
        "  @C1 @e2e",
        "  Scenario: C1",
        "    Given an active product",
        "    When Léa creates a code",
        "    Then it is listed",
        "",
        "  @C3 @manual @alt-4a",
        "  Scenario: C3",
        "    Then It is refused",
        "",
      ].join("\n"),
    );
  });
});
