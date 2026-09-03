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
import { RoadmapController } from "../src/api/controllers/RoadmapController.ts";
import { LoreApi } from "../src/api/index.ts";

/**
 * Release lists come out in version order, from the source (#1745, from
 * feedback #2075: "sort release by name / 0.28 -> 0.29 -> 1.0 / and same for
 * every list of the releases of the ui").
 *
 * `compareReleaseTags` existed already and two tables used it. Everything
 * else - the roadmap, the quests table's release filter, the bulk `Add to
 * release` menu, both release controls, `QuestCreate`, the header menu - took
 * whatever order the server sent. Sorting at each of those is how the next
 * surface gets forgotten, so the order is settled in `getReleases` and in
 * `RoadmapService.roadmapOf`, and every consumer inherits it.
 *
 * The fixture creates `0.28.0, 1.0.0, 0.29.0` **in that sequence**, which is
 * the reporter's own arrangement and the only one where text, `number` and a
 * parsed version give three different answers. Created in version order all
 * three agree and this would pass against any of them.
 */

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

const CREATION_ORDER = ["0.28.0", "1.0.0", "0.29.0"];
const VERSION_ORDER = ["0.28.0", "0.29.0", "1.0.0"];

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  projectController: ProjectController;
  releaseController: ReleaseController;
  roadmapController: RoadmapController;
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
    roadmapController: alepha.inject(RoadmapController),
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

describe("release lists are ordered by version at the source", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const seed = async (roadmapVisibility?: "public") => {
    const owner = await createTestUser(ctx);
    const project = (
      await ctx.projectController.createProject.fetch(
        { body: { title: `Order ${Date.now()}` } },
        { user: owner },
      )
    ).data;

    for (const tag of CREATION_ORDER) {
      await ctx.releaseController.createRelease.fetch(
        { params: { projectId: project.id }, body: { tag } },
        { user: owner },
      );
    }

    if (roadmapVisibility) {
      await ctx.projectController.updateProjectById.fetch(
        { params: { id: project.id }, body: { roadmapVisibility } },
        { user: owner },
      );
    }

    return { owner, project };
  };

  it("getReleases answers in version order, whatever the creation order", async ({
    expect,
  }) => {
    const { owner, project } = await seed();

    const releases = (
      await ctx.releaseController.getReleases.fetch(
        { params: { projectId: project.id } },
        { user: owner },
      )
    ).data;

    expect(releases.map((r) => r.tag)).toEqual(VERSION_ORDER);
    // The `$sequence` still records creation order, which is exactly why it
    // could not be the version order: it disagrees here.
    expect(releases.map((r) => r.number)).toEqual([1, 3, 2]);
  });

  it("the anonymous roadmap uses the same order", async ({ expect }) => {
    const { project } = await seed("public");

    const roadmap = (
      await ctx.roadmapController.getPublicRoadmap.fetch({
        params: { slug: project.slug },
      })
    ).data;

    expect(roadmap.releases.map((r) => r.tag)).toEqual(VERSION_ORDER);
  });

  it("the member roadmap agrees with the anonymous one", async ({ expect }) => {
    // Both actions go through `RoadmapService.roadmapOf`, and the two
    // audiences must never see a different payload - which is why the sort
    // lives in the service rather than in either action.
    const { owner, project } = await seed("public");

    const anonymous = (
      await ctx.roadmapController.getPublicRoadmap.fetch({
        params: { slug: project.slug },
      })
    ).data;
    const member = (
      await ctx.roadmapController.getMemberRoadmap.fetch(
        { params: { slug: project.slug } },
        { user: owner },
      )
    ).data;

    expect(member.releases.map((r) => r.tag)).toEqual(
      anonymous.releases.map((r) => r.tag),
    );
    expect(member.releases.map((r) => r.tag)).toEqual(VERSION_ORDER);
  });

  it("keeps a non-version tag after every version, and holds creation order as the tiebreak", async ({
    expect,
  }) => {
    const { owner, project } = await seed();

    // `demo-1` is deliberately not version-shaped, so it sorts last rather
    // than as version 1 - see `releaseOrder.ts`.
    for (const tag of ["demo-1", "0.28.0-rc.1"]) {
      await ctx.releaseController.createRelease.fetch(
        { params: { projectId: project.id }, body: { tag } },
        { user: owner },
      );
    }

    const releases = (
      await ctx.releaseController.getReleases.fetch(
        { params: { projectId: project.id } },
        { user: owner },
      )
    ).data;

    expect(releases.map((r) => r.tag)).toEqual([
      "0.28.0-rc.1",
      "0.28.0",
      "0.29.0",
      "1.0.0",
      "demo-1",
    ]);
  });
});
