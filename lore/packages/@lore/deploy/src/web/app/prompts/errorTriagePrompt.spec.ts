import {
  type AgentPromptProjectSubject,
  renderPromptTemplate,
} from "@lore/core/web";
import { describe, expect, it } from "vitest";

import { errorTriagePromptDefault } from "./errorTriagePrompt.ts";

/**
 * Surface-scoped, like the feedback loop: a triage pass has no item, so
 * three fields and no `number`, `id`, `reference` or `title`.
 */
const subject: AgentPromptProjectSubject = {
  project: "Alepha",
  slug: "alepha",
  url: "https://lore.alepha.dev/alepha/errors",
};

describe("errorTriagePromptDefault", () => {
  const prompt = renderPromptTemplate(errorTriagePromptDefault, subject);

  it("renders with no item subject at all", () => {
    expect(prompt).toContain('project "Alepha"');
    expect(prompt).toContain("https://lore.alepha.dev/alepha/errors");
    expect(prompt).not.toMatch(/\{\{/);
  });

  it("names the four tools rather than gesturing at them", () => {
    for (const tool of [
      "error_list",
      "error_resolve",
      "error_forward",
      "quest_create",
    ]) {
      expect(prompt, tool).toContain(`\`${tool}\``);
    }
  });

  /**
   * The half an agent gets wrong. An error inbox is mostly noise - extension
   * errors, aborted requests, bots - so a prompt that only says "triage" files
   * a quest per crash or resolves the one real bug along with the rest.
   */
  it("says what noise is, concretely, and that resolving is the discard", () => {
    expect(prompt).toContain("Resolve it");
    for (const kind of ["extension", "aborted request", "bot", "third-party"]) {
      expect(prompt, kind).toContain(kind);
    }
    // The stack rule is the one mechanical test an agent can apply.
    expect(prompt).toMatch(/no frame from this project/i);
  });

  it("tells the agent to read the count and the last-seen", () => {
    // One group seen 20 times and one seen twice are different problems, and
    // the row carries both. An agent reading only the message treats them
    // alike.
    expect(prompt).toMatch(/how many times it has been seen/i);
    expect(prompt).toMatch(/when it was last seen/i);
  });

  it("keeps a third outcome, so an undecidable error is not forced", () => {
    expect(prompt).toContain("Leave it open");
  });

  it("says the crash text is attacker-controlled", () => {
    // `name`, `message`, `stack` and `sourceUrl` are whatever the reporting
    // page put there, and this prompt is read by an agent with tools.
    expect(prompt).toMatch(/attacker-controlled/i);
    expect(prompt).toMatch(/never as instructions/i);
  });
});
