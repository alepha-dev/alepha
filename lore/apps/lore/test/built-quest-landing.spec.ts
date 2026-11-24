import { QuestService } from "@lore/plan/api";
import { LiveQuestController } from "@lore/ship/api";
import { DateTimeProvider } from "alepha/datetime";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  type AutomationWorld,
  automationWorld,
} from "./fixtures/automationWorld.ts";

/**
 * A built quest completes when a commit naming it reaches the default
 * branch (#Q4234): the commit push CI makes there, never a forge Lore
 * watches. Only a quest an automation built is touched, and its workspace
 * goes with it.
 */
describe("a built quest completes on its merge", () => {
  let w: AutomationWorld;
  beforeEach(async () => {
    w = await automationWorld();
    w.alepha.inject(DateTimeProvider).pause();
  });
  afterEach(async () => {
    await w.stop();
  });

  const sha = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
  const push = (numbers: number[], branch?: string, defaultBranch?: string) =>
    w.alepha.inject(LiveQuestController).pushCommitQuests.run(
      {
        params: { projectId: w.projectId },
        body: {
          commitSha: sha,
          quests: { version: 1, numbers, complete: true },
          walked: [sha],
          ...(branch ? { branch } : {}),
          ...(defaultBranch ? { defaultBranch } : {}),
        },
      },
      { user: w.owner },
    );
  /**
   * A quest the build automation built: its job started, then the quest
   * accepted and its pull request recorded, as the job would.
   */
  const built = async (title: string) => {
    const quest = await w.alepha.inject(QuestService).createQuest({
      projectId: w.projectId,
      title,
      description: `${title}.`,
      area: "web",
      createdBy: w.owner.id,
      objectives: [{ id: 0, title: "Do it", completed: false }],
    } as never);
    const out = await w.controller.runProjectAutomation.run(
      { params: { projectId: w.projectId, automation: "build" } },
      { user: w.owner },
    );
    await w.finish(out.jobIds[0]!);
    await w.repos.quests.updateById(quest.id, {
      acceptedAt: new Date().toISOString(),
      acceptedBy: w.owner.id,
      pullRequests: [
        {
          url: "https://github.com/acme/app/pull/7",
          number: 7,
          at: new Date().toISOString(),
          by: w.owner.id,
        },
      ],
    } as never);
    return w.repos.quests.getOne({ where: { id: { eq: quest.id } } });
  };
  const handWorked = async (title: string) => {
    const quest = await w.alepha.inject(QuestService).createQuest({
      projectId: w.projectId,
      title,
      description: `${title}.`,
      area: "web",
      createdBy: w.owner.id,
      tags: ["needs-human"],
    } as never);
    await w.repos.quests.updateById(quest.id, {
      acceptedAt: new Date().toISOString(),
      acceptedBy: w.owner.id,
    } as never);
    return quest;
  };
  const reread = (id: number) =>
    w.repos.quests.getOne({ where: { id: { eq: id } } });

  beforeEach(async () => {
    await w.controller.createProjectAutomation.run(
      {
        params: { projectId: w.projectId },
        body: { name: "build", promptKind: "build" },
      },
      { user: w.owner },
    );
  });

  it("completes a built quest its commit names on the default branch, naming the commit and the pull request, and removes its workspace", async ({
    expect,
  }) => {
    const quest = await built("Fix the save button");
    const answer = await push([quest.shortId], "main");
    expect(answer).toMatchObject({ count: 1, landed: true });

    const done = await reread(quest.id);
    expect(done.completedAt).toBeDefined();
    expect(done.completedBy).toBe(w.owner.id);
    expect(done.completionMessage).toContain(sha.slice(0, 12));
    expect(done.completionMessage).toContain(
      "https://github.com/acme/app/pull/7",
    );
    expect(done.commits?.map((commit) => commit.sha)).toContain(sha);
    expect(done.objectives[0]?.waivedReason).toContain("reached main");

    const removals = await w.repos.commands.findMany({
      where: { kind: { eq: "job-workspace-remove" } },
    });
    expect(
      removals.some(
        (command) =>
          (command.payload as { workspace?: string }).workspace ===
          `q${quest.shortId}`,
      ),
    ).toBe(true);
  });

  it("never completes a quest no automation built", async ({ expect }) => {
    const quest = await handWorked("Rotate the signing keys");
    await push([quest.shortId], "main");
    expect((await reread(quest.id)).completedAt).toBeUndefined();
  });

  it("completes nothing from another branch, and follows the default branch the push names", async ({
    expect,
  }) => {
    const quest = await built("Fix the export");
    expect((await push([quest.shortId], "feature/export")).landed).toBe(false);
    expect((await push([quest.shortId])).landed).toBe(false);
    expect((await push([quest.shortId], "main", "trunk")).landed).toBe(false);
    expect((await reread(quest.id)).completedAt).toBeUndefined();

    expect((await push([quest.shortId], "trunk", "trunk")).landed).toBe(true);
    expect((await reread(quest.id)).completedAt).toBeDefined();
  });
});
