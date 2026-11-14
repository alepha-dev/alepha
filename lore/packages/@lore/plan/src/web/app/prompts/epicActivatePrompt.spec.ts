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
    expect(prompt).toContain(
      "Do not start the next quest while the current one is red",
    );
  });

  it("closes once every pull request has merged, with an outcome folio", () => {
    expect(prompt).toContain(
      "Wait until every quest's pull request has merged",
    );
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
   * One branch and one pull request per quest, never a merge by the agent
   * (#Q3633). It replaced the single epic branch merged once at the end, and
   * with it #Q2640's local-check gate: CI on each pull request is the gate.
   */
  it("lands each quest through its own pull request", () => {
    expect(prompt).toContain("one branch and one pull request per quest");
    expect(prompt).toContain("Cut a branch for it from the latest main");
    expect(prompt).toContain("open a pull request into main");
    expect(prompt).toContain("the run on the pull request");
    expect(prompt).toContain("Never merge it yourself, and never push to main");
    expect(prompt).toContain("lets an agent turn on auto-merge");
    expect(prompt).toContain(
      "squash-merged, so main gets one commit per quest",
    );
    expect(prompt).not.toContain("merge the branch into main");
    // A quest completes on its merge, so `quest_complete` comes after it.
    expect(prompt.indexOf("Only once it has merged")).toBeLessThan(
      prompt.indexOf("then `quest_complete`"),
    );
  });

  it("requires the branches and the worktree to be cleaned up", () => {
    expect(prompt).toContain("Delete the merged branches locally");
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
});
