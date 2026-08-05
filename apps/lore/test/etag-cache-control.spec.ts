import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";
import { MilestoneController } from "../src/api/controllers/MilestoneController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { ProjectReportsController } from "../src/api/controllers/ProjectReportsController.ts";
import { LoreApi } from "../src/api/index.ts";

/**
 * Regression guard for a real incident: `$etag` was configured with a
 * `maxAge` window on lists the viewer mutates from the page that reads them.
 *
 * `max-age` and `ETag` are opposite caching strategies. `ETag` is
 * *validation* — the client always asks and gets a cheap 304 when nothing
 * changed. `max-age` is *expiration* — the client does not ask at all until
 * the window lapses. Setting both means expiration wins for the duration and
 * the ETag is inert, so a user's own write stayed invisible to them: starting
 * a milestone returned 200 and the very next list read came back stale from
 * the browser's own cache.
 *
 * The rule these tests pin: **if the viewer can mutate it from the page that
 * reads it, use `noCache`; reserve `maxAge` for what they cannot.**
 */

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  projectController: ProjectController;
  milestoneController: MilestoneController;
  reportsController: ProjectReportsController;
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
    milestoneController: alepha.inject(MilestoneController),
    reportsController: alepha.inject(ProjectReportsController),
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

const createTestProject = async (
  ctx: TestContext,
  user: TestUser,
): Promise<{ id: number }> => {
  const created = await ctx.projectController.createProject.fetch(
    { body: { title: "Test Project" } },
    { user },
  );
  return { id: created.data.id };
};

describe("$etag cache-control on viewer-mutable lists", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    ctx.dt.reset();
    await ctx.alepha.stop();
  });

  it("getMyProjects forbids serving a stale body unasked", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    await createTestProject(ctx, user);

    const res = await ctx.projectController.getMyProjects.fetch(
      { query: {} },
      { user },
    );

    const control = res.headers.get("cache-control") ?? "";
    expect(control).toContain("no-cache");
    expect(control).toContain("private");
    expect(control).not.toContain("max-age");
    expect(control).not.toContain("stale-while-revalidate");
  });

  it("getProjectMembers forbids serving a stale body unasked", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);

    const res = await ctx.projectController.getProjectMembers.fetch(
      { params: { id: project.id } },
      { user },
    );

    const control = res.headers.get("cache-control") ?? "";
    expect(control).toContain("no-cache");
    expect(control).not.toContain("max-age");
  });

  it("getMilestones forbids serving a stale body unasked", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);

    const res = await ctx.milestoneController.getMilestones.fetch(
      { params: { projectId: project.id } },
      { user },
    );

    const control = res.headers.get("cache-control") ?? "";
    expect(control).toContain("no-cache");
    expect(control).not.toContain("max-age");
  });

  it("getMilestoneChangelog forbids serving a stale body unasked", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const started = await ctx.milestoneController.startMilestone.fetch(
      { params: { projectId: project.id }, body: {} },
      { user },
    );

    const res = await ctx.milestoneController.getMilestoneChangelog.fetch(
      { params: { id: started.data.id } },
      { user },
    );

    const control = res.headers.get("cache-control") ?? "";
    expect(control).toContain("no-cache");
    expect(control).not.toContain("max-age");
  });

  /**
   * `noCache` must not mean "no ETag" — the point of the fix was to keep
   * validation while dropping expiration. If this regresses, every read pays
   * for a full body instead of a 304.
   */
  it("still emits an ETag, so revalidation stays a header round trip", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    await createTestProject(ctx, user);

    const res = await ctx.projectController.getMyProjects.fetch(
      { query: {} },
      { user },
    );

    expect(res.headers.get("etag")).toBeDefined();
  });

  /**
   * Reports are read-only aggregations — nobody mutates them from the page
   * that reads them — so their freshness window is a deliberate choice, not
   * an oversight. Pinned so a future sweep does not "fix" them by reflex.
   */
  it("keeps the freshness window on read-only report aggregations", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);

    const res = await ctx.reportsController.getReportsOverview.fetch(
      { params: { id: project.id } },
      { user },
    );

    const control = res.headers.get("cache-control") ?? "";
    expect(control).toContain("max-age");
  });
});
