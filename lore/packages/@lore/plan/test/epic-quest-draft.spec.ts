import { ProjectController } from "@lore/core/api";
import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaMcp } from "alepha/mcp";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake } from "alepha/testing/faker";
import { afterEach, beforeEach, describe, it } from "vitest";

import {
  EpicController,
  EpicWorkflowService,
  LorePlanApi,
  QuestController,
} from "../src/api/index.ts";
import { LorePlanMcp, QuestTools } from "../src/mcp/index.ts";
import { WorkTestEntities } from "../src/testing/index.ts";

/**
 * An epic owns the draft of its quests (#Q4373, epic #E178). After every
 * epic and quest verb that can break it, the invariant holds: no to-do quest
 * (no `acceptedAt`, no `completedAt`) of a draft epic without `draftAt`, and
 * no quest of a ready or in-progress epic with it.
 */

interface TestContext {
  alepha: Alepha;
  epics: EpicController;
  quests: QuestController;
  tools: QuestTools;
  workflow: EpicWorkflowService;
  repos: WorkTestEntities;
  as: <R>(fn: () => R) => R;
  projectId: number;
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
  });
  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(AlephaMcp);
  alepha.with(LorePlanApi);
  alepha.with(LorePlanMcp);

  const repos = alepha.inject(WorkTestEntities);
  await alepha.start();

  const owner = await alepha.inject(UserService).createUser({
    username: "owner",
  });
  const as = <R>(fn: () => R): R =>
    alepha.context.run(() => {
      alepha.store.set(currentUserAtom, { id: owner.id, roles: ["user"] });
      return fn();
    });
  const project = await as(() =>
    alepha
      .inject(ProjectController)
      .createProject({ body: { title: "Drafts" } }),
  );

  return {
    alepha,
    epics: alepha.inject(EpicController),
    quests: alepha.inject(QuestController),
    tools: alepha.inject(QuestTools),
    workflow: alepha.inject(EpicWorkflowService),
    repos,
    as,
    projectId: project.id,
  };
};

