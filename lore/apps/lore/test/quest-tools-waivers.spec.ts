import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake } from "alepha/fake";
import { AlephaMcp } from "alepha/mcp";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, expect, it } from "vitest";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { QuestController } from "../src/api/controllers/QuestController.ts";
import { LoreApi } from "../src/api/index.ts";
import { LoreMcp } from "../src/mcp/index.ts";
import { QuestTools } from "../src/mcp/tools/QuestTools.ts";

/**
 * Completing a quest whose objectives include manual work nobody automated.
 *
 * The gate used to leave two options: tick a box for work you did not do, or
 * leave a finished quest open. A waiver is the third.
 *
 * Same identity-injection shim as `quest-tools-comments.spec.ts`.
 */
const setup = async () => {
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
  alepha.with(LoreApi);
  alepha.with(LoreMcp);

  const questTools = alepha.inject(QuestTools);
  const questApi = alepha.inject(QuestController);
  const projectApi = alepha.inject(ProjectController);
  const users = alepha.inject(UserService);
  await alepha.start();

  const owner = await users.createUser({ username: "owner" });
  const OWNER = owner.id;

  const asUser = <R>(userId: string, fn: () => R): R =>
    alepha.context.run(() => {
      alepha.store.set(currentUserAtom, { id: userId, roles: ["user"] } as any);
      return fn();
    });

  // biome-ignore lint/suspicious/noExplicitAny: mirrors quest-tools-comments.spec.ts's own tool-execute helper
  const call = (tool: any, params: Record<string, unknown>, userId = OWNER) =>
    asUser(userId, () => tool.execute(params));

  const project = await asUser(OWNER, () =>
    projectApi.createProject({ body: { title: "Test" } } as any),
  );

  const quest = await call(questTools.quest_create, {
    project: project.id,
    title: "Ship the emitter",
    description: "x",
    area: "core",
    priority: "medium",
    objectives: [
      { title: "Write the emitter", completed: false },
      { title: "Walk the plateau in the live app", completed: false },
    ],
    accept: true,
  });

  const objectives = (await call(questTools.quest_get, { id: quest.id }))
    .objectives as Array<{ id: number; title: string }>;

  /** The REST resource, where `metadata` and `history` live. */
  const resource = () =>
    asUser(OWNER, () => questApi.getQuestById({ params: { id: quest.id } }));

  /** Tick the code objective, which is the one that really was done. */
  const tickFirst = () =>
    call(questTools.quest_objective_set, {
      id: quest.id,
      objectiveId: objectives[0].id,
      completed: true,
    });

  return { questTools, project, quest, objectives, call, resource, tickFirst };
};

describe("Lore MCP: completion with waived objectives", () => {
  it("completes when one objective is done and the other is waived", async () => {
    const { questTools, quest, objectives, call, tickFirst } = await setup();
    const manual = objectives[1];
    await tickFirst();

    const done = await call(questTools.quest_complete, {
      id: quest.id,
      message: "Emitter shipped.",
      waive: [
        {
          objectiveId: manual.id,
          reason: "manual step, the owner walks it in the live app",
        },
      ],
    });
    expect(done.completedAt).toBeTruthy();

    const after = await call(questTools.quest_get, { id: quest.id });
    const waived = after.objectives.find((o: any) => o.id === manual.id);

    // The whole point: it stays UNTICKED and carries the reason instead.
    expect(waived.completed).toBe(false);
    expect(waived.waivedReason).toBe(
      "manual step, the owner walks it in the live app",
    );
    expect(waived.waivedAt).toBeTruthy();
  });

  it("still refuses when an objective is neither ticked nor waived", async () => {
    const { questTools, quest, call, tickFirst } = await setup();
    await tickFirst();

    await expect(
      call(questTools.quest_complete, { id: quest.id, message: "done" }),
    ).rejects.toThrowError(/neither completed nor waived/i);

    // And nothing was written on the way out.
    const after = await call(questTools.quest_get, { id: quest.id });
    expect(after.completedAt).toBeUndefined();
  });

  it("counts a waived objective as neither completed nor open", async () => {
    const { questTools, quest, objectives, call, resource, tickFirst } =
      await setup();
    await tickFirst();

    await call(questTools.quest_complete, {
      id: quest.id,
      waive: [{ objectiveId: objectives[1].id, reason: "manual" }],
    });

    const after = await resource();
    expect(after.metadata.objectivesProgress).toEqual({
      completed: 1,
      waived: 1,
      total: 2,
    });
  });

  it("records one objective_waived history entry per waiver", async () => {
    const { questTools, quest, objectives, call, resource, tickFirst } =
      await setup();
    await tickFirst();

    await call(questTools.quest_complete, {
      id: quest.id,
      waive: [{ objectiveId: objectives[1].id, reason: "manual" }],
    });

    const waivedEvents = (await resource()).history.filter(
      (h) => h.action === "objective_waived",
    );
    expect(waivedEvents).toHaveLength(1);
    expect(waivedEvents[0].objectiveId).toBe(objectives[1].id);
    expect(waivedEvents[0].by).toBeTruthy();
  });

  it("refuses to waive an objective that is already ticked", async () => {
    const { questTools, quest, objectives, call, tickFirst } = await setup();
    await tickFirst();

    await expect(
      call(questTools.quest_complete, {
        id: quest.id,
        waive: [
          { objectiveId: objectives[0].id, reason: "no" },
          { objectiveId: objectives[1].id, reason: "manual" },
        ],
      }),
    ).rejects.toThrowError(/already completed/i);
  });

  it("refuses to waive an objective the quest does not carry", async () => {
    const { questTools, quest, call, tickFirst } = await setup();
    await tickFirst();

    await expect(
      call(questTools.quest_complete, {
        id: quest.id,
        waive: [{ objectiveId: 999, reason: "manual" }],
      }),
    ).rejects.toThrowError(/no such objective/i);
  });
});
