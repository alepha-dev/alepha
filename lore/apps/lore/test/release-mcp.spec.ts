import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { currentUserAtom } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { EpicController } from "../src/api/controllers/EpicController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { QuestController } from "../src/api/controllers/QuestController.ts";
import { ReleaseController } from "../src/api/controllers/ReleaseController.ts";
import { LoreApi } from "../src/api/index.ts";
import { LoreMcp } from "../src/mcp/index.ts";
import { ReleaseTools } from "../src/mcp/tools/ReleaseTools.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  projectController: ProjectController;
  releaseController: ReleaseController;
  questController: QuestController;
  epicController: EpicController;
  tools: ReleaseTools;
  dt: DateTimeProvider;
  fakeProvider: FakeProvider;
}

const setup = async (): Promise<TestContext> => {
  const alepha = Alepha.create({
    env: {
      LOG_LEVEL: "error",
      SERVER_PORT: 0,
      DATABASE_URL: ":memory:",
    },
  });

  alepha.with(AlephaOrm);
  alepha.with(AlephaServer);
  alepha.with(AlephaSecurity);
  alepha.with(AlephaEmail);
  alepha.with(AlephaApiUsers);
  alepha.with(AlephaFake);
  alepha.with(LoreApi);
  alepha.with(LoreMcp);

  const tools = alepha.inject(ReleaseTools);

  await alepha.start();

  return {
    alepha,
    adminUserController: alepha.inject(AdminUserController),
    projectController: alepha.inject(ProjectController),
    releaseController: alepha.inject(ReleaseController),
    questController: alepha.inject(QuestController),
    epicController: alepha.inject(EpicController),
    tools,
    dt: alepha.inject(DateTimeProvider),
    fakeProvider: alepha.inject(FakeProvider),
  };
};

type TestUser = { id: string; roles: string[] };

const createTestUser = async (ctx: TestContext): Promise<TestUser> => {
  const fakeUser = ctx.fakeProvider.generate(userDataSchema);
  const response = await ctx.adminUserController.createUser.fetch(
    { body: { ...fakeUser, roles: ["user"] } },
    { user: adminUser },
  );
  return { id: response.data.id, roles: response.data.roles };
};

/**
 * A project's slug is derived from its title and is unique across the whole
 * instance, so a test needing two projects has to name them apart.
 */
const createTestProject = async (
  ctx: TestContext,
  user: TestUser,
  title = "Test Project",
): Promise<{ id: number }> => {
  const created = await ctx.projectController.createProject.fetch(
    { body: { title } },
    { user },
  );
  return { id: created.data.id };
};

