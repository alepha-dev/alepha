import { describe, expect, it } from "vitest";

import { questLoopPromptDefault } from "./questLoopPrompt.ts";
import {
  type AgentPromptProjectSubject,
  renderPromptTemplate,
} from "./renderPromptTemplate.ts";

/**
 * Surface-scoped, like the two triage loops: the Quests page names no single
 * quest, so three fields and no `number`, `id`, `reference` or `title`.
 */
const subject: AgentPromptProjectSubject = {
  project: "Alepha",
  slug: "alepha",
  url: "https://lore.alepha.dev/alepha/quests",
};

describe("questLoopPromptDefault", () => {
  const prompt = renderPromptTemplate(questLoopPromptDefault, subject);

  it("renders with no item subject at all", () => {
    expect(prompt).toContain('project "Alepha"');
    expect(prompt).toContain("https://lore.alepha.dev/alepha/quests");
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
    expect(prompt).toMatch(/worktree of your own, on one branch/i);
    // Accepted before the first commit, recorded, completed when it lands.
    expect(at("`quest_accept`")).toBeLessThan(at("Commit, naming the quest"));
    expect(at("Commit, naming the quest")).toBeLessThan(
      at("`quest_commit_add`"),
    );
    expect(at("`quest_commit_add`")).toBeLessThan(at("`quest_complete`"));
    // One merge, at the end, after CI.
    expect(prompt).toMatch(/Merge the branch into main/);
    expect(at("When none is left")).toBeLessThan(
      at("Merge the branch into main"),
    );
    expect(prompt).toMatch(/delete the branch locally and on the remote/i);
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

  it("ends on a report that lists what was blocked", () => {
    expect(prompt).toMatch(/could not do as written/i);
  });
});
