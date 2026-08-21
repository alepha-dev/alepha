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
import { LoreApi } from "../src/api/index.ts";
import { LoreMcp } from "../src/mcp/index.ts";
import { QuestTools } from "../src/mcp/tools/QuestTools.ts";

/**
 * Objective ids over MCP: they have to survive a `quest_update` replace, and
 * ticking one must not mean resending the whole array.
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

  // mirrors quest-tools-comments.spec.ts's own tool-execute helper
  const call = (tool: any, params: Record<string, unknown>, userId = OWNER) =>
    asUser(userId, () => tool.execute(params));

  const project = await asUser(OWNER, () =>
    projectApi.createProject({ body: { title: "Test" } } as any),
  );

  const quest = await call(questTools.quest_create, {
    project: project.id,
    title: "Wire the pipeline",
    description: "x",
    area: "core",
    priority: "medium",
    objectives: [
      { title: "Parse", completed: false },
      { title: "Lay out", completed: false },
      { title: "Emit", completed: false },
    ],
    accept: true,
  });

  return { questTools, project, quest, call, OWNER };
};

describe("Lore MCP: quest objectives", () => {
  it("hands out an id for every objective", async () => {
    const { questTools, project, quest, call } = await setup();

    const res = await call(questTools.quest_get, { id: quest.id });
    expect(res.objectives.map((o: any) => o.title)).toEqual([
      "Parse",
      "Lay out",
      "Emit",
    ]);
    for (const objective of res.objectives) {
      expect(typeof objective.id).toBe("number");
    }

    // Summary rows carry the counts, not the objectives themselves.
    const summary = await call(questTools.quest_list, { project: project.id });
    expect(summary.quests[0].objectives).toBeUndefined();
    expect(summary.quests[0].objectivesProgress).toEqual({
      completed: 0,
      waived: 0,
      total: 3,
    });

    const list = await call(questTools.quest_list, {
      project: project.id,
      detail: "full",
    });
    expect(list.quests[0].objectives.every((o: any) => o.id != null)).toBe(
      true,
    );
  });

  it("keeps ids across a quest_update replace instead of renumbering", async () => {
    const { questTools, quest, call } = await setup();

    const before = await call(questTools.quest_get, { id: quest.id });
    const [parse, layout, emit] = before.objectives;

    // Drop the middle one and reword the last: the classic shape that used
    // to shift every id down by one.
    await call(questTools.quest_update, {
      id: quest.id,
      objectives: [
        { id: parse.id, title: "Parse", completed: false },
        { id: emit.id, title: "Emit SVG", completed: false },
        { title: "Wire it in", completed: false },
      ],
    });

    const after = await call(questTools.quest_get, { id: quest.id });
    expect(after.objectives.map((o: any) => [o.id, o.title])).toEqual([
      [parse.id, "Parse"],
      [emit.id, "Emit SVG"],
      // The one with no id given is new, and takes an id nobody had.
      [expect.any(Number), "Wire it in"],
    ]);
    const fresh = after.objectives[2].id;
    expect(fresh).not.toBe(parse.id);
    expect(fresh).not.toBe(layout.id);
    expect(fresh).not.toBe(emit.id);
  });

  it("quest_objective_set ticks one objective and is idempotent", async () => {
    const { questTools, quest, call } = await setup();

    const before = await call(questTools.quest_get, { id: quest.id });
    const target = before.objectives[1];

    const first = await call(questTools.quest_objective_set, {
      id: quest.id,
      objectiveId: target.id,
      completed: true,
    });
    expect(
      first.objectives.find((o: any) => o.id === target.id).completed,
    ).toBe(true);
    // The others are untouched: this is the whole point against a replace.
    expect(first.objectives.filter((o: any) => o.completed)).toHaveLength(1);

    // Set, not toggle. A retry after a dropped response must not untick it.
    const again = await call(questTools.quest_objective_set, {
      id: quest.id,
      objectiveId: target.id,
      completed: true,
    });
    expect(
      again.objectives.find((o: any) => o.id === target.id).completed,
    ).toBe(true);

    const off = await call(questTools.quest_objective_set, {
      id: quest.id,
      objectiveId: target.id,
      completed: false,
    });
    expect(off.objectives.find((o: any) => o.id === target.id).completed).toBe(
      false,
    );
  });

  it("refuses an objective id the quest does not carry", async () => {
    const { questTools, quest, call } = await setup();

    await expect(
      call(questTools.quest_objective_set, {
        id: quest.id,
        objectiveId: 999,
        completed: true,
      }),
    ).rejects.toThrowError(/not found/i);
  });
});