describe("an epic owns the draft of its quests", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const newEpic = async (title = "Plan") =>
    await ctx.as(() =>
      ctx.epics.createEpic({
        params: { projectId: ctx.projectId },
        body: { title },
      }),
    );

  const newQuest = async (
    extra: { epic_number?: number; draft?: boolean; accept?: boolean } = {},
  ) =>
    await ctx.as(() =>
      ctx.tools.quest_create.execute({
        project: ctx.projectId,
        title: "Probe",
        description: "x",
        area: "core",
        priority: "medium",
        ...extra,
      }),
    );

  const setStatus = async (epicId: number, status: "draft" | "ready") =>
    await ctx.as(() =>
      ctx.epics.setEpicStatus({ params: { id: epicId }, body: { status } }),
    );

  const row = async (quest: { id: number }) =>
    await ctx.repos.quests.getById(quest.id);

  /**
   * Every quest of the project that breaks the invariant, as `#id`.
   */
  const drift = async (): Promise<string[]> => {
    const epics = await ctx.repos.epics.findMany({
      where: { projectId: { eq: ctx.projectId } },
    });
    const status = new Map(epics.map((epic) => [epic.id, epic.status]));
    const quests = await ctx.repos.quests.findMany({
      where: { projectId: { eq: ctx.projectId } },
    });
    return quests
      .filter((quest) => {
        if (quest.epicId == null) return false;
        const epic = status.get(quest.epicId);
        const open = !quest.acceptedAt && !quest.completedAt;
        if (epic === "draft") return open && !quest.draftAt;
        if (epic === "ready" || epic === "in_progress") return !!quest.draftAt;
        return false;
      })
      .map((quest) => `#${quest.id}`);
  };

  it("files a quest created into a draft epic as a draft", async ({
    expect,
  }) => {
    const epic = await newEpic();
    const quest = await newQuest({ epic_number: epic.number });

    expect((await row(quest)).draftAt).toBeDefined();
    expect(await drift()).toEqual([]);
  });

  it("marking ready releases the drafts, stamps readyAt, and draft takes them back", async ({
    expect,
  }) => {
    const epic = await newEpic();
    const a = await newQuest({ epic_number: epic.number });
    const b = await newQuest({ epic_number: epic.number });

    await setStatus(epic.id, "ready");
    expect((await row(a)).draftAt).toBeUndefined();
    expect((await row(a)).readyAt).toBeDefined();
    expect(await drift()).toEqual([]);

    await setStatus(epic.id, "draft");
    expect((await row(a)).draftAt).toBeDefined();
    expect((await row(b)).draftAt).toBeDefined();
    expect(await drift()).toEqual([]);
  });

  it("drafts the shelved and held quests of an epic marked draft, and they come back drafts", async ({
    expect,
  }) => {
    const epic = await newEpic();
    const shelved = await newQuest({ epic_number: epic.number });
    const held = await newQuest({ epic_number: epic.number });
    await setStatus(epic.id, "ready");
    await ctx.as(() => ctx.quests.shelveQuest({ params: { id: shelved.id } }));
    await ctx.as(() =>
      ctx.quests.holdQuest({
        params: { id: held.id },
        body: { reason: "waiting" },
      }),
    );

    await setStatus(epic.id, "draft");
    expect((await row(shelved)).draftAt).toBeDefined();
    expect((await row(held)).draftAt).toBeDefined();

    const back = await ctx.as(() =>
      ctx.quests.unshelveQuest({ params: { id: shelved.id } }),
    );
    const unheld = await ctx.as(() =>
      ctx.quests.unholdQuest({ params: { id: held.id } }),
    );
    expect(back.metadata.status).toBe("draft");
    expect(unheld.metadata.status).toBe("draft");
    expect(await drift()).toEqual([]);
  });

  it("leaves a completed quest alone, never giving it a readyAt it did not earn", async ({
    expect,
  }) => {
    const epic = await newEpic();
    await setStatus(epic.id, "ready");
    const done = await newQuest({ epic_number: epic.number, accept: true });
    await ctx.as(() =>
      ctx.quests.completeQuest({ params: { id: done.id }, body: {} }),
    );
    const before = await row(done);

    await ctx.alepha.inject(EpicWorkflowService).sweep();

    const after = await row(done);
    expect(after.draftAt).toBeUndefined();
    expect(after.readyAt).toEqual(before.readyAt);
  });

  it("moves a draft into a ready epic as to do, and a to-do quest into a draft epic as a draft", async ({
    expect,
  }) => {
    const draftEpic = await newEpic("Draft");
    const readyEpic = await newEpic("Ready");
    await setStatus(readyEpic.id, "ready");
    const loose = await newQuest({ draft: true });
    const plain = await newQuest();

    await ctx.as(() =>
      ctx.epics.attachQuest({
        params: { id: readyEpic.id },
        body: { questId: loose.id },
      }),
    );
    await ctx.as(() =>
      ctx.epics.attachQuest({
        params: { id: draftEpic.id },
        body: { questId: plain.id },
      }),
    );

    expect((await row(loose)).draftAt).toBeUndefined();
    expect((await row(loose)).readyAt).toBeDefined();
    expect((await row(plain)).draftAt).toBeDefined();
    expect(await drift()).toEqual([]);
  });

  it("keeps a quest leaving a draft epic a draft, unless it is held", async ({
    expect,
  }) => {
    const epic = await newEpic();
    const plain = await newQuest({ epic_number: epic.number });
    const shelved = await newQuest({ epic_number: epic.number });
    const held = await newQuest({ epic_number: epic.number });
    await ctx.as(() => ctx.quests.shelveQuest({ params: { id: shelved.id } }));
    // A held draft cannot be produced through the API: seeded.
    await ctx.repos.quests.updateById(held.id, {
      heldAt: "2026-11-28T00:00:00.000Z",
    });

    for (const quest of [plain, shelved, held]) {
      await ctx.as(() =>
        ctx.epics.detachQuest({
          params: { id: epic.id, questId: quest.id },
        }),
      );
    }

    expect((await row(plain)).draftAt).toBeDefined();
    expect((await row(shelved)).draftAt).toBeDefined();
    expect((await row(held)).draftAt).toBeUndefined();
  });

  it("brings a never-started epic's quests back from the shelf as drafts", async ({
    expect,
  }) => {
    const epic = await newEpic();
    await setStatus(epic.id, "ready");
    const quest = await newQuest({ epic_number: epic.number });

    await ctx.as(() => ctx.epics.shelveEpic({ params: { id: epic.id } }));
    await ctx.as(() => ctx.epics.unshelveEpic({ params: { id: epic.id } }));

    expect((await ctx.repos.epics.getById(epic.id)).status).toBe("draft");
    expect((await row(quest)).draftAt).toBeDefined();
    expect(await drift()).toEqual([]);
  });

  it("refuses draft: true into a ready epic before anything is written", async ({
    expect,
  }) => {
    const epic = await newEpic();
    await setStatus(epic.id, "ready");

    await expect(
      newQuest({ epic_number: epic.number, draft: true }),
    ).rejects.toThrow(
      `Cannot create a draft quest in Epic #E${epic.number}: the epic is "ready"`,
    );
    await expect(newQuest({ draft: true, accept: true })).rejects.toThrow(
      "Cannot create a quest as a draft and accept it",
    );
    expect(
      await ctx.repos.quests.findMany({
        where: { projectId: { eq: ctx.projectId } },
      }),
    ).toEqual([]);
  });

  it("answers accept on a draft epic's quest with the epic's refusal only", async ({
    expect,
  }) => {
    const epic = await newEpic();
    const quest = await newQuest({ epic_number: epic.number });

    await expect(
      ctx.as(() => ctx.quests.acceptQuest({ params: { id: quest.id } })),
    ).rejects.toThrow(
      `Cannot accept quest #Q${quest.shortId}: Epic #E${epic.number} is a draft, and not ready for development yet.`,
    );
  });

  it("the sweep heals both drifts through the draft service", async ({
    expect,
  }) => {
    const draftEpic = await newEpic("Draft");
    const readyEpic = await newEpic("Ready");
    const stale = await newQuest({ epic_number: draftEpic.number });
    const lagging = await newQuest({ epic_number: readyEpic.number });
    await setStatus(readyEpic.id, "ready");
    // The two states a split write leaves.
    await ctx.repos.quests.updateById(stale.id, { draftAt: null });
    await ctx.repos.quests.updateById(lagging.id, {
      draftAt: "2026-11-28T00:00:00.000Z",
    });
    expect(await drift()).toHaveLength(2);

    await expect(ctx.workflow.sweep()).resolves.toEqual({
      started: 0,
      completed: 0,
      drafted: 1,
      readied: 1,
    });
    expect(await drift()).toEqual([]);
  });
});