describe("MCP release tools", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    ctx.dt.reset();
    await ctx.alepha.stop();
  });

  /**
   * A tool is `execute(params)`, and the controllers behind it read the user
   * from the request context rather than from an argument — so the call has
   * to happen inside one, with the user seeded where `$secure` looks. Same
   * shape as `blight-tools.spec.ts`.
   */
  const call = <R>(user: TestUser, fn: () => Promise<R> | R): Promise<R> | R =>
    ctx.alepha.context.run(() => {
      ctx.alepha.store.set(currentUserAtom, {
        id: user.id,
        roles: user.roles,
      } as never);
      return fn();
    });

  it("lists by number ascending, never by tag", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);

    // Created in an order whose TAGS sort the other way as text: "0.10.0"
    // comes before "0.9.0" alphabetically. This is the bug the epic exists
    // to avoid, and the only assertion that catches it.
    for (const tag of ["0.9.0", "0.10.0"]) {
      await ctx.releaseController.createRelease.fetch(
        { params: { projectId: project.id }, body: { tag } },
        { user },
      );
    }

    const result = await call(user, () =>
      ctx.tools.release_list.execute({ project: project.id }),
    );

    expect(result.releases.map((r) => r.tag)).toEqual(["0.9.0", "0.10.0"]);
  });

  it("creates, gets and updates by tag", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);

    const created = await call(user, () =>
      ctx.tools.release_create.execute({ project: project.id, tag: "0.28.0" }),
    );
    expect(created.tag).toBe("0.28.0");
    expect(created.title).toBe("0.28.0");

    const updated = await call(user, () =>
      ctx.tools.release_update.execute({
        project: project.id,
        tag: "0.28.0",
        title: "Lore Release",
      }),
    );
    expect(updated.title).toBe("Lore Release");

    const read = await call(user, () =>
      ctx.tools.release_get.execute({ project: project.id, tag: "0.28.0" }),
    );
    expect(read.title).toBe("Lore Release");
    expect(read.epics).toEqual([]);
    expect(read.looseQuests).toEqual([]);
  });

  it("attaches an epic by number and a quest by shortId", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    await call(user, () =>
      ctx.tools.release_create.execute({ project: project.id, tag: "0.28.0" }),
    );

    const epic = await ctx.epicController.createEpic.fetch(
      { params: { projectId: project.id }, body: { title: "The big one" } },
      { user },
    );
    const quest = await ctx.questController.createQuest.fetch(
      {
        body: {
          projectId: project.id,
          title: "A hotfix",
          area: "orm",
          priority: "high",
        },
      },
      { user },
    );

    // Only the RELEASE is named by tag; the epic and the quest keep their own
    // per-project numbers, the way `quest_update`'s `epic_number` does.
    await call(user, () =>
      ctx.tools.release_attach.execute({
        project: project.id,
        tag: "0.28.0",
        epic_number: epic.data.number,
      }),
    );
    await call(user, () =>
      ctx.tools.release_attach.execute({
        project: project.id,
        tag: "0.28.0",
        quest_shortId: quest.data.shortId,
      }),
    );

    const read = await call(user, () =>
      ctx.tools.release_get.execute({ project: project.id, tag: "0.28.0" }),
    );
    expect(read.epics.map((e) => e.number)).toEqual([epic.data.number]);
    expect(read.looseQuests.map((q) => q.shortId)).toEqual([
      quest.data.shortId,
    ]);

    await call(user, () =>
      ctx.tools.release_detach.execute({
        project: project.id,
        tag: "0.28.0",
        quest_shortId: quest.data.shortId,
      }),
    );
    const after = await call(user, () =>
      ctx.tools.release_get.execute({ project: project.id, tag: "0.28.0" }),
    );
    expect(after.looseQuests).toEqual([]);
  });

  it("refuses attach, detach and update on a published release", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    await call(user, () =>
      ctx.tools.release_create.execute({ project: project.id, tag: "0.28.0" }),
    );
    const epic = await ctx.epicController.createEpic.fetch(
      { params: { projectId: project.id }, body: { title: "The big one" } },
      { user },
    );
    await call(user, () =>
      ctx.tools.release_publish.execute({ project: project.id, tag: "0.28.0" }),
    );

    await expect(
      call(user, () =>
        ctx.tools.release_update.execute({
          project: project.id,
          tag: "0.28.0",
          title: "Nope",
        }),
      ),
    ).rejects.toThrowError(/published/i);

    await expect(
      call(user, () =>
        ctx.tools.release_attach.execute({
          project: project.id,
          tag: "0.28.0",
          epic_number: epic.data.number,
        }),
      ),
    ).rejects.toThrowError(/published/i);
  });

  it("publishes and reopens, and the changelog says which it is", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    await call(user, () =>
      ctx.tools.release_create.execute({ project: project.id, tag: "0.28.0" }),
    );

    const open = await call(user, () =>
      ctx.tools.release_changelog.execute({
        project: project.id,
        tag: "0.28.0",
      }),
    );
    expect(open.frozen).toBe(false);

    const published = await call(user, () =>
      ctx.tools.release_publish.execute({ project: project.id, tag: "0.28.0" }),
    );
    expect(published.releasedAt).toBeDefined();

    const frozen = await call(user, () =>
      ctx.tools.release_changelog.execute({
        project: project.id,
        tag: "0.28.0",
      }),
    );
    expect(frozen.frozen).toBe(true);

    const reopened = await call(user, () =>
      ctx.tools.release_reopen.execute({ project: project.id, tag: "0.28.0" }),
    );
    // The tag and the number survive a reopen, which is why it exists rather
    // than delete-and-recreate.
    expect(reopened.releasedAt).toBeUndefined();
    expect(reopened.tag).toBe("0.28.0");
    expect(reopened.number).toBe(published.number);
  });

  it("deletes without taking its contents with it", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    await call(user, () =>
      ctx.tools.release_create.execute({ project: project.id, tag: "0.28.0" }),
    );
    const quest = await ctx.questController.createQuest.fetch(
      {
        body: {
          projectId: project.id,
          title: "Survives",
          area: "orm",
          priority: "high",
        },
      },
      { user },
    );
    await call(user, () =>
      ctx.tools.release_attach.execute({
        project: project.id,
        tag: "0.28.0",
        quest_shortId: quest.data.shortId,
      }),
    );

    await call(user, () =>
      ctx.tools.release_delete.execute({ project: project.id, tag: "0.28.0" }),
    );

    const survived = await ctx.questController.getQuestById.fetch(
      { params: { id: quest.data.id } },
      { user },
    );
    expect(survived.data.releaseId).toBeUndefined();
  });

  it("refuses a tag that does not exist in the project", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);

    await expect(
      call(user, () =>
        ctx.tools.release_get.execute({ project: project.id, tag: "9.9.9" }),
      ),
    ).rejects.toThrowError(/not found/i);
  });

  it("needs something to move", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    await call(user, () =>
      ctx.tools.release_create.execute({ project: project.id, tag: "0.28.0" }),
    );

    // Neither an epic nor a quest named: a silent no-op would read to an
    // agent as a successful attach.
    await expect(
      call(user, () =>
        ctx.tools.release_attach.execute({
          project: project.id,
          tag: "0.28.0",
        }),
      ),
    ).rejects.toThrowError(/epic_number|quest_shortId/);
  });
});
