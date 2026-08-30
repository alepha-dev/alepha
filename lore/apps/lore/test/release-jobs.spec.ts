import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { ReleaseController } from "../src/api/controllers/ReleaseController.ts";
import { LoreApi } from "../src/api/index.ts";
import { ReleaseJobs } from "../src/api/jobs/ReleaseJobs.ts";

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
  releaseJobs: ReleaseJobs;
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

  await alepha.start();

  return {
    alepha,
    adminUserController: alepha.inject(AdminUserController),
    projectController: alepha.inject(ProjectController),
    releaseController: alepha.inject(ReleaseController),
    releaseJobs: alepha.inject(ReleaseJobs),
    dt: alepha.inject(DateTimeProvider),
    fakeProvider: alepha.inject(FakeProvider),
  };
};

const createTestUser = async (
  ctx: TestContext,
): Promise<{ id: string; roles: string[] }> => {
  const fakeUser = ctx.fakeProvider.generate(userDataSchema);
  const response = await ctx.adminUserController.createUser.fetch(
    { body: { ...fakeUser, roles: ["user"] } },
    { user: adminUser },
  );
  return { id: response.data.id, roles: response.data.roles };
};

/**
 * Project titles derive a globally unique URL slug, so two projects cannot
 * share one — the multi-project tick test creates several. A counter rather
 * than a timestamp keeps the titles deterministic.
 */
let projectSeq = 0;

const createTestProject = async (
  ctx: TestContext,
  user: { id: string; roles: string[] },
  milestoneDuration?: string,
): Promise<{ id: number }> => {
  projectSeq += 1;
  const created = await ctx.projectController.createProject.fetch(
    { body: { title: `Test Project ${projectSeq}` } },
    { user },
  );
  if (milestoneDuration) {
    await ctx.projectController.updateProjectById.fetch(
      {
        params: { id: created.data.id },
        body: { milestoneDuration },
      },
      { user },
    );
  }
  return { id: created.data.id };
};

describe("ReleaseJobs.autoCloseExpiredReleases", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    ctx.dt.reset();
    await ctx.alepha.stop();
  });

  it("auto-closes a release whose deadline has passed", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user, "PT1H");

    const started = await ctx.releaseController.startRelease.fetch(
      { params: { projectId: project.id }, body: {} },
      { user },
    );
    expect(started.data.closesAt).toBeDefined();
    expect(started.data.closedAt).toBeUndefined();

    await ctx.dt.travel([2, "hours"]);
    await ctx.releaseJobs.autoCloseExpiredReleases.trigger();

    const after = await ctx.releaseController.releases.getById(started.data.id);
    expect(after.closedAt).toBeDefined();
    expect(after.changelog).toBeDefined();
  });

  it("leaves releases with a future deadline untouched", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user, "P7D");

    const started = await ctx.releaseController.startRelease.fetch(
      { params: { projectId: project.id }, body: {} },
      { user },
    );

    await ctx.dt.travel([1, "hour"]);
    await ctx.releaseJobs.autoCloseExpiredReleases.trigger();

    const after = await ctx.releaseController.releases.getById(started.data.id);
    expect(after.closedAt).toBeUndefined();
    expect(after.changelog).toBeUndefined();
  });

  it("leaves releases with no deadline untouched", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);

    const started = await ctx.releaseController.startRelease.fetch(
      { params: { projectId: project.id }, body: {} },
      { user },
    );
    expect(started.data.closesAt).toBeUndefined();

    await ctx.dt.travel([30, "days"]);
    await ctx.releaseJobs.autoCloseExpiredReleases.trigger();

    const after = await ctx.releaseController.releases.getById(started.data.id);
    expect(after.closedAt).toBeUndefined();
  });

  it("does not re-finalize an already-closed release", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user, "PT1H");

    const started = await ctx.releaseController.startRelease.fetch(
      { params: { projectId: project.id }, body: {} },
      { user },
    );
    const closed = await ctx.releaseController.closeRelease.fetch(
      { params: { id: started.data.id }, body: {} },
      { user },
    );
    const originalClosedAt = closed.data.closedAt;
    expect(originalClosedAt).toBeDefined();

    await ctx.dt.travel([2, "hours"]);
    await ctx.releaseJobs.autoCloseExpiredReleases.trigger();

    const after = await ctx.releaseController.releases.getById(started.data.id);
    expect(after.closedAt).toBe(originalClosedAt);
  });

  it("auto-closes releases across multiple projects in one tick", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const projectA = await createTestProject(ctx, user, "PT1H");
    const projectB = await createTestProject(ctx, user, "PT1H");

    const a = await ctx.releaseController.startRelease.fetch(
      { params: { projectId: projectA.id }, body: {} },
      { user },
    );
    const b = await ctx.releaseController.startRelease.fetch(
      { params: { projectId: projectB.id }, body: {} },
      { user },
    );

    await ctx.dt.travel([2, "hours"]);
    await ctx.releaseJobs.autoCloseExpiredReleases.trigger();

    const afterA = await ctx.releaseController.releases.getById(a.data.id);
    const afterB = await ctx.releaseController.releases.getById(b.data.id);
    expect(afterA.closedAt).toBeDefined();
    expect(afterB.closedAt).toBeDefined();
  });
});
