import { type AgentPromptSubject, renderPromptTemplate } from "@lore/core/web";
import { describe, expect, it } from "vitest";

import { questWorkPromptDefault } from "./questWorkPrompt.ts";

const subject: AgentPromptSubject = {
  project: "Alepha",
  slug: "alepha",
  number: 1798,
  id: 2009,
  reference: "#Q1798",
  title: "The submenu in DataTable",
  url: "https://lore.alepha.app/alepha/quests/1798",
};

describe("questWorkPromptDefault", () => {
  const prompt = renderPromptTemplate(questWorkPromptDefault, subject);

  it("names the quest, the project title and the URL", () => {
    expect(prompt).toContain("#Q1798");
    expect(prompt).toContain("The submenu in DataTable");
    expect(prompt).toContain('project_name "Alepha"');
    expect(prompt).toContain("https://lore.alepha.app/alepha/quests/1798");
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

  it("walks the quest: accept, tick, check, commit, pull request, complete", () => {
    expect(prompt).toContain("quest_accept");
    expect(prompt).toContain("quest_objective_set");
    expect(prompt).toContain("A skipped check is a failure, not a pass");
    expect(prompt).toContain("quest_commit_add");
    expect(prompt).toContain("open a pull request into main");
    expect(prompt).toContain("quest_complete");
  });

  /**
   * The standard flow (#Q3633): the agent opens a pull request, CI runs on
   * it, and the agent never merges to main itself. Auto-merge is the
   * project's rule to grant, and the merge is a rebase of the quest's one
   * commit (#Q3706), the method an epic's pull request needs too.
   */
  it("lands through a pull request the agent never merges itself", () => {
    expect(prompt).toContain("branch cut from the latest main");
    expect(prompt).toContain("Never merge it yourself, and never push to main");
    expect(prompt).toContain("lets an agent turn on auto-merge");
    expect(prompt).toContain("Commit it as one commit");
    expect(prompt).toContain("as a rebase merge");
    expect(prompt).not.toContain("squash");
    expect(prompt).not.toContain("merge the branch into main");
  });

  /**
   * The order is the point, not the steps. A local check is the inner loop,
   * the CI run on the pull request is the source of truth, and the quest
   * completes in the run that opens the pull request, never after the merge,
   * which lands once the agent is gone (#Q3982).
   */
  it("makes the CI run the gate, and completes the quest without waiting for the merge", () => {
    expect(prompt).toContain(
      "the run on the pull request is the source of truth",
    );
    expect(prompt).toContain("the run on the pull request");
    expect(prompt).toContain("a green local check is not");
    expect(prompt.indexOf("open a pull request into main")).toBeLessThan(
      prompt.indexOf("`quest_complete`"),
    );
    expect(prompt).toContain("do not wait for the CI run or the merge");
    expect(prompt.indexOf("`quest_complete`")).toBeLessThan(
      prompt.indexOf("once it has merged"),
    );
    expect(prompt).toContain("Never stop with the quest still accepted");
    expect(prompt).not.toContain("Only once it has merged");
    expect(prompt).not.toContain("leave the quest accepted");
  });

  /**
   * Cleanup is part of the job. A branch and a worktree left behind are what
   * fourteen stale worktrees look like.
   */
  // #Q3707: recorded on the quest, where its rail shows it.
  it("records the pull request on the quest, not as a comment", () => {
    expect(prompt).toContain(
      "Record it on the quest with `quest_pull_request_add`",
    );
    expect(prompt).not.toMatch(/Post the pull request's link/i);
  });

  it("requires the branch and the worktree to be cleaned up", () => {
    expect(prompt).toContain("Delete the branch locally");
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
