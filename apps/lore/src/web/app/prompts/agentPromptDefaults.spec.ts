import { describe, expect, it } from "vitest";

import { agentPromptKindSchema } from "@/api/schemas/agentPromptKindSchema.ts";

import { capabilityRegistry } from "../services/capabilityRegistry.ts";
import { AGENT_PROMPT_DEFAULTS } from "./agentPromptDefaults.ts";

/**
 * Tools no capability owns, because they are the orientation calls every
 * project has whatever it does. Named rather than inferred: an allowlist
 * that grows silently is the same as no check.
 */
const UNOWNED_TOOLS = ["project_context", "project_info"];

/**
 * Backticked snake_case identifiers that are PARAMETER names rather than
 * tool names. There is no syntactic difference between the two, so the ones
 * the templates use are listed rather than guessed at.
 *
 * Short on purpose: most parameters the templates name are camelCase after
 * the underscore (`feedback_shortId`) and so are never picked up, and every
 * new entry here is a line someone has to justify.
 */
const PARAMETER_NAMES = ["epic_number"];

/**
 * Every backticked snake_case identifier in the four defaults, which is how
 * a template names a tool.
 *
 * ⚠️ Deliberately not a hand-written list of what to look for. A prompt
 * that names a tool which has since been renamed fails at the reader's
 * keyboard, hours later, with no error anywhere; the only way to catch it
 * is to read what the templates actually say.
 */
const namedTools = (template: string): string[] => {
  const found = template.match(/`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g) ?? [];
  return [...new Set(found.map((it) => it.slice(1, -1)))];
};

describe("the four default prompts", () => {
  it("has a default for every kind, and no kind without one", () => {
    expect(Object.keys(AGENT_PROMPT_DEFAULTS).sort()).toEqual(
      [...agentPromptKindSchema.options].sort(),
    );
    for (const template of Object.values(AGENT_PROMPT_DEFAULTS)) {
      expect(template.length).toBeGreaterThan(0);
    }
  });

  /**
   * ⚠️ The union of ALL FOUR capabilities, not Work's. `folio_create`
   * belongs to Knowledge and the four `feedback_*` to Support, so narrowing
   * this to `work` fails three of the four defaults on sight.
   */
  it("names only tools the MCP surface actually has", () => {
    const known = new Set([
      ...capabilityRegistry.all().flatMap((it) => it.mcpTools),
      ...UNOWNED_TOOLS,
      ...PARAMETER_NAMES,
    ]);

    // The check is only worth anything if the union is the real one.
    // `folio_create` is Knowledge's and `feedback_get` is Support's, so a
    // union of Work's array alone would fail three of the four defaults.
    expect(known.has("quest_accept")).toBe(true);
    expect(known.has("folio_create")).toBe(true);
    expect(known.has("feedback_get")).toBe(true);

    // Everything at once, so a rename that hits three prompts is one
    // failure listing three rather than three runs.
    const unknown = Object.entries(AGENT_PROMPT_DEFAULTS).flatMap(
      ([kind, template]) =>
        namedTools(template)
          .filter((tool) => !known.has(tool))
          .map((tool) => `${kind}: ${tool}`),
    );
    expect(unknown).toEqual([]);
  });

  /**
   * The extractor has to actually find things. Without this, a regex that
   * matched nothing would make the check above vacuously green.
   */
  it("finds the tools it is meant to check", () => {
    expect(namedTools(AGENT_PROMPT_DEFAULTS.epicReview)).toContain("epic_get");
    expect(namedTools(AGENT_PROMPT_DEFAULTS.epicActivate)).toContain(
      "folio_create",
    );
    expect(namedTools(AGENT_PROMPT_DEFAULTS.questWork)).toContain("quest_get");
    expect(namedTools(AGENT_PROMPT_DEFAULTS.feedbackWork)).toContain(
      "feedback_accept",
    );
  });

  /**
   * A default is a template, so it has to carry placeholders: one that
   * lost them would copy the same text for every subject.
   */
  it("carries the placeholders that name its subject", () => {
    for (const template of Object.values(AGENT_PROMPT_DEFAULTS)) {
      expect(template).toContain("{{reference}}");
      expect(template).toContain("{{title}}");
      expect(template).toContain("{{project}}");
      expect(template).toContain("{{number}}");
      expect(template).toContain("{{url}}");
    }
  });
});
