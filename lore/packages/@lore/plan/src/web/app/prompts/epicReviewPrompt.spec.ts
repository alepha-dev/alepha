import { type AgentPromptSubject, renderPromptTemplate } from "@lore/core/web";
import { describe, expect, it } from "vitest";

import { epicReviewPromptDefault } from "./epicReviewPrompt.ts";

const subject: AgentPromptSubject = {
  project: "Alepha",
  slug: "alepha",
  number: 31,
  id: 57,
  reference: "#E31",
  title: "Epic Workflow",
  url: "https://lore.alepha.dev/alepha/epics/31",
};

/**
 * The template is pinned here so that a change to it is a diff someone
 * reads. What makes a prompt worth pasting is everything the agent cannot
 * guess: which epic, where, which calls read it, and which calls write
 * back.
 */
describe("epicReviewPromptDefault", () => {
  const prompt = renderPromptTemplate(epicReviewPromptDefault, subject);

  it("names the epic, the project and the URL", () => {
    // The typed reference (epic #32), the same string every screen shows.
    expect(prompt).toContain("#E31");
    expect(prompt).toContain("Epic Workflow");
    // ⚠️ The project's TITLE, which is what `project_name` matches.
    expect(prompt).toContain('project_name "Alepha"');
    // The URL is what lets an agent with no Lore MCP be pointed at it.
    expect(prompt).toContain("https://lore.alepha.dev/alepha/epics/31");
  });

  it("names the two calls that read the plan, detail: full included", () => {
    expect(prompt).toContain("epic_get");
    expect(prompt).toContain("quest_list");
    // Without it the list omits every description and every objective,
    // which is the half a review exists to read.
    expect(prompt).toContain('detail: "full"');
  });

  /**
   * `quest_list`'s `epic:` filter takes the GLOBAL id. The text that
   * shipped before said "set to that epic", which made the agent look it
   * up; the template now hands it over.
   */
  it("hands quest_list the epic's global id", () => {
    expect(prompt).toContain("`epic: 57`");
    expect(prompt).not.toContain("set to that epic");
  });

  it("states the job: decide, sharpen, and surface what it cannot answer", () => {
    expect(prompt).toContain("Take every decision the spec has left open");
    expect(prompt).toContain("Sharpen the quests that are vague");
    expect(prompt).toContain("cannot answer alone");
  });

  /**
   * The load-bearing half of the review, and the one the baseline used to
   * leave out. It stopped at the write-back, so the questions landed in
   * Lore and the reply said "filed", which made every use of the prompt
   * open with the same follow-up asking for context and a recommendation.
   */
  it("asks for every open question in the reply, with context and suggestions", () => {
    expect(prompt).toContain("put every open question in your reply");
    expect(prompt).toContain("**Context**");
    expect(prompt).toContain("**Suggestions**");
    // Filing them is not the report, and the template has to say so: an
    // agent told only to file them answers with a receipt.
    expect(prompt).toContain("Filing them is not the report");
  });

  it("names the write-back path", () => {
    expect(prompt).toContain("epic_update");
    expect(prompt).toContain("quest_create");
    expect(prompt).toContain("quest_update");
    expect(prompt).toContain("quest_objective_set");
    // `epic_number` takes the per-project number, not the global id.
    expect(prompt).toContain("`epic_number` 31");
  });

  /**
   * The review is a record since #E121: one call files it, the reply quotes
   * the numbers that call returned, and the owner answers by number.
   */
  it("reads the decision log first and treats it as binding", () => {
    expect(prompt).toContain("`review`");
    expect(prompt).toContain("The log is binding");
    expect(prompt).toContain("do not ask again a question it answers");
  });

  it("files every finding with one epic_review_create call", () => {
    expect(prompt).toContain("ONE `epic_review_create` call");
    expect(prompt).toContain('project_name "Alepha", number 31');
    expect(prompt).toContain("`question`");
    expect(prompt).toContain("`decision`");
    expect(prompt).toContain("`change`");
    // The old write-back for questions, retired.
    expect(prompt).not.toContain("a comment on the quest they concern");
  });

  it("quotes the returned numbers and says how to answer them", () => {
    expect(prompt).toContain("the item number `epic_review_create` returned");
    expect(prompt).toContain("Review tab");
    expect(prompt).toContain('"answer 3: B"');
    expect(prompt).toContain("`epic_review_answer`");
  });

  it("files an empty review rather than padding one", () => {
    expect(prompt).toContain("file it with no items");
    expect(prompt).toContain(
      "If the review raised no open question at all, say so in one line rather than inventing one.",
    );
  });

  /**
   * The load-bearing one, kept from the builder this template replaced.
   * The renderer takes seven named fields rather than a resource object
   * precisely so that nothing can ride along. A `sg_` token in a prompt
   * would be a leak with no error.
   */
  it("carries nothing but the fields it was given", () => {
    const withSecrets = renderPromptTemplate(epicReviewPromptDefault, {
      ...subject,
      // @ts-expect-error the subject type has no such field, and that is the point
      token: "sg_alepha_supersecret",
    });
    expect(withSecrets).not.toContain("sg_");
    expect(withSecrets).toBe(prompt);
  });
});
