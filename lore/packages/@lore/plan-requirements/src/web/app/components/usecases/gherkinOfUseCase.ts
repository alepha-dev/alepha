import type { UseCaseResource } from "../../../../api/schemas/useCaseResourceSchema.ts";

/**
 * A use case as a Gherkin feature (#E153), built on the client for Export
 * as Gherkin: the use case is the feature, tagged `@U7`, each acceptance
 * criterion a scenario named by its key. A free-sentence criterion becomes a
 * scenario with a single `Then`.
 */
export const gherkinOfUseCase = (useCase: UseCaseResource): string => {
  const lines: string[] = [`@U${useCase.number}`, `Feature: ${useCase.title}`];
  if (useCase.actors.length) {
    lines.push(
      `  # Actors: ${useCase.actors.map((a) => `${a.name} (${a.role})`).join(", ")}`,
    );
  }
  for (const step of useCase.steps) {
    lines.push(`  # ${step.position}. ${step.text}`);
  }
  for (const criterion of useCase.criteria) {
    lines.push("");
    lines.push(
      `  @${criterion.key} @${criterion.method}${criterion.alternativeKey ? ` @alt-${criterion.alternativeKey}` : ""}`,
    );
    lines.push(`  Scenario: ${criterion.key}`);
    if (criterion.text) {
      lines.push(`    Then ${criterion.text}`);
      continue;
    }
    if (criterion.givenText) lines.push(`    Given ${criterion.givenText}`);
    if (criterion.whenText) lines.push(`    When ${criterion.whenText}`);
    if (criterion.thenText) lines.push(`    Then ${criterion.thenText}`);
  }
  return `${lines.join("\n")}\n`;
};
