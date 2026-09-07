import { describe, expect, it } from "vitest";

import { epicReviewPromptDefault } from "./epicReviewPrompt.ts";
import {
  type AgentPromptSubject,
  renderPromptTemplate,
} from "./renderPromptTemplate.ts";

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

  it("names the write-back path", () => {
    expect(prompt).toContain("epic_update");
    expect(prompt).toContain("quest_create");
    expect(prompt).toContain("quest_update");
    expect(prompt).toContain("quest_objective_set");
    // `epic_number` takes the per-project number, not the global id.
    expect(prompt).toContain("`epic_number` 31");
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
