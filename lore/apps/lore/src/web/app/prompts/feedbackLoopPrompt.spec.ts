import { describe, expect, it } from "vitest";

import { feedbackLoopPromptDefault } from "./feedbackLoopPrompt.ts";
import {
  type AgentPromptProjectSubject,
  renderPromptTemplate,
} from "./renderPromptTemplate.ts";

/**
 * ⚠️ Three fields, and that is the point of this file. The other four
 * defaults render against an `AgentPromptItemSubject`; this one has no item,
 * so it has no `number`, `id`, `reference` or `title` to render against.
 */
const subject: AgentPromptProjectSubject = {
  project: "Alepha",
  slug: "alepha",
  url: "https://lore.alepha.dev/alepha/feedback",
};

describe("feedbackLoopPromptDefault", () => {
  const prompt = renderPromptTemplate(feedbackLoopPromptDefault, subject);

  it("renders with no item subject at all", () => {
    expect(prompt).toContain('project "Alepha"');
    expect(prompt).toContain("https://lore.alepha.dev/alepha/feedback");
    // Nothing left unresolved: a `{{...}}` surviving into the pasted text is
    // the template having asked the inbox for something only an item has.
    expect(prompt).not.toMatch(/\{\{/);
  });

  it("names the tools rather than gesturing at them", () => {
    // An agent that has to guess the tool names calls none of them.
    for (const tool of [
      "feedback_list",
      "feedback_get",
      "feedback_accept",
      "feedback_reject",
      "feedback_comment_add",
      "quest_create",
    ]) {
      expect(prompt, tool).toContain(`\`${tool}\``);
    }
  });

  /**
   * The discard path is the half an agent gets wrong. Given only "handle the
   * inbox" it accepts everything, which turns seven reports into seven quests
   * and moves the triage problem rather than solving it.
   */
  it("says what to reject, and what to do when it cannot decide", () => {
    expect(prompt).toContain("Reject it when");
    expect(prompt).toContain("duplicate");
    // The third outcome, and the one an agent will not invent: leave it
    // pending and ask, rather than guessing in either direction.
    expect(prompt).toMatch(/unsure/i);
    expect(prompt).toContain("leave it pending");
  });

  it("loops until the inbox is empty, and re-reads it each round", () => {
    expect(prompt).toMatch(/until nothing is pending/i);
    // A list taken once goes stale the moment the agent files a quest, or
    // somebody else triages an item meanwhile.
    expect(prompt).toMatch(/Re-read it each round/i);
  });

  it("links each accepted report to the quest it produced", () => {
    expect(prompt).toContain("feedback_shortId");
  });
});
