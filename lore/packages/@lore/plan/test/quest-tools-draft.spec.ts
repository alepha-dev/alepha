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

import { EpicController, LorePlanApi } from "../src/api/index.ts";
import { LorePlanMcp, QuestTools } from "../src/mcp/index.ts";
import { WorkTestEntities } from "../src/testing/index.ts";

/**
 * The draft status over MCP (#Q4378, epic #E178): `quest_list` names it,
 * `quest_create` files one, `quest_ready` and `quest_draft` move a loose
 * quest between `draft` and `todo`, and every verb that would take a draft
 * says what to call instead.
 */

interface TestContext {
  alepha: Alepha;
  tools: QuestTools;
  epics: EpicController;
  repos: WorkTestEntities;
  as: <R>(fn: () => R) => R;
  call: (tool: { execute: (params: any) => any }, params: object) => any;
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
    tools: alepha.inject(QuestTools),
    epics: alepha.inject(EpicController),
    repos,
    as,
    call: (tool, params) => as(() => tool.execute(params)),
    projectId: project.id,
  };
};

describe("the draft status over MCP", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const create = async (
    title: string,
    extra: { draft?: boolean; epic_number?: number; accept?: boolean } = {},
  ) =>
    await ctx.call(ctx.tools.quest_create, {
      project: ctx.projectId,
      title,
      description: "x",
      area: "core",
      priority: "medium",
      ...extra,
    });

  const newEpic = async (status: "draft" | "ready" = "draft") => {
    const epic = await ctx.as(() =>
      ctx.epics.createEpic({
        params: { projectId: ctx.projectId },
        body: { title: "Plan" },
      }),
    );
    if (status === "ready") {
      await ctx.as(() =>
        ctx.epics.setEpicStatus({
          params: { id: epic.id },
          body: { status: "ready" },
        }),
      );
    }
    return epic;
  };

  const titles = async (params: object = {}) =>
    (
      await ctx.call(ctx.tools.quest_list, {
        project: ctx.projectId,
        ...params,
      })
    ).quests.map((quest: { title: string }) => quest.title);

  describe("quest_list", () => {
    it('leaves drafts out by default and lists them with status: "draft"', async ({
      expect,
    }) => {
      await create("Ready work");
      await create("Found in passing", { draft: true });

      expect(await titles()).toEqual(["Ready work"]);
      expect(await titles({ loose: true })).toEqual(["Ready work"]);
      expect(await titles({ status: "draft" })).toEqual(["Found in passing"]);
      expect(await titles({ status: "draft", loose: true })).toEqual([
        "Found in passing",
      ]);
      expect(await titles({ status: "todo" })).toEqual(["Ready work"]);
    });

    it("returns an epic's drafts when the epic is named", async ({
      expect,
    }) => {
      const epic = await newEpic();
      await create("Specified", { epic_number: epic.number });

      expect(await titles()).toEqual([]);
      expect(await titles({ epic: epic.id })).toEqual(["Specified"]);
      expect(await titles({ epics: [epic.id] })).toEqual(["Specified"]);
      const [row] = (
        await ctx.call(ctx.tools.quest_list, {
          project: ctx.projectId,
          epic: epic.id,
        })
      ).quests;
      expect(row.status).toBe("draft");
      expect(row.epic.status).toBe("draft");
    });
  });

  describe("quest_create", () => {
    it("files a draft, which quest_get reads as one", async ({ expect }) => {
      const quest = await create("Later", { draft: true });

      const got = await ctx.call(ctx.tools.quest_get, { id: quest.id });
      expect(got.status).toBe("draft");
      expect(got.readyAt).toBeUndefined();
    });

    it("says in its result the status the quest ends with", async ({
      expect,
    }) => {
      const draftEpic = await newEpic();
      const readyEpic = await newEpic("ready");

      const plain = await create("Plain");
      const asked = await create("Asked", { draft: true });
      const filed = await create("Filed", { epic_number: draftEpic.number });
      const refused = await create("Refused", {
        epic_number: draftEpic.number,
        accept: true,
      });
      const taken = await create("Taken", {
        epic_number: readyEpic.number,
        accept: true,
      });

      expect(plain.status).toBe("todo");
      expect(asked.status).toBe("draft");
      expect(filed.status).toBe("draft");
      expect(refused.status).toBe("draft");
      expect(refused.acceptNote).toBeDefined();
      expect(taken.status).toBe("in_progress");
    });

    it("refuses draft with accept before anything is written", async ({
      expect,
    }) => {
      await expect(
        create("Both", { draft: true, accept: true }),
      ).rejects.toThrow("Cannot create a quest as a draft and accept it");
      expect(
        await ctx.repos.quests.findMany({
          where: { projectId: { eq: ctx.projectId } },
        }),
      ).toEqual([]);
    });
  });

  describe("quest_ready", () => {
    it("makes a loose draft to do, stamps readyAt, and converges on a retry", async ({
      expect,
    }) => {
      const quest = await create("Later", { draft: true });

      const ready = await ctx.call(ctx.tools.quest_ready, { id: quest.id });
      expect(ready.status).toBe("todo");
      expect(ready.readyAt).toBeDefined();

      const again = await ctx.call(ctx.tools.quest_ready, { id: quest.id });
      expect(again.status).toBe("todo");

      const got = await ctx.call(ctx.tools.quest_get, { id: quest.id });
      expect(got.readyAt).toBe(ready.readyAt);
      const [row] = (
        await ctx.call(ctx.tools.quest_list, { project: ctx.projectId })
      ).quests;
      expect(row.status).toBe("todo");
      expect(row.readyAt).toBe(ready.readyAt);
    });

    it("accepts the quest's shortId with its project", async ({ expect }) => {
      const quest = await create("Later", { draft: true });

      const ready = await ctx.call(ctx.tools.quest_ready, {
        project: ctx.projectId,
        shortId: quest.shortId,
      });
      expect(ready.status).toBe("todo");
    });

    it("refuses a quest that is not a draft", async ({ expect }) => {
      const quest = await create("Taken", { accept: true });

      await expect(
        ctx.call(ctx.tools.quest_ready, { id: quest.id }),
      ).rejects.toThrow(`Cannot mark quest #Q${quest.shortId} ready`);
    });

    it("refuses an epic's quest, naming the epic and epic_set_status", async ({
      expect,
    }) => {
      const epic = await newEpic();
      const quest = await create("Specified", { epic_number: epic.number });

      await expect(
        ctx.call(ctx.tools.quest_ready, { id: quest.id }),
      ).rejects.toThrow(
        `Cannot mark quest #Q${quest.shortId} ready: it belongs to Epic #E${epic.number}`,
      );
      await expect(
        ctx.call(ctx.tools.quest_ready, { id: quest.id }),
      ).rejects.toThrow("epic_set_status");
      expect((await ctx.repos.quests.getById(quest.id)).draftAt).toBeDefined();
    });
  });

  describe("quest_draft", () => {
    it("makes a loose to-do quest a draft, and converges on a retry", async ({
      expect,
    }) => {
      const quest = await create("Not yet");

      const drafted = await ctx.call(ctx.tools.quest_draft, { id: quest.id });
      expect(drafted.status).toBe("draft");
      const again = await ctx.call(ctx.tools.quest_draft, { id: quest.id });
      expect(again.status).toBe("draft");
      expect(await titles()).toEqual([]);
    });

    it("refuses a quest somebody took", async ({ expect }) => {
      const quest = await create("Taken", { accept: true });

      await expect(
        ctx.call(ctx.tools.quest_draft, { id: quest.id }),
      ).rejects.toThrow(
        `Cannot mark quest #Q${quest.shortId} draft: it is "in_progress"`,
      );
    });

    it("refuses an epic's quest, naming the epic and epic_set_status", async ({
      expect,
    }) => {
      const epic = await newEpic("ready");
      const quest = await create("Released", { epic_number: epic.number });

      await expect(
        ctx.call(ctx.tools.quest_draft, { id: quest.id }),
      ).rejects.toThrow(
        `Cannot mark quest #Q${quest.shortId} draft: it belongs to Epic #E${epic.number}`,
      );
      await expect(
        ctx.call(ctx.tools.quest_draft, { id: quest.id }),
      ).rejects.toThrow("epic_set_status");
      expect((await ctx.repos.quests.getById(quest.id)).draftAt).toBeFalsy();
    });
  });

  describe("the verbs a draft refuses", () => {
    it("quest_accept and quest_hold say to mark it ready first", async ({
      expect,
    }) => {
      const quest = await create("Later", { draft: true });

      await expect(
        ctx.call(ctx.tools.quest_accept, { id: quest.id }),
      ).rejects.toThrow(
        `Cannot accept quest #Q${quest.shortId}: it is a draft, not ready to be taken. Mark it ready first (quest_ready`,
      );
      await expect(
        ctx.call(ctx.tools.quest_hold, { id: quest.id, reason: "waiting" }),
      ).rejects.toThrow(
        `Cannot hold quest #Q${quest.shortId}: it is a draft, not ready to be taken. Mark it ready first (quest_ready`,
      );
    });

    it("quest_unshelve brings a shelved draft back as a draft", async ({
      expect,
    }) => {
      const quest = await create("Later", { draft: true });
      await ctx.call(ctx.tools.quest_shelve, { id: quest.id });

      await expect(
        ctx.call(ctx.tools.quest_accept, { id: quest.id }),
      ).rejects.toThrow("it is a shelved draft");
      const back = await ctx.call(ctx.tools.quest_unshelve, { id: quest.id });
      expect(back.status).toBe("draft");
    });
  });

  describe("quest_update", () => {
    it("reports the status an epic move left the quest in", async ({
      expect,
    }) => {
      const draftEpic = await newEpic();
      const readyEpic = await newEpic("ready");
      const quest = await create("Mover");

      const into = await ctx.call(ctx.tools.quest_update, {
        id: quest.id,
        epic_number: draftEpic.number,
      });
      expect(into.status).toBe("draft");

      const out = await ctx.call(ctx.tools.quest_update, {
        id: quest.id,
        epic_number: 0,
      });
      expect(out.status).toBe("draft");

      const released = await ctx.call(ctx.tools.quest_update, {
        id: quest.id,
        epic_number: readyEpic.number,
      });
      expect(released.status).toBe("todo");

      const withToken = await ctx.call(ctx.tools.quest_update, {
        id: quest.id,
        epic_number: 0,
        title: "Mover, renamed",
        expectedUpdatedAt: released.updatedAt,
      });
      expect(withToken.status).toBe("todo");
    });
  });
});
