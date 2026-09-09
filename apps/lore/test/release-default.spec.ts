import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { ReleaseController } from "../src/api/controllers/ReleaseController.ts";
import { LoreApi } from "../src/api/index.ts";

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

  await alepha.start();

  return {
    alepha,
    adminUserController: alepha.inject(AdminUserController),
    projectController: alepha.inject(ProjectController),
    releaseController: alepha.inject(ReleaseController),
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
 * A project title is globally unique (it derives the slug) and capped at 24
 * characters, so every project in this file gets a short random one.
 */
const createTestProject = async (
  ctx: TestContext,
  user: TestUser,
  title = `P ${crypto.randomUUID().slice(0, 8)}`,
): Promise<{ id: number }> => {
  const created = await ctx.projectController.createProject.fetch(
    { body: { title } },
    { user },
  );
  return { id: created.data.id };
};

const createRelease = async (
  ctx: TestContext,
  user: TestUser,
  projectId: number,
  tag: string,
): Promise<{ id: number; tag?: string }> => {
  const created = await ctx.releaseController.createRelease.fetch(
    { params: { projectId }, body: { tag } },
    { user },
  );
  return { id: created.data.id, tag: created.data.tag };
};

const setDefault = async (
  ctx: TestContext,
  user: TestUser,
  projectId: number,
  releaseId: number | null,
) =>
  (
    await ctx.releaseController.setDefaultRelease.fetch(
      { params: { projectId }, body: { releaseId } },
      { user },
    )
  ).data;

/**
 * The default release is at most one per project, and the swap that keeps it
 * that way is a single statement because D1 has no transaction to make a
 * clear-then-set pair atomic.
 */
describe("ReleaseController: the default release", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("creates every release with no default, and never picks one", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);

    await createRelease(ctx, user, project.id, "0.28.0");
    const releases = (
      await ctx.releaseController.getReleases.fetch(
        { params: { projectId: project.id } },
        { user },
      )
    ).data;

    // Creating the FIRST release does not make it the default. Pointing
    // intake somewhere is an explicit act.
    expect(releases.map((it) => it.defaultSince)).toEqual([undefined]);
  });

  it("moves the default so exactly one release ever carries it", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const first = await createRelease(ctx, user, project.id, "0.28.0");
    const second = await createRelease(ctx, user, project.id, "0.29.0");

    const afterFirst = await setDefault(ctx, user, project.id, first.id);
    expect(
      afterFirst.filter((it) => it.defaultSince).map((it) => it.tag),
    ).toEqual(["0.28.0"]);

    const afterSecond = await setDefault(ctx, user, project.id, second.id);
    // The whole point of the one-statement swap: the previous default is
    // cleared by the same write that sets the new one.
    expect(
      afterSecond.filter((it) => it.defaultSince).map((it) => it.tag),
    ).toEqual(["0.29.0"]);
  });

  it("clears the default when the release is omitted, and zero is a normal state", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const release = await createRelease(ctx, user, project.id, "0.28.0");

    await setDefault(ctx, user, project.id, release.id);
    const cleared = await setDefault(ctx, user, project.id, null);

    expect(cleared.filter((it) => it.defaultSince)).toEqual([]);
  });

  it("refuses a published release with the reopen-it-first wording", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const release = await createRelease(ctx, user, project.id, "0.28.0");

    await ctx.releaseController.publishRelease.fetch(
      { params: { id: release.id }, body: {} },
      { user },
    );

    await expect(
      setDefault(ctx, user, project.id, release.id),
    ).rejects.toThrowError(/published\. Reopen it first\./);
  });

  it("refuses a release from another project as a 404", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const mine = await createTestProject(ctx, user);
    const theirs = await createTestProject(ctx, user);
    const elsewhere = await createRelease(ctx, user, theirs.id, "9.9.9");

    // Not a 403: the caller is not entitled to learn that an id exists in
    // another project. And never a silent no-op, which is what the
    // statement's own `WHERE project_id` would otherwise make it.
    await expect(
      setDefault(ctx, user, mine.id, elsewhere.id),
    ).rejects.toThrowError(/not found in this project/);
  });

  it("clears the default when the default release is published", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const release = await createRelease(ctx, user, project.id, "0.28.0");

    await setDefault(ctx, user, project.id, release.id);
    await ctx.releaseController.publishRelease.fetch(
      { params: { id: release.id }, body: {} },
      { user },
    );

    const releases = (
      await ctx.releaseController.getReleases.fetch(
        { params: { projectId: project.id } },
        { user },
      )
    ).data;
    // Without this, the next completion would try to attach to a published
    // release, `assertOpen` would refuse, and the quest could not close.
    expect(releases.filter((it) => it.defaultSince)).toEqual([]);
  });

  it("does not restore the default when a release is reopened", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const release = await createRelease(ctx, user, project.id, "0.28.0");

    await setDefault(ctx, user, project.id, release.id);
    await ctx.releaseController.publishRelease.fetch(
      { params: { id: release.id }, body: {} },
      { user },
    );
    await ctx.releaseController.reopenRelease.fetch(
      { params: { id: release.id } },
      { user },
    );

    const releases = (
      await ctx.releaseController.getReleases.fetch(
        { params: { projectId: project.id } },
        { user },
      )
    ).data;
    // Reopening says the record was wrong, not that intake resumes here.
    expect(releases.filter((it) => it.defaultSince)).toEqual([]);
  });
});
