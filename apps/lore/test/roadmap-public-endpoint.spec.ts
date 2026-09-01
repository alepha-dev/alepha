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
import { QuestController } from "../src/api/controllers/QuestController.ts";
import { ReleaseController } from "../src/api/controllers/ReleaseController.ts";
import { RoadmapController } from "../src/api/controllers/RoadmapController.ts";
import { LoreApi } from "../src/api/index.ts";
import type { RoadmapVisibility } from "../src/api/schemas/roadmapVisibilitySchema.ts";

/**
 * The public roadmap endpoint: Lore's ONLY anonymous read path.
 *
 * ⚠️ The most important case in this file is `pins the exact key set`. A leak
 * here is a leak to the internet, and the failure mode is not somebody
 * writing a bad endpoint - it is a field added to an entity six months from
 * now that rides along silently, because `schema.response` is what
 * serializes. That test fails when a key is added, which is the point of it.
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
  questController: QuestController;
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
    epicController: alepha.inject(EpicController),
    questController: alepha.inject(QuestController),
    roadmapController: alepha.inject(RoadmapController),
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

describe("RoadmapController.getPublicRoadmap", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  /**
   * A project with one open release carrying a planned epic and a quest, plus
   * one published release beside it.
   *
   * Both carry a `targetDate`, and only the second a `releasedAt`, which is
   * what lets the key-set assertion below be an exact equality on both: an
   * absent optional field does not serialize, so a fixture that leaves one
   * unset can never notice it disappearing.
   */
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
          body: {
            tag: "0.1.0",
            title: "First light",
            targetDate: "2027-01-31T00:00:00.000Z",
          },
        },
        { user: owner },
      )
    ).data;

    // ⚠️ The DEPENDENT is created first, so it gets the LOWER `number`.
    //
    // That inversion is the whole point of the fixture: with the predecessor
    // numbered first, `number` order and dependency order agree and the
    // ordering assertion below would pass whether `EpicDependencyService.order`
    // ran or not. Numbered this way, only the dependency sort produces
    // "Draw the map" before "Name the roads".
    //
    // Both are left `planned`: a planned epic must appear on the roadmap, and
    // its status must travel with it so an empty bar reads as "not begun"
    // rather than "stalled".
    const follower = (
      await ctx.epicController.createEpic.fetch(
        {
          params: { projectId: project.id },
          body: { title: "Name the roads" },
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
    await ctx.epicController.updateEpic.fetch(
      {
        params: { id: follower.id },
        body: { releaseId: release.id, dependsOn: epic.id },
      },
      { user: owner },
    );

    const quest = (
      await ctx.questController.createQuest.fetch(
        {
          body: {
            projectId: project.id,
            title: "A quest title nobody outside may read",
            area: "orm",
            priority: "high",
          },
        },
        { user: owner },
      )
    ).data;
    await ctx.epicController.attachQuest.fetch(
      { params: { id: epic.id }, body: { questId: quest.id } },
      { user: owner },
    );

    // A shipped release beside the open one. Its rollup comes from the four
    // columns frozen at publish and its `epics` array is empty by design -
    // see `roadmapReleaseSchema`.
    const shippedRelease = (
      await ctx.releaseController.createRelease.fetch(
        {
          params: { projectId: project.id },
          body: {
            tag: "0.0.9",
            title: "Groundwork",
            targetDate: "2026-06-30T00:00:00.000Z",
          },
        },
        { user: owner },
      )
    ).data;
    await ctx.releaseController.publishRelease.fetch(
      { params: { id: shippedRelease.id }, body: {} },
      { user: owner },
    );

    await ctx.projectController.updateProjectById.fetch(
      {
        params: { id: project.id },
        body: { roadmapVisibility: visibility },
      },
      { user: owner },
    );

    return { owner, project, release, shippedRelease, epic, follower, quest };
  };

  const read = (slug: string) =>
    ctx.roadmapController.getPublicRoadmap.fetch({ params: { slug } });

  it("answers a public roadmap to a caller with no session", async ({
    expect,
  }) => {
    const { project } = await seed("public");

    // No `{ user }` second argument anywhere in this file, on purpose: an
    // anonymous call is the whole subject.
    const res = await read(project.slug);

    expect(res.data.project.title).toBe("Cartography");
    // Open first, then shipped. The ORDER is the server's answer, which is
    // why nothing in the payload carries a sort key.
    expect(res.data.releases.map((release) => release.tag)).toEqual([
      "0.1.0",
      "0.0.9",
    ]);
  });

  it("404s a members-only roadmap anonymously", async ({ expect }) => {
    const { project } = await seed("members");
    await expect(read(project.slug)).rejects.toThrow();
  });

  it("404s a roadmap that is off", async ({ expect }) => {
    const { project } = await seed("off");
    await expect(read(project.slug)).rejects.toThrow();
  });

  it("404s a project that has never set the switch", async ({ expect }) => {
    const owner = await createTestUser(ctx);
    const created = await ctx.projectController.createProject.fetch(
      { body: { title: "Untouched" } },
      { user: owner },
    );
    await expect(read(created.data.slug)).rejects.toThrow();
  });

  /**
   * A 403 confirms the project exists, so "no such slug" and "that roadmap is
   * not public" must be indistinguishable. Compared rather than asserted
   * against a literal, so the two branches cannot drift apart.
   */
  it("answers a hidden roadmap and an unknown slug identically", async ({
    expect,
  }) => {
    const { project } = await seed("off");

    const hidden = await read(project.slug).catch((error) => error);
    const unknown = await read("no-such-project-anywhere").catch(
      (error) => error,
    );

    expect(hidden.status ?? hidden.statusCode).toBe(404);
    expect(unknown.status ?? unknown.statusCode).toBe(404);
    expect(String(hidden.message)).toBe(String(unknown.message));
  });

  /**
   * ⚠️ **The guard.** Deliberately an exact-equality assertion rather than a
   * set of `toHaveProperty` checks: a new key must FAIL here, and only
   * equality does that.
   *
   * Adding a key to this list is a decision about what Lore publishes to the
   * internet. Read `roadmapResourceSchema` before changing it.
   */
  it("pins the exact key set of the response", async ({ expect }) => {
    const { project } = await seed("public");
    const res = await read(project.slug);

    expect(Object.keys(res.data).sort()).toEqual(["project", "releases"]);
    expect(Object.keys(res.data.project).sort()).toEqual(["title"]);

    // The open one carries everything but `releasedAt`, which it does not
    // have yet; the shipped one carries all seven. Asserted separately so
    // both shapes are pinned rather than only whichever the fixture happened
    // to put first.
    const [open, shipped] = res.data.releases;
    expect(Object.keys(open).sort()).toEqual([
      "description",
      "epics",
      "progress",
      "tag",
      "targetDate",
      "title",
    ]);
    expect(Object.keys(shipped).sort()).toEqual([
      "description",
      "epics",
      "progress",
      "releasedAt",
      "tag",
      "targetDate",
      "title",
    ]);
    expect(Object.keys(open.progress).sort()).toEqual([
      "completed",
      "inProgress",
      "shelved",
      "total",
    ]);
    // A published release renders from its frozen columns and lists no epics.
    expect(shipped.epics).toEqual([]);

    const release = open;

    // The independent epic carries no `dependsOnNumber` (an absent optional
    // field does not serialize); the one that depends on it does. Both are
    // pinned, so neither shape can grow a key unnoticed.
    const [first, second] = release.epics;
    expect(Object.keys(first).sort()).toEqual([
      "number",
      "progress",
      "status",
      "title",
    ]);
    expect(Object.keys(second).sort()).toEqual([
      "dependsOnNumber",
      "number",
      "progress",
      "status",
      "title",
    ]);
    expect(Object.keys(first.progress).sort()).toEqual([
      "completed",
      "inProgress",
      "shelved",
      "total",
    ]);
  });

  /**
   * The key-set test above pins the shape; this one pins the CONTENT, because
   * the thing that must never appear is a value rather than a field name -
   * a quest title reaching the internet through some future nesting the key
   * assertion did not think to walk.
   */
  it("carries no quest title and no user id anywhere in the body", async ({
    expect,
  }) => {
    const { owner, project, quest } = await seed("public");
    const res = await read(project.slug);

    const body = JSON.stringify(res.data);
    expect(body).not.toContain(quest.title);
    expect(body).not.toContain(owner.id);
    expect(body).not.toContain(project.createdBy);
  });

  it("includes a planned epic, with its status", async ({ expect }) => {
    const { project } = await seed("public");
    const res = await read(project.slug);

    const epics = res.data.releases[0].epics;
    // Predecessor first, and the dependent naming it - the order DRAWN
    // rather than described, which is the whole point of `epics.dependsOn`.
    expect(epics.map((epic) => [epic.title, epic.status])).toEqual([
      ["Draw the map", "planned"],
      ["Name the roads", "planned"],
    ]);
    expect(epics[0].dependsOnNumber).toBeUndefined();
    expect(epics[1].dependsOnNumber).toBe(epics[0].number);
    // The quest inside it counts, even though `EpicVisibilityService` keeps a
    // planned epic's quests out of the project's own backlog. An epic
    // reporting 0/0 because its work is gated out of a listing surface is not
    // telling the truth about itself.
    expect(epics[0].progress.total).toBe(1);
  });

  /**
   * Public and cacheable, unlike every other action in the app: nobody
   * reading this page can mutate it, and the cache is the rate limit as much
   * as it is the performance win.
   *
   * `test/etag-cache-control.spec.ts` pins the opposite rule for the
   * viewer-mutable lists. Both are deliberate; this is the one endpoint the
   * `noCache` rule does not apply to.
   */
  it("serves a public etag with a real freshness window", async ({
    expect,
  }) => {
    const { project } = await seed("public");
    const res = await read(project.slug);

    const control = res.headers.get("cache-control") ?? "";
    expect(control).toContain("public");
    expect(control).not.toContain("private");
    expect(control).not.toContain("no-cache");
    expect(res.headers.get("etag")).toMatch(/\S/);

    // ⚠️ Pinned to the number, not merely to the presence of `max-age`.
    // `project.settings.roadmap.delay` promises the owner that a change
    // reaches visitors within a minute, and these directives are the larger
    // half of what makes that true. Raising either means changing that
    // string in both locales first, which an exact assertion forces someone
    // to notice.
    expect(control).toContain("max-age=60");
    expect(control).toContain("s-maxage=60");
    expect(control).not.toContain("stale-while-revalidate");
  });
});
