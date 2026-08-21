import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DirectoryController } from "../src/api/controllers/DirectoryController.ts";
import { FolioController } from "../src/api/controllers/FolioController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { LoreApi } from "../src/api/index.ts";
import { FolioLinkService } from "../src/api/services/FolioLinkService.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  projectController: ProjectController;
  directoryController: DirectoryController;
  folioController: FolioController;
  folioLinkService: FolioLinkService;
  fakeProvider: FakeProvider;
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
    adminUserController: alepha.inject(AdminUserController),
    projectController: alepha.inject(ProjectController),
    directoryController: alepha.inject(DirectoryController),
    folioController: alepha.inject(FolioController),
    folioLinkService: alepha.inject(FolioLinkService),
    fakeProvider: alepha.inject(FakeProvider),
  };
};

const createTestUser = async (ctx: TestContext) => {
  const fakeUser = ctx.fakeProvider.generate(userDataSchema);
  const r = await ctx.adminUserController.createUser.fetch(
    { body: { ...fakeUser, roles: ["user"] } },
    { user: adminUser },
  );
  return { id: r.data.id, roles: r.data.roles };
};

describe("FolioLinkService.tidyStalePaths (#108)", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setup();
  });
  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const writeUpdates = async (
    cid: number,
    user: { id: string; roles: string[] },
  ): Promise<Awaited<ReturnType<FolioLinkService["tidyStalePaths"]>>> =>
    ctx.folioLinkService.tidyStalePaths(cid, {
      dryRun: false,
      updateContent: async (id, content) => {
        await ctx.folioController.update.fetch(
          { params: { id }, body: { content } },
          { user },
        );
      },
    });

  it("rewrites path token to bare title after target moves to root", async () => {
    const owner = await createTestUser(ctx);
    const c = await ctx.projectController.createProject.fetch(
      { body: { title: "Tidy A" } },
      { user: owner },
    );
    const cid = c.data.id;
    const specs = await ctx.directoryController.createDirectory.fetch(
      { params: { projectId: cid }, body: { name: "specs" } },
      { user: owner },
    );
    const strategy = await ctx.directoryController.createDirectory.fetch(
      {
        params: { projectId: cid },
        body: { name: "strategy", parentId: specs.data.id },
      },
      { user: owner },
    );
    const roadmap = await ctx.folioController.create.fetch(
      {
        body: {
          projectId: cid,
          title: "roadmap",
          directoryId: strategy.data.id,
          content: "",
        },
      },
      { user: owner },
    );
    const source = await ctx.folioController.create.fetch(
      {
        body: {
          projectId: cid,
          title: "intro",
          content: "See [[specs/strategy/roadmap]] for details.",
        },
      },
      { user: owner },
    );

    // Move roadmap to project root.
    await ctx.folioController.update.fetch(
      { params: { id: roadmap.data.id }, body: { directoryId: null } },
      { user: owner },
    );

    const result = await writeUpdates(cid, owner);
    expect(result.rewritten).toBe(1);
    expect(result.changes[0].folioShortId).toBe(source.data.shortId);
    expect(result.changes[0].tokens).toEqual([
      { before: "specs/strategy/roadmap", after: "roadmap", count: 1 },
    ]);

    const fresh = await ctx.folioController.getByShortId.fetch(
      { params: { projectId: cid, shortId: source.data.shortId } },
      { user: owner },
    );
    expect(fresh.data.content).toBe("See [[roadmap]] for details.");
  });

  it("rewrites path token to new chain after target moves between dirs", async () => {
    const owner = await createTestUser(ctx);
    const c = await ctx.projectController.createProject.fetch(
      { body: { title: "Tidy B" } },
      { user: owner },
    );
    const cid = c.data.id;
    const specs = await ctx.directoryController.createDirectory.fetch(
      { params: { projectId: cid }, body: { name: "specs" } },
      { user: owner },
    );
    const strategy = await ctx.directoryController.createDirectory.fetch(
      {
        params: { projectId: cid },
        body: { name: "strategy", parentId: specs.data.id },
      },
      { user: owner },
    );
    const planning = await ctx.directoryController.createDirectory.fetch(
      { params: { projectId: cid }, body: { name: "planning" } },
      { user: owner },
    );
    const roadmap = await ctx.folioController.create.fetch(
      {
        body: {
          projectId: cid,
          title: "roadmap",
          directoryId: strategy.data.id,
          content: "",
        },
      },
      { user: owner },
    );
    const source = await ctx.folioController.create.fetch(
      {
        body: {
          projectId: cid,
          title: "intro",
          content:
            "Top [[specs/strategy/roadmap]] and again [[specs/strategy/roadmap#milestones]].",
        },
      },
      { user: owner },
    );

    // Move roadmap to /planning.
    await ctx.folioController.update.fetch(
      {
        params: { id: roadmap.data.id },
        body: { directoryId: planning.data.id },
      },
      { user: owner },
    );

    const result = await writeUpdates(cid, owner);
    expect(result.rewritten).toBe(1);
    const tokens = result.changes[0].tokens;
    // Two distinct stale `before` strings (with and without anchor) —
    // each rewritten once.
    expect(tokens).toEqual(
      expect.arrayContaining([
        {
          before: "specs/strategy/roadmap",
          after: "planning/roadmap",
          count: 1,
        },
        {
          before: "specs/strategy/roadmap#milestones",
          after: "planning/roadmap#milestones",
          count: 1,
        },
      ]),
    );

    const fresh = await ctx.folioController.getByShortId.fetch(
      { params: { projectId: cid, shortId: source.data.shortId } },
      { user: owner },
    );
    expect(fresh.data.content).toBe(
      "Top [[planning/roadmap]] and again [[planning/roadmap#milestones]].",
    );
  });

  it("leaves dangling tokens, quest tokens, and #N tokens untouched", async () => {
    const owner = await createTestUser(ctx);
    const c = await ctx.projectController.createProject.fetch(
      { body: { title: "Tidy C" } },
      { user: owner },
    );
    const cid = c.data.id;
    const roadmap = await ctx.folioController.create.fetch(
      {
        body: { projectId: cid, title: "roadmap", content: "" },
      },
      { user: owner },
    );
    const source = await ctx.folioController.create.fetch(
      {
        body: {
          projectId: cid,
          title: "intro",
          content: `Dangling [[no/such/thing]], quest [[quest:#1]], shortId [[#${roadmap.data.shortId}]].`,
        },
      },
      { user: owner },
    );

    const result = await writeUpdates(cid, owner);
    expect(result.rewritten).toBe(0);

    const fresh = await ctx.folioController.getByShortId.fetch(
      { params: { projectId: cid, shortId: source.data.shortId } },
      { user: owner },
    );
    expect(fresh.data.content).toContain("[[no/such/thing]]");
    expect(fresh.data.content).toContain("[[quest:#1]]");
    expect(fresh.data.content).toContain(`[[#${roadmap.data.shortId}]]`);
  });

  it("dryRun: returns changes but does not persist", async () => {
    const owner = await createTestUser(ctx);
    const c = await ctx.projectController.createProject.fetch(
      { body: { title: "Tidy D" } },
      { user: owner },
    );
    const cid = c.data.id;
    const specs = await ctx.directoryController.createDirectory.fetch(
      { params: { projectId: cid }, body: { name: "specs" } },
      { user: owner },
    );
    const roadmap = await ctx.folioController.create.fetch(
      {
        body: {
          projectId: cid,
          title: "roadmap",
          directoryId: specs.data.id,
          content: "",
        },
      },
      { user: owner },
    );
    const original = "See [[specs/roadmap]].";
    const source = await ctx.folioController.create.fetch(
      {
        body: { projectId: cid, title: "intro", content: original },
      },
      { user: owner },
    );
    await ctx.folioController.update.fetch(
      { params: { id: roadmap.data.id }, body: { directoryId: null } },
      { user: owner },
    );

    const result = await ctx.folioLinkService.tidyStalePaths(cid, {
      dryRun: true,
      updateContent: async () => {
        throw new Error("dryRun must not call updateContent");
      },
    });
    expect(result.dryRun).toBe(true);
    expect(result.rewritten).toBe(1);

    const fresh = await ctx.folioController.getByShortId.fetch(
      { params: { projectId: cid, shortId: source.data.shortId } },
      { user: owner },
    );
    expect(fresh.data.content).toBe(original);
  });
});
