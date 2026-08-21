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
 * `expectedUpdatedAt`: an agent must not silently overwrite an edit the
 * owner made thirty seconds earlier.
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
  const epicApi = alepha.inject(EpicController);
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
    title: "Wire the pipeline",
    description: "x",
    area: "core",
    priority: "medium",
  });

  return { questTools, epicApi, project, quest, call, asUser, OWNER };
};

describe("Lore MCP: quest_update optimistic concurrency", () => {
  it("accepts an update carrying the updatedAt it just read", async () => {
    const { questTools, quest, call } = await setup();

    const read = await call(questTools.quest_get, { id: quest.id });
    const result = await call(questTools.quest_update, {
      id: quest.id,
      title: "Wire the pipeline properly",
      expectedUpdatedAt: read.updatedAt,
    });

    expect(result.title).toBe("Wire the pipeline properly");
    // The fresh token, so a chain of writes needs no extra quest_get.
    expect(result.updatedAt).not.toBe(read.updatedAt);
  });

  it("refuses a second write carrying the same stale token, and keeps the first", async () => {
    const { questTools, quest, call } = await setup();

    const read = await call(questTools.quest_get, { id: quest.id });

    await call(questTools.quest_update, {
      id: quest.id,
      title: "First writer wins",
      expectedUpdatedAt: read.updatedAt,
    });

    await expect(
      call(questTools.quest_update, {
        id: quest.id,
        title: "Second writer overwrites",
        expectedUpdatedAt: read.updatedAt,
      }),
    ).rejects.toThrowError(/changed since you read it/i);

    const after = await call(questTools.quest_get, { id: quest.id });
    expect(after.title).toBe("First writer wins");
  });

  it("stays last-write-wins when the token is omitted", async () => {
    const { questTools, quest, call } = await setup();

    const read = await call(questTools.quest_get, { id: quest.id });
    await call(questTools.quest_update, {
      id: quest.id,
      title: "First",
      expectedUpdatedAt: read.updatedAt,
    });

    // No token: the caller is deliberately choosing last-write-wins, and
    // every client that predates the parameter is in this case.
    await call(questTools.quest_update, { id: quest.id, title: "Second" });

    const after = await call(questTools.quest_get, { id: quest.id });
    expect(after.title).toBe("Second");
  });

  it("does not trip over its own epic move", async () => {
    const { questTools, epicApi, project, quest, call, asUser, OWNER } =
      await setup();

    const epic = await asUser(OWNER, () =>
      epicApi.createEpic({
        params: { projectId: project.id },
        body: { title: "Lore MCP v2", description: "x" },
      } as any),
    );

    // Filing into an epic writes `epicId`, which stamps `updatedAt` before
    // the field update runs. Without the tool checking up front this would
    // 409 against a change this very call made.
    const read = await call(questTools.quest_get, { id: quest.id });
    const result = await call(questTools.quest_update, {
      id: quest.id,
      title: "Filed",
      epic_number: epic.number,
      expectedUpdatedAt: read.updatedAt,
    });

    expect(result.title).toBe("Filed");
    const after = await call(questTools.quest_get, { id: quest.id });
    expect(after.epic?.number).toBe(epic.number);
  });

  it("still refuses an epic move carrying a stale token", async () => {
    const { questTools, epicApi, project, quest, call, asUser, OWNER } =
      await setup();

    const epic = await asUser(OWNER, () =>
      epicApi.createEpic({
        params: { projectId: project.id },
        body: { title: "Lore MCP v2", description: "x" },
      } as any),
    );

    const read = await call(questTools.quest_get, { id: quest.id });
    await call(questTools.quest_update, { id: quest.id, title: "Moved on" });

    await expect(
      call(questTools.quest_update, {
        id: quest.id,
        epic_number: epic.number,
        expectedUpdatedAt: read.updatedAt,
      }),
    ).rejects.toThrowError(/changed since you read it/i);

    // The epic move never happened either: the check runs first.
    const after = await call(questTools.quest_get, { id: quest.id });
    expect(after.epic).toBeUndefined();
  });
});
