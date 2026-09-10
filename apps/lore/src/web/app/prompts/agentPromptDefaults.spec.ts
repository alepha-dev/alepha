import { describe, expect, it } from "vitest";

import {
  type AgentPromptKind,
  agentPromptKindSchema,
} from "@/api/schemas/agentPromptKindSchema.ts";

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

describe("the default prompts", () => {
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
   *
   * ⚠️ **Which ones depends on the SHAPE.** Every kind is item-scoped except
   * `feedbackLoop`, whose subject is the inbox and has no `number`,
   * `reference` or `title` to name. Asserting the item four on all of them
   * was right while there were four kinds and is the assertion that went red
   * when the fifth arrived.
   */
  const SURFACE_SCOPED: AgentPromptKind[] = ["feedbackLoop", "blightTriage"];

  it("carries the placeholders that name its subject", () => {
    for (const [kind, template] of Object.entries(AGENT_PROMPT_DEFAULTS)) {
      // Both shapes name the project and point somewhere.
      expect(template, kind).toContain("{{project}}");
      expect(template, kind).toContain("{{url}}");

      if (SURFACE_SCOPED.includes(kind as AgentPromptKind)) continue;

      expect(template, kind).toContain("{{reference}}");
      expect(template, kind).toContain("{{title}}");
      expect(template, kind).toContain("{{number}}");
    }
  });

  /**
   * The other direction, and the one that matters more: a surface-scoped
   * template naming an item placeholder does not fail, it renders
   * `{{reference}}` verbatim into a pasted prompt. Nothing but this catches
   * it.
   */
  it("never asks a surface-scoped prompt for an item it does not have", () => {
    for (const kind of SURFACE_SCOPED) {
      const template = AGENT_PROMPT_DEFAULTS[kind];
      expect(template, kind).not.toContain("{{reference}}");
      expect(template, kind).not.toContain("{{title}}");
      expect(template, kind).not.toContain("{{number}}");
      expect(template, kind).not.toContain("{{id}}");
    }
  });
});
