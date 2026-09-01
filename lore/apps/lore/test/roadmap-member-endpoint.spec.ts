import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { EpicController } from "../src/api/controllers/EpicController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { ReleaseController } from "../src/api/controllers/ReleaseController.ts";
import { RoadmapController } from "../src/api/controllers/RoadmapController.ts";
import { LoreApi } from "../src/api/index.ts";
import type { RoadmapVisibility } from "../src/api/schemas/roadmapVisibilitySchema.ts";
import { ProjectSecurityService } from "../src/api/services/ProjectSecurityService.ts";

/**
 * The members half of the roadmap: the `members` branch of the gate, and the
 * one field the public payload does not carry.
 *
 * The two actions must agree about the CONTENT and differ only in who may
 * call, so the case comparing the two bodies is the load-bearing one here -
 * a member view that quietly showed more than the public one is exactly the
 * shape the epic set out to prevent.
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
  releaseController: ReleaseController;
  epicController: EpicController;
  roadmapController: RoadmapController;
  security: ProjectSecurityService;
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
    epicController: alepha.inject(EpicController),
    roadmapController: alepha.inject(RoadmapController),
    security: alepha.inject(ProjectSecurityService),
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

describe("RoadmapController.getMemberRoadmap", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const seed = async (visibility: RoadmapVisibility) => {
    const owner = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Cartography" } },
      { user: owner },
    );
    const project = created.data;

    const release = (
      await ctx.releaseController.createRelease.fetch(
        {
          params: { projectId: project.id },
          body: { tag: "0.1.0", title: "First light" },
        },
        { user: owner },
      )
    ).data;

    const epic = (
      await ctx.epicController.createEpic.fetch(
        { params: { projectId: project.id }, body: { title: "Draw the map" } },
        { user: owner },
      )
    ).data;
    await ctx.epicController.updateEpic.fetch(
      { params: { id: epic.id }, body: { releaseId: release.id } },
      { user: owner },
    );

    await ctx.projectController.updateProjectById.fetch(
      { params: { id: project.id }, body: { roadmapVisibility: visibility } },
      { user: owner },
    );

    return { owner, project };
  };

  const invite = async (projectId: number) => {
    const user = await createTestUser(ctx);
    await ctx.security.members.create({ userId: user.id, projectId });
    return user;
  };

  const read = (slug: string, user: TestUser) =>
    ctx.roadmapController.getMemberRoadmap.fetch(
      { params: { slug } },
      { user },
    );

  it("serves a members-only roadmap to a member", async ({ expect }) => {
    const { project } = await seed("members");
    const invited = await invite(project.id);

    const res = await read(project.slug, invited);

    expect(res.data.member).toBe(true);
    expect(res.data.releases.map((release) => release.tag)).toEqual(["0.1.0"]);
  });

  it("serves it to the owner", async ({ expect }) => {
    const { owner, project } = await seed("members");
    const res = await read(project.slug, owner);
    expect(res.data.member).toBe(true);
  });

  it("404s a members-only roadmap for a signed-in stranger", async ({
    expect,
  }) => {
    const { project } = await seed("members");
    const stranger = await createTestUser(ctx);
    await expect(read(project.slug, stranger)).rejects.toThrow();
  });

  it("404s when the roadmap is off, for the owner too", async ({ expect }) => {
    const { owner, project } = await seed("off");
    await expect(read(project.slug, owner)).rejects.toThrow();
  });

  /**
   * A signed-in stranger takes this path too, because the loader picks the
   * endpoint by "is there a session" and cannot know the visibility before
   * asking. They must read it, and must not be told they belong.
   */
  it("serves a public roadmap to a signed-in stranger, as a non-member", async ({
    expect,
  }) => {
    const { project } = await seed("public");
    const stranger = await createTestUser(ctx);

    const res = await read(project.slug, stranger);

    expect(res.data.member).toBe(false);
    expect(res.data.releases).toHaveLength(1);
  });

  /**
   * ⚠️ **The load-bearing case.** The two actions differ in who may call and
   * never in what they compute, so a member view that shows more than the
   * public one - a quest title, a name, an extra field - fails here.
   *
   * Compared as whole serialized bodies rather than field by field, because
   * the thing being guarded against is a field nobody thought to assert on.
   */
  it("computes the same body as the public action, plus `member`", async ({
    expect,
  }) => {
    const { project } = await seed("public");
    const invited = await invite(project.id);

    const asMember = await read(project.slug, invited);
    const asStranger = await ctx.roadmapController.getPublicRoadmap.fetch({
      params: { slug: project.slug },
    });

    const { member, ...shared } = asMember.data;
    expect(member).toBe(true);
    expect(shared).toEqual(asStranger.data);
  });

  /**
   * `noCache` and `private`, the opposite of the public action's freshness
   * window: this body can name a `members`-only roadmap, so a shared cache
   * must never hold it, and the caller is likely the person who just created
   * the release they are looking for.
   */
  it("forbids a shared cache and a stale body", async ({ expect }) => {
    const { owner, project } = await seed("members");
    const res = await read(project.slug, owner);

    const control = res.headers.get("cache-control") ?? "";
    expect(control).toContain("private");
    expect(control).toContain("no-cache");
    expect(control).not.toContain("public");
    expect(control).not.toContain("max-age");
    expect(res.headers.get("etag")).toMatch(/\S/);
  });
});
