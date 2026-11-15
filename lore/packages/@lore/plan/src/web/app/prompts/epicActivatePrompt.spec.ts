import { type AgentPromptSubject, renderPromptTemplate } from "@lore/core/web";
import { describe, expect, it } from "vitest";

import { epicActivatePromptDefault } from "./epicActivatePrompt.ts";

const subject: AgentPromptSubject = {
  project: "Alepha",
  slug: "alepha",
  number: 41,
  id: 67,
  reference: "#E41",
  title: "Lore Agent Prompts",
  url: "https://lore.alepha.dev/alepha/epics/41",
};

describe("epicActivatePromptDefault", () => {
  const prompt = renderPromptTemplate(epicActivatePromptDefault, subject);

  it("names the epic, the project title and the URL", () => {
    expect(prompt).toContain("#E41");
    expect(prompt).toContain("Lore Agent Prompts");
    expect(prompt).toContain('project_name "Alepha"');
    expect(prompt).toContain("https://lore.alepha.dev/alepha/epics/41");
  });

  it("reads the plan with epic_get and quest_list, detail: full included", () => {
    expect(prompt).toContain("epic_get");
    expect(prompt).toContain("quest_list");
    expect(prompt).toContain('detail: "full"');
    // The global id the filter wants, not the per-project number.
    expect(prompt).toContain("`epic: 67`");
  });

  /**
   * The review record (#E121): its decision log is binding, and a question
   * still open is the owner's, never the run's to answer.
   */
  it("reads the decision log as binding and stops on an open question", () => {
    expect(prompt).toContain("`review.log`");
    expect(prompt).toContain("the log is binding");
    expect(prompt).toContain("`review.openQuestions`");
    expect(prompt).toContain("they are the owner's: stop and report them");
  });

  it("demands a worktree and a branch, never main", () => {
    expect(prompt).toContain("git worktree");
    expect(prompt).toContain("Never on main");
  });

  it("stops on a draft epic and states the frozen-plan rule", () => {
    // Whether a spec is done is the owner's call (#Q2223). The prompt used
    // to tell the agent to Begin the epic itself, which is why the click
    // never carried a decision.
    expect(prompt).toContain("If it is still a `draft`, stop and say so");
    expect(prompt).toContain("Your first `quest_accept` starts the epic");
    expect(prompt).toContain("its quest set is frozen");
    // What a discovery becomes once the set is frozen: an objective or a
    // comment, never a new quest.
    expect(prompt).toContain("quest_update");
    expect(prompt).toContain("quest_comment_add");
    expect(prompt).toContain("never a new quest");
  });

  it("walks one quest at a time, ticking as it goes", () => {
    expect(prompt).toContain("quest_accept");
    expect(prompt).toContain("quest_objective_set");
    expect(prompt).toContain("not at the end");
    expect(prompt).toContain("quest_commit_add");
    expect(prompt).toContain("quest_complete");
    // A skipped check is the failure mode this line exists to name.
    expect(prompt).toContain("A skipped check is a failure, not a pass");
    // CI runs while the next quest is worked; a red run is fixed in the
    // commit of the quest it belongs to (#Q3706).
    expect(prompt).toContain(
      "Do not wait for it before starting the next quest",
    );
    expect(prompt).toContain(
      "fix a red one in the commit of the quest it belongs to",
    );
  });

  it("closes once the pull request has merged, with an outcome folio", () => {
    expect(prompt).toContain("Only once it has merged");
    expect(prompt).toContain("folio_create");
    expect(prompt).toContain("`epic_number` 41");
  });

  it("sets no epic status anywhere", () => {
    // Both automatic moves happen on the quest requests; a status call here
    // is either refused (`in_progress` and `completed` are not settable) or
    // an agent deciding a spec is done.
    expect(prompt).not.toContain("epic_set_status");
    expect(prompt).toContain("There is no status to set");
  });

  /**
   * One branch and one pull request for the whole epic, one commit per quest,
   * rebase-merged, never merged by the agent (#Q3706). It replaced a pull
   * request per quest (#Q3633), which made every quest wait for its own CI
   * run and merge.
   */
  it("lands the whole epic through one rebase-merged pull request", () => {
    expect(prompt).toContain("in one pull request");
    expect(prompt).toContain(
      "one branch for the whole epic, cut from the latest main",
    );
    expect(prompt).toContain("one pull request holding one commit per quest");
    expect(prompt).toContain("Commit it as one commit");
    expect(prompt).toContain(
      "open a pull request into main for the whole epic, as a draft",
    );
    expect(prompt).toContain(
      "the pull request, and that run is the source of truth",
    );
    expect(prompt).toContain("Never merge it yourself, and never push to main");
    expect(prompt).toContain("lets an agent turn on auto-merge");
    expect(prompt).toContain("as a rebase merge");
    expect(prompt).toContain("Never merge main into it");
    expect(prompt).not.toContain("squash-merged");
    expect(prompt).not.toContain("one pull request per quest");
    expect(prompt).not.toContain("merge the branch into main");
  });

  /**
   * A quest completes once its commit is pushed, so a quest depending on it
   * can be accepted; the last one waits for the merge, since completing it
   * completes the epic. The shas are recorded after the rebase merge.
   */
  it("completes each quest on its push and the last one on the merge", () => {
    expect(prompt.indexOf("Push the branch")).toBeLessThan(
      prompt.indexOf("`quest_complete` it with a short note"),
    );
    expect(prompt).toContain(
      "Keep the epic's last quest accepted until the pull request has merged",
    );
    expect(prompt.indexOf("Only once it has merged")).toBeLessThan(
      prompt.indexOf("then `quest_complete` the last quest"),
    );
    expect(prompt).toContain("a rebase gives every commit a new sha");
  });

  it("requires the branch and the worktree to be cleaned up", () => {
    expect(prompt).toContain("Delete the branch locally");
    expect(prompt).toContain("remove the worktree");
  });

  /**
   * ⚠️ Served to EVERY Lore project, so it must name no project's command.
   */
  it("names no project-specific verification command", () => {
    expect(prompt).not.toContain("yarn v");
    expect(prompt).toContain("the project's local checks");
  });

  it("says to stop and comment rather than guess", () => {
    expect(prompt).toContain(
      "Do not guess at a decision that is the owner's to make",
    );
  });

  /**
   * The folio is the record a later session reads; the reply is what the
   * person who started the run reads now. A twelve-quest epic can leave
   * several blocked quests behind, each a decision that is the owner's, and
   * a comment on one of them is not where they are looking.
   */
  it("reports what shipped and every blocked quest in the reply", () => {
    expect(prompt).toContain("Then report in your reply");
    expect(prompt).toContain("**What shipped**");
    expect(prompt).toContain("**Every quest you could not do as written**");
    // The line that stops the reply being a link to a comment.
    expect(prompt).toContain(
      "The decision is the owner's, and they are reading here",
    );
  });

  it("carries nothing but the fields it was given", () => {
    const withSecrets = renderPromptTemplate(epicActivatePromptDefault, {
      ...subject,
      // @ts-expect-error the subject type has no such field, and that is the point
      token: "sg_alepha_supersecret",
    });
    expect(withSecrets).not.toContain("sg_");
    expect(withSecrets).toBe(prompt);
  });

  /**
   * An epic with no folio in a directory yet files its outcome at the root
   * of the tree when no `directory_shortId` is passed (#Q3710).
   */
  it("files the outcome folio in a chosen directory, never the root", () => {
    expect(prompt).toContain("`directory_list`");
    expect(prompt).toContain("Pass `directory_shortId` too");
    expect(prompt).toContain("Never leave it at the root");
  });
});
