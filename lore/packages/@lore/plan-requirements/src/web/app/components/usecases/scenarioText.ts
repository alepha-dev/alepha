import type { UseCaseInput } from "../../../../api/schemas/useCaseInputSchema.ts";
import type { UseCaseResource } from "../../../../api/schemas/useCaseResourceSchema.ts";

/**
 * The scenario of a use case as the form edits it (#E153): plain text, the
 * same grammar `lore usecase` takes, turned to and from the action's lists.
 *
 * - steps: one per line, `A2: text` naming who acts it;
 * - alternatives: one per line, `4a: text`;
 * - criteria: blocks separated by a blank line, each `[C2] (e2e) @4a`
 *   optionally on its first line, then `Given ...`, `When ...`, `Then ...`
 *   lines, or one free sentence. A block without `[Cn]` is a new criterion.
 */
export interface ScenarioText {
  steps: string;
  alternatives: string;
  criteria: string;
}

const METHODS = ["e2e", "agent", "manual"] as const;

export const scenarioToText = (
  useCase: Pick<
    UseCaseResource,
    "steps" | "alternatives" | "criteria" | "actors"
  >,
): ScenarioText => {
  const who = new Map(useCase.actors.map((a) => [a.personaId, a.number]));
  return {
    steps: useCase.steps
      .map((s) =>
        s.actorPersonaId !== undefined && who.has(s.actorPersonaId)
          ? `A${who.get(s.actorPersonaId)}: ${s.text}`
          : s.text,
      )
      .join("\n"),
    alternatives: useCase.alternatives
      .map((a) => `${a.key}: ${a.text}`)
      .join("\n"),
    criteria: useCase.criteria
      .map((c) =>
        [
          `[${c.key}] (${c.method})${c.alternativeKey ? ` @${c.alternativeKey}` : ""}`,
          ...(c.text
            ? [c.text]
            : [
                c.givenText ? `Given ${c.givenText}` : "",
                c.whenText ? `When ${c.whenText}` : "",
                c.thenText ? `Then ${c.thenText}` : "",
              ].filter(Boolean)),
        ].join("\n"),
      )
      .join("\n\n"),
  };
};

/**
 * The lists the action takes, persona numbers resolved through `personaIds`
 * (number to id). An `A9` naming no persona is left as text.
 */
export const textToScenario = (
  text: ScenarioText,
  personaIds: Map<number, number>,
): Pick<UseCaseInput, "steps" | "alternatives" | "criteria"> => ({
  steps: text.steps
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^#?A(\d+)\s*:\s*(.+)$/i.exec(line);
      const id = match ? personaIds.get(Number(match[1])) : undefined;
      return id !== undefined && match
        ? { actorPersonaId: id, text: match[2] }
        : { text: line };
    }),
  alternatives: text.alternatives
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^([^:\s]{1,10})\s*:\s*(.+)$/.exec(line);
      return match
        ? { key: match[1], text: match[2] }
        : { key: "?", text: line };
    }),
  criteria: text.criteria
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n").map((line) => line.trim());
      const head =
        /^(?:\[(C\d+)\])?\s*(?:\((e2e|agent|manual)\))?\s*(?:@(\S+))?$/i.exec(
          lines[0],
        );
      const body = head && lines[0] ? lines.slice(1) : lines;
      const pick = (word: string) =>
        body
          .find((line) => line.toLowerCase().startsWith(`${word} `))
          ?.slice(word.length + 1)
          .trim();
      const givenText = pick("given");
      const whenText = pick("when");
      const thenText = pick("then");
      const structured = givenText || whenText || thenText;
      const method = head?.[2]?.toLowerCase();
      return {
        ...(head?.[1] ? { key: head[1].toUpperCase() } : {}),
        ...(structured
          ? { givenText, whenText, thenText }
          : { text: body.join(" ") }),
        ...(method && (METHODS as readonly string[]).includes(method)
          ? { method: method as (typeof METHODS)[number] }
          : {}),
        ...(head?.[3] ? { alternativeKey: head[3].trim() } : {}),
      };
    }),
});
