import { Alepha } from "alepha";
import { AlephaApiUsers, UserService } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake } from "alepha/fake";
import { AlephaMcp } from "alepha/mcp";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity, currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { describe, expect, it } from "vitest";

import { EpicController } from "../src/api/controllers/EpicController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { LoreApi } from "../src/api/index.ts";
import { LoreMcp } from "../src/mcp/index.ts";
import { QuestTools } from "../src/mcp/tools/QuestTools.ts";

/**
 * Finding 3 of the whole-branch review: `quest_list` and `quest_get` used to
 * be silent about WHICH epic a quest belongs to and whether that epic is
 * planned. A result mixing a planned epic's quests with released ones read
 * as undifferentiated noise. This guards that both tools carry
 * `{ number, title, status }` for the quest's epic.
 *
 * Since epic #31, `quest_list` hides a planned epic's quests by default,
 * like the UI does; the stamping is asserted through `includePlanned: true`,
 * which is what brings them back. `quest_get` is direct addressing and
 * always resolves.
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
  const epicController = alepha.inject(EpicController);
  const projectApi = alepha.inject(ProjectController);
  const users = alepha.inject(UserService);
  await alepha.start();

  const owner = await users.createUser({ username: "owner" });
  const OWNER = owner.id;

  // Same identity-injection shim as `blight-tools.spec.ts`: `execute()`
  // reads the caller off the request context, not an argument, so the call
  // has to run inside one with the user seeded exactly where `$secure`
  // looks.
  const asUser = <R>(userId: string, fn: () => R): R =>
    alepha.context.run(() => {
      alepha.store.set(currentUserAtom, { id: userId, roles: ["user"] } as any);
      return fn();
    });

  // mirrors blight-tools.spec.ts's own tool-execute helper
  const call = (tool: any, params: Record<string, unknown>, userId = OWNER) =>
    asUser(userId, () => tool.execute(params));

  const project = await asUser(OWNER, () =>
    projectApi.createProject({ body: { title: "Test" } } as any),
  );

  const plannedEpic = await asUser(OWNER, () =>
    epicController.createEpic({
      params: { projectId: project.id },
      body: { title: "Deploy pipeline" },
    }),
  );

  const quest = await call(questTools.quest_create, {
    project: project.id,
    title: "Wire the pipeline",
    description: "x",
    area: "core",
    priority: "medium",
    epic_number: plannedEpic.number,
  });

  return { questTools, project, plannedEpic, quest, call };
};

describe("Lore MCP — quest_list / quest_get carry the quest's epic", () => {
  it("quest_list stamps a planned-epic quest with its epic and that epic's status", async () => {
    const { questTools, project, plannedEpic, quest, call } = await setup();

    // Hidden by default, present once asked for: the default is the UI's.
    const gated = await call(questTools.quest_list, { project: project.id });
    expect(gated.quests.find((q: any) => q.id === quest.id)).toBeUndefined();

    const res = await call(questTools.quest_list, {
      project: project.id,
      includePlanned: true,
    });

    const listed = res.quests.find((q: any) => q.id === quest.id);
    expect(listed).toBeDefined();
    expect(listed.epic).toEqual({
      number: plannedEpic.number,
      title: "Deploy pipeline",
      status: "planned",
    });
  });

  it("quest_get resolves the quest's epic regardless of the epic's status", async () => {
    const { questTools, plannedEpic, quest, call } = await setup();

    const res = await call(questTools.quest_get, { id: quest.id });

    expect(res.epic).toEqual({
      number: plannedEpic.number,
      title: "Deploy pipeline",
      status: "planned",
    });
  });

  it("omits epic entirely for a quest filed under no epic", async () => {
    const { questTools, project, call } = await setup();

    const unfiled = await call(questTools.quest_create, {
      project: project.id,
      title: "Standalone quest",
      description: "x",
      area: "core",
      priority: "medium",
    });

    const listRes = await call(questTools.quest_list, { project: project.id });
    const listed = listRes.quests.find((q: any) => q.id === unfiled.id);
    expect(listed.epic).toBeUndefined();

    const getRes = await call(questTools.quest_get, { id: unfiled.id });
    expect(getRes.epic).toBeUndefined();
  });
});
