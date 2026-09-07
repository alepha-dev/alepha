import { describe, expect, it } from "vitest";

import { questWorkPromptDefault } from "./questWorkPrompt.ts";
import {
  type AgentPromptSubject,
  renderPromptTemplate,
} from "./renderPromptTemplate.ts";

const subject: AgentPromptSubject = {
  project: "Alepha",
  slug: "alepha",
  number: 1798,
  id: 2009,
  reference: "#Q1798",
  title: "The submenu in AlephaTable",
  url: "https://lore.alepha.dev/alepha/quests/1798",
};

describe("questWorkPromptDefault", () => {
  const prompt = renderPromptTemplate(questWorkPromptDefault, subject);

  it("names the quest, the project title and the URL", () => {
    expect(prompt).toContain("#Q1798");
    expect(prompt).toContain("The submenu in AlephaTable");
    expect(prompt).toContain('project_name "Alepha"');
    expect(prompt).toContain("https://lore.alepha.dev/alepha/quests/1798");
  });

  /**
   * ⚠️ `quest_get` takes the per-project `shortId`, not the global id. A
   * prompt handing it 2009 finds another project's quest or nothing.
   */
  it("reads the quest by its shortId, and its epic's folios if it has one", () => {
    expect(prompt).toContain("quest_get");
    expect(prompt).toContain("shortId 1798");
    expect(prompt).not.toContain("shortId 2009");
    expect(prompt).toContain("epic_get");
    expect(prompt).toContain("the folios filed under it");
  });

  it("names what has to be read: objectives, discussion, links", () => {
    expect(prompt).toContain("the objectives");
    expect(prompt).toContain("the discussion");
    expect(prompt).toContain("the linked feedback");
    expect(prompt).toContain("depends on");
  });

  it("demands a worktree and a branch, never main", () => {
    expect(prompt).toContain("git worktree");
    expect(prompt).toContain("Never on main");
  });

  it("walks the quest: accept, tick, verify, one commit, merge, complete", () => {
    expect(prompt).toContain("quest_accept");
    expect(prompt).toContain("quest_objective_set");
    expect(prompt).toContain("A skipped check is a failure, not a pass");
    expect(prompt).toContain("quest_commit_add");
    expect(prompt).toContain("Merge the branch into main and push");
    expect(prompt).toContain("quest_complete");
  });

  /**
   * The line that keeps a quest a quest: a discovery is a comment, not a
   * licence to widen the change.
   */
  it("makes anything beyond the quest a comment rather than scope", () => {
    expect(prompt).toContain("quest_comment_add");
    expect(prompt).toContain("not extra scope");
    expect(prompt).toContain(
      "Do not guess at a decision that is the owner's to make",
    );
  });

  it("carries nothing but the fields it was given", () => {
    const withSecrets = renderPromptTemplate(questWorkPromptDefault, {
      ...subject,
      // @ts-expect-error the subject type has no such field, and that is the point
      token: "sg_alepha_supersecret",
    });
    expect(withSecrets).not.toContain("sg_");
    expect(withSecrets).toBe(prompt);
  });
});
