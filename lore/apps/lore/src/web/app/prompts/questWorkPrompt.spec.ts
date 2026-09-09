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

  it("walks the quest: accept, tick, check, one commit, push, merge, complete", () => {
    expect(prompt).toContain("quest_accept");
    expect(prompt).toContain("quest_objective_set");
    expect(prompt).toContain("A skipped check is a failure, not a pass");
    expect(prompt).toContain("quest_commit_add");
    expect(prompt).toContain("merge the branch into main and push");
    expect(prompt).toContain("quest_complete");
  });

  /**
   * The order is the point, not the steps. A local check is the inner loop
   * and the CI run is the source of truth, so the branch is finished only
   * once CI is green - not once the terminal is.
   */
  it("makes the CI run the gate, and finishing the branch conditional on it", () => {
    expect(prompt).toContain("Push the branch");
    expect(prompt).toContain("that run is the source of truth");
    expect(prompt).toContain("a green local check is not");
    expect(prompt).toContain("Only when it is green");
    expect(prompt.indexOf("Push the branch")).toBeLessThan(
      prompt.indexOf("merge the branch into main and push"),
    );
  });

  /**
   * Cleanup is part of the job. A branch and a worktree left behind are what
   * fourteen stale worktrees look like.
   */
  it("requires the branch and the worktree to be cleaned up", () => {
    expect(prompt).toContain("delete the branch locally and on the remote");
    expect(prompt).toContain("remove the worktree");
  });

  /**
   * ⚠️ This default is served to EVERY Lore project. Naming a command here
   * would be wrong for every project that is not the one it was written in.
   */
  it("names no project-specific verification command", () => {
    expect(prompt).not.toContain("yarn v");
    expect(prompt).toContain("the project's local checks");
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

  /**
   * One quest has one blocking point, so this is a clause on "and stop"
   * rather than a section of its own - but the clause has to be there. A
   * comment on the quest is not read by the person waiting on the answer.
   */
  it("puts the blocking question in the reply, not only in the comment", () => {
    expect(prompt).toContain("put the question in your reply as well");
    expect(prompt).toContain("the two or three ways forward");
    expect(prompt).toContain(
      "your reply is what the person who sent you here reads",
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
