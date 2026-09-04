import { describe, expect, it } from "vitest";

import { buildEpicReviewPrompt } from "./epicReviewPrompt.ts";

/**
 * The template is pinned here so that a change to it is a diff someone
 * reads. This is the first action prompt (feedback #2087), and the thing
 * that makes one worth pasting is everything the agent cannot guess: which
 * epic, where, which calls read it, and which calls write back.
 */
describe("buildEpicReviewPrompt", () => {
  const prompt = buildEpicReviewPrompt({
    projectSlug: "alepha",
    epicNumber: 31,
    epicTitle: "Epic Workflow",
    url: "https://lore.alepha.dev/alepha/epics/31",
  });

  it("names the epic, the project and the URL", () => {
    expect(prompt).toContain("#31");
    expect(prompt).toContain("Epic Workflow");
    expect(prompt).toContain("alepha");
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
  });

  /**
   * The load-bearing one. This text leaves Lore through the clipboard and
   * lands wherever the reader pastes it, so the builder takes four named
   * fields rather than a resource object precisely so that nothing can ride
   * along. A `sg_` token in a prompt would be a leak with no error.
   */
  it("carries nothing but the four fields it was given", () => {
    const withSecrets = buildEpicReviewPrompt({
      projectSlug: "alepha",
      epicNumber: 31,
      epicTitle: "Epic Workflow",
      url: "https://lore.alepha.dev/alepha/epics/31",
      // @ts-expect-error the input type has no such field, and that is the point
      token: "sg_alepha_supersecret",
    });
    expect(withSecrets).not.toContain("sg_alepha_supersecret");
    expect(withSecrets).toBe(prompt);
  });
});
