import {
  type AgentPromptProjectSubject,
  renderPromptTemplate,
} from "@lore/core/web";
import { describe, expect, it } from "vitest";

import { questLoopPromptDefault } from "./questLoopPrompt.ts";

/**
 * Surface-scoped, like the two triage loops: the Quests page names no single
 * quest, so three fields and no `number`, `id`, `reference` or `title`.
 */
const subject: AgentPromptProjectSubject = {
  project: "Alepha",
  slug: "alepha",
  url: "https://lore.alepha.app/alepha/quests",
};

describe("questLoopPromptDefault", () => {
  const prompt = renderPromptTemplate(questLoopPromptDefault, subject);

  it("renders with no item subject at all", () => {
    expect(prompt).toContain('project "Alepha"');
    expect(prompt).toContain("https://lore.alepha.app/alepha/quests");
    expect(prompt).not.toMatch(/\{\{/);
  });

  it("scopes the run to todo quests under no epic", () => {
    expect(prompt).toContain('status "todo"');
    expect(prompt).toMatch(/carry no `epic`/);
    // An agent told only "work the todo quests" would pick up an epic's too,
    // and work a plan past the gates its own prompt carries.
    expect(prompt).toMatch(/under an epic is not part of this run/i);
  });

  it("re-reads the list each round instead of working from a snapshot", () => {
    expect(prompt).toMatch(/re-read the list each round/i);
    expect(prompt).toMatch(/read the list one last time/i);
  });

  it("carries the epic Work on it rules, in the order they bite", () => {
    const at = (text: string) => {
      const index = prompt.indexOf(text);
      expect(index, text).toBeGreaterThan(-1);
      return index;
    };
    // One branch and one pull request for the run, one commit per quest,
    // rebase-merged (#Q3706); a pull request per quest until then (#Q3633).
    expect(prompt).toContain("in one run and one pull request");
    expect(prompt).toContain("one pull request holding one commit per quest");
    expect(prompt).not.toContain("one pull request per quest");
    // Accepted before its commit, completed once the commit is pushed, and
    // main's sha recorded after the merge.
    expect(at("`quest_accept` it before its first commit")).toBeLessThan(
      at("Commit it as one commit"),
    );
    expect(at("Commit it as one commit")).toBeLessThan(at("Push the branch"));
    expect(at("Push the branch")).toBeLessThan(at("`quest_complete` it"));
    expect(at("When none is left")).toBeLessThan(at("as a rebase merge"));
    expect(at("as a rebase merge")).toBeLessThan(
      at("If you are still there once it has merged"),
    );
    expect(at("If you are still there once it has merged")).toBeLessThan(
      at("`quest_commit_add`"),
    );
    // The agent never merges to main itself, nor main into its branch.
    expect(prompt).toContain("Never merge it yourself, and never push to main");
    expect(prompt).toContain("Never merge main into it");
    expect(prompt).not.toMatch(/merge the branch into main/i);
    expect(at("When none is left")).toBeLessThan(
      at("Delete the branch locally"),
    );
  });

  it("names the tools rather than gesturing at them", () => {
    for (const tool of [
      "project_context",
      "quest_list",
      "quest_get",
      "quest_accept",
      "quest_objective_set",
      "quest_commit_add",
      "quest_complete",
      "quest_comment_add",
    ]) {
      expect(prompt, tool).toContain(`\`${tool}\``);
    }
  });

  // #Q3707: the run's one pull request is recorded on each of its quests.
  it("records the pull request on each quest, not as a comment", () => {
    expect(prompt).toContain(
      "Record it on each quest with `quest_pull_request_add`",
    );
    expect(prompt).not.toMatch(/Post the pull request's link/i);
  });

  it("ends on a report that lists what was blocked", () => {
    expect(prompt).toMatch(/could not do as written/i);
  });
});
