import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { FolioController } from "../src/api/controllers/FolioController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { QuestController } from "../src/api/controllers/QuestController.ts";
import { LoreApi } from "../src/api/index.ts";

/**
 * The two refs endpoints a wiki-link resolves against (#Q2355).
 *
 * The resolver used to read a `[[#Q12]]` out of the picker's page of the 100
 * most recently updated quests, so an older quest rendered as a broken link.
 * It now asks for the numbers a body names. What has to hold: the answer is
 * by number and nothing else, it is scoped to the project in the path, it
 * carries two columns and never a body, and a malformed list narrows rather
 * than fails.
 */
const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

interface TestContext {
  alepha: Alepha;
  admin: AdminUserController;
  projects: ProjectController;
  quests: QuestController;
  folios: FolioController;
  fake: FakeProvider;
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
  alepha.with(LoreApi);
  await alepha.start();
  return {
    alepha,
    admin: alepha.inject(AdminUserController),
    projects: alepha.inject(ProjectController),
    quests: alepha.inject(QuestController),
    folios: alepha.inject(FolioController),
    fake: alepha.inject(FakeProvider),
  };
};

const createUser = async (ctx: TestContext) => {
  const fake = ctx.fake.generate(userDataSchema);
  const response = await ctx.admin.createUser.fetch(
    { body: { ...fake, roles: ["user"] } },
    { user: adminUser },
  );
  return { id: response.data.id, roles: response.data.roles };
};

const createProject = async (
  ctx: TestContext,
  user: { id: string },
  title: string,
) => {
  const project = await ctx.projects.createProject.fetch(
    {
      body: {
        title,
        capabilities: [{ key: "work" }, { key: "knowledge" }],
      },
    },
    { user },
  );
  return project.data.id;
};

const createQuest = async (
  ctx: TestContext,
  user: { id: string },
  projectId: number,
  title: string,
) => {
  const res = await ctx.quests.createQuest.fetch(
    {
      body: {
        projectId,
        title,
        description: "A description the refs must never carry.",
        area: "ops",
        priority: "low",
      },
    },
    { user },
  );
  return res.data;
};

const createFolio = async (
  ctx: TestContext,
  user: { id: string },
  projectId: number,
  title: string,
) => {
  const res = await ctx.folios.create.fetch(
    {
      body: { projectId, title, content: "A body the refs must never carry." },
    },
    { user },
  );
  return res.data;
};

describe("QuestController.listQuestRefs", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("answers the named quests by number, with their titles and nothing else", async ({
    expect,
  }) => {
    const user = await createUser(ctx);
    const projectId = await createProject(ctx, user, "Refs");
    const first = await createQuest(ctx, user, projectId, "Oldest quest");
    await createQuest(ctx, user, projectId, "Middle quest");
    const last = await createQuest(ctx, user, projectId, "Newest quest");

    const res = await ctx.quests.listQuestRefs.fetch(
      {
        params: { projectId },
        query: { shortIds: `${last.shortId},${first.shortId}` },
      },
      { user },
    );

    const rows = [...res.data].sort((a, b) => a.shortId - b.shortId);
    expect(rows).toEqual([
      { shortId: first.shortId, title: "Oldest quest" },
      { shortId: last.shortId, title: "Newest quest" },
    ]);
  });

  it("drops what is not a positive number, and a number no quest has", async ({
    expect,
  }) => {
    const user = await createUser(ctx);
    const projectId = await createProject(ctx, user, "Refs");
    const quest = await createQuest(ctx, user, projectId, "Only quest");

    const res = await ctx.quests.listQuestRefs.fetch(
      {
        params: { projectId },
        query: { shortIds: ` ${quest.shortId} ,abc,-2,0,1.5,,9999` },
      },
      { user },
    );

    expect(res.data).toEqual([{ shortId: quest.shortId, title: "Only quest" }]);
  });

  it("reads the project in the path, never another one's quest of the same number", async ({
    expect,
  }) => {
    const user = await createUser(ctx);
    const mine = await createProject(ctx, user, "Mine");
    const theirs = await createProject(ctx, user, "Theirs");
    await createQuest(ctx, user, theirs, "Their quest");
    const quest = await createQuest(ctx, user, mine, "My quest");

    const res = await ctx.quests.listQuestRefs.fetch(
      { params: { projectId: mine }, query: { shortIds: `${quest.shortId}` } },
      { user },
    );

    expect(res.data).toEqual([{ shortId: quest.shortId, title: "My quest" }]);
  });

  it("refuses somebody who is not a member of the project", async ({
    expect,
  }) => {
    const owner = await createUser(ctx);
    const stranger = await createUser(ctx);
    const projectId = await createProject(ctx, owner, "Private");
    await createQuest(ctx, owner, projectId, "Private quest");

    await expect(
      ctx.quests.listQuestRefs.fetch(
        { params: { projectId }, query: { shortIds: "1" } },
        { user: stranger },
      ),
    ).rejects.toThrow();
  });
});

describe("FolioController.listFolioRefs", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("answers the named folios by number, with their titles and nothing else", async ({
    expect,
  }) => {
    const user = await createUser(ctx);
    const projectId = await createProject(ctx, user, "Refs");
    const first = await createFolio(ctx, user, projectId, "First note");
    await createFolio(ctx, user, projectId, "Second note");

    const res = await ctx.folios.listFolioRefs.fetch(
      {
        params: { projectId },
        query: { shortIds: `${first.shortId},junk,4242` },
      },
      { user },
    );

    expect(res.data).toEqual([{ shortId: first.shortId, title: "First note" }]);
  });

  it("reads the project in the path, never another one's folio of the same number", async ({
    expect,
  }) => {
    const user = await createUser(ctx);
    const mine = await createProject(ctx, user, "Mine");
    const theirs = await createProject(ctx, user, "Theirs");
    await createFolio(ctx, user, theirs, "Their note");
    const folio = await createFolio(ctx, user, mine, "My note");

    const res = await ctx.folios.listFolioRefs.fetch(
      { params: { projectId: mine }, query: { shortIds: `${folio.shortId}` } },
      { user },
    );

    expect(res.data).toEqual([{ shortId: folio.shortId, title: "My note" }]);
  });

  it("refuses somebody who is not a member of the project", async ({
    expect,
  }) => {
    const owner = await createUser(ctx);
    const stranger = await createUser(ctx);
    const projectId = await createProject(ctx, owner, "Private");
    await createFolio(ctx, owner, projectId, "Private note");

    await expect(
      ctx.folios.listFolioRefs.fetch(
        { params: { projectId }, query: { shortIds: "1" } },
        { user: stranger },
      ),
    ).rejects.toThrow();
  });
});
