import { describe, expect, it } from "vitest";

import { epicActivatePromptDefault } from "./epicActivatePrompt.ts";
import {
  type AgentPromptSubject,
  renderPromptTemplate,
} from "./renderPromptTemplate.ts";

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

  it("demands a worktree and a branch, never main", () => {
    expect(prompt).toContain("git worktree");
    expect(prompt).toContain("Never on main");
  });

  it("begins a planned epic and states the frozen-plan rule", () => {
    expect(prompt).toContain("epic_set_status");
    expect(prompt).toContain('"active"');
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

  it("closes with a full verify, a merge, a conclude and an outcome folio", () => {
    expect(prompt).toContain("full verification pipeline");
    expect(prompt).toContain("Merge the branch into main and push");
    expect(prompt).toContain('epic_set_status` "done"');
    expect(prompt).toContain("folio_create");
    expect(prompt).toContain("`epic_number` 41");
  });

  it("says to stop and comment rather than guess", () => {
    expect(prompt).toContain(
      "Do not guess at a decision that is the owner's to make",
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
