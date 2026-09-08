import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { DateTimeProvider } from "alepha/datetime";
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
  questController: QuestController;
  epicController: EpicController;
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
    questController: alepha.inject(QuestController),
    epicController: alepha.inject(EpicController),
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

describe("Attaching an epic to a release", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    ctx.dt.reset();
    await ctx.alepha.stop();
  });

  const anEpic = async (user: TestUser, projectId: number) =>
    await ctx.epicController.createEpic.fetch(
      { params: { projectId }, body: { title: "Lore Release" } },
      { user },
    );

  const aRelease = async (user: TestUser, projectId: number, tag: string) =>
    await ctx.releaseController.createRelease.fetch(
      { params: { projectId }, body: { tag } },
      { user },
    );

  it("attaches and detaches through updateEpic", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const epic = await anEpic(user, project.id);
    const release = await aRelease(user, project.id, "0.28.0");

    const attached = await ctx.epicController.updateEpic.fetch(
      { params: { id: epic.data.id }, body: { releaseId: release.data.id } },
      { user },
    );
    expect(attached.data.releaseId).toBe(release.data.id);

    const detached = await ctx.epicController.updateEpic.fetch(
      { params: { id: epic.data.id }, body: { releaseId: null } },
      { user },
    );
    expect(detached.data.releaseId).toBeUndefined();
  });

  it("leaves the attachment alone when releaseId is omitted", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const epic = await anEpic(user, project.id);
    const release = await aRelease(user, project.id, "0.28.0");

    await ctx.epicController.updateEpic.fetch(
      { params: { id: epic.data.id }, body: { releaseId: release.data.id } },
      { user },
    );
    // An absent key means "leave alone"; only an explicit `null` detaches.
    const renamed = await ctx.epicController.updateEpic.fetch(
      { params: { id: epic.data.id }, body: { title: "Renamed epic" } },
      { user },
    );
    expect(renamed.data.releaseId).toBe(release.data.id);
  });

  it("deleting a release orphans its epics and keeps their quests", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const epic = await anEpic(user, project.id);
    const release = await aRelease(user, project.id, "0.28.0");

    await ctx.epicController.updateEpic.fetch(
      { params: { id: epic.data.id }, body: { releaseId: release.data.id } },
      { user },
    );
    const quest = await ctx.questController.createQuest.fetch(
      {
        body: {
          projectId: project.id,
          title: "Inside the epic",
          area: "orm",
          priority: "high",
        },
      },
      { user },
    );
    // `questCreateSchema` carries no `epicId`: a quest joins an epic through
    // this action, not at creation.
    await ctx.epicController.attachQuest.fetch(
      { params: { id: epic.data.id }, body: { questId: quest.data.id } },
      { user },
    );

    await ctx.releaseController.deleteRelease.fetch(
      { params: { id: release.data.id } },
      { user },
    );

    // SET NULL, never CASCADE. The epic survives with no release, and its
    // quests are untouched: nothing about them ever referenced the release.
    const survived = await ctx.epicController.getEpicByNumber.fetch(
      { params: { projectId: project.id, number: epic.data.number } },
      { user },
    );
    expect(survived.data.releaseId).toBeUndefined();
    expect(survived.data.title).toBe("Lore Release");

    const stillThere = await ctx.questController.getQuestById.fetch(
      { params: { id: quest.data.id } },
      { user },
    );
    expect(stillThere.data.epicId).toBe(epic.data.id);
  });

  it("refuses attaching to a published release", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const epic = await anEpic(user, project.id);
    const release = await aRelease(user, project.id, "0.28.0");
    await ctx.releaseController.publishRelease.fetch(
      { params: { id: release.data.id }, body: {} },
      { user },
    );

    await expect(
      ctx.epicController.updateEpic.fetch(
        { params: { id: epic.data.id }, body: { releaseId: release.data.id } },
        { user },
      ),
    ).rejects.toThrowError(/published/i);
  });

  it("refuses detaching from a published release", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const epic = await anEpic(user, project.id);
    const release = await aRelease(user, project.id, "0.28.0");

    await ctx.epicController.updateEpic.fetch(
      { params: { id: epic.data.id }, body: { releaseId: release.data.id } },
      { user },
    );
    await ctx.releaseController.publishRelease.fetch(
      { params: { id: release.data.id }, body: {} },
      { user },
    );

    // Both directions, and for the same reason: what 0.28.0 shipped is its
    // record, and detaching would quietly edit it.
    await expect(
      ctx.epicController.updateEpic.fetch(
        { params: { id: epic.data.id }, body: { releaseId: null } },
        { user },
      ),
    ).rejects.toThrowError(/published/i);
  });

  it("allows a no-op update on an epic in a published release", async ({
    expect,
  }) => {
    const user = await createTestUser(ctx);
    const project = await createTestProject(ctx, user);
    const epic = await anEpic(user, project.id);
    const release = await aRelease(user, project.id, "0.28.0");

    await ctx.epicController.updateEpic.fetch(
      { params: { id: epic.data.id }, body: { releaseId: release.data.id } },
      { user },
    );
    await ctx.releaseController.publishRelease.fetch(
      { params: { id: release.data.id }, body: {} },
      { user },
    );

    // Resending the SAME releaseId changes nothing about what shipped, so
    // renaming an epic that already shipped must not be refused.
    const renamed = await ctx.epicController.updateEpic.fetch(
      {
        params: { id: epic.data.id },
        body: { title: "Renamed after shipping", releaseId: release.data.id },
      },
      { user },
    );
    expect(renamed.data.title).toBe("Renamed after shipping");
  });

  it("refuses a release from another project", async ({ expect }) => {
    const user = await createTestUser(ctx);
    const mine = await createTestProject(ctx, user, "Mine");
    const theirs = await createTestProject(ctx, user, "Theirs");
    const epic = await anEpic(user, mine.id);
    const foreign = await aRelease(user, theirs.id, "0.28.0");

    await expect(
      ctx.epicController.updateEpic.fetch(
        { params: { id: epic.data.id }, body: { releaseId: foreign.data.id } },
        { user },
      ),
    ).rejects.toThrowError(/not found/i);
  });
  /**
   * The cascade (#Q2111). An epic's release is its quests' release, and the
   * four decisions behind that rule are on `ReleaseCascadeService`.
   *
   * The incident it exists for: epic #E45 sat outside `0.29.0` while all ten
   * of its quests were in it, so the release read 224/234 with ten open
   * quests an hour before it was due to be published - and `publishRelease`
   * runs no completeness check and then freezes the counts.
   */
  describe("the cascade to the epic's quests", () => {
    const aQuestInTheEpic = async (
      user: TestUser,
      projectId: number,
      epicId: number,
      title: string,
    ) => {
      const quest = await ctx.questController.createQuest.fetch(
        { body: { projectId, title, area: "orm", priority: "high" } },
        { user },
      );
      await ctx.epicController.attachQuest.fetch(
        { params: { id: epicId }, body: { questId: quest.data.id } },
        { user },
      );
      return quest.data;
    };

    const releaseOf = async (user: TestUser, questId: number) =>
      (
        await ctx.questController.getQuestById.fetch(
          { params: { id: questId } },
          { user },
        )
      ).data.releaseId;

    it("carries the release down to every quest the epic holds", async ({
      expect,
    }) => {
      const user = await createTestUser(ctx);
      const project = await createTestProject(ctx, user);
      const epic = await anEpic(user, project.id);
      const release = await aRelease(user, project.id, "0.29.0");

      const first = await aQuestInTheEpic(
        user,
        project.id,
        epic.data.id,
        "One",
      );
      const second = await aQuestInTheEpic(
        user,
        project.id,
        epic.data.id,
        "Two",
      );

      const updated = await ctx.epicController.updateEpic.fetch(
        { params: { id: epic.data.id }, body: { releaseId: release.data.id } },
        { user },
      );

      expect(await releaseOf(user, first.id)).toBe(release.data.id);
      expect(await releaseOf(user, second.id)).toBe(release.data.id);
      expect(updated.data.releaseCascade).toEqual({
        moved: 2,
        kept: 0,
        refused: [],
      });
    });

    /**
     * Decision 2. A cascade that only ever adds leaves the same drift one
     * release later, so clearing the epic's release clears its quests' too.
     */
    it("takes them back out again when the epic's release is cleared", async ({
      expect,
    }) => {
      const user = await createTestUser(ctx);
      const project = await createTestProject(ctx, user);
      const epic = await anEpic(user, project.id);
      const release = await aRelease(user, project.id, "0.29.0");
      const quest = await aQuestInTheEpic(
        user,
        project.id,
        epic.data.id,
        "One",
      );

      await ctx.epicController.updateEpic.fetch(
        { params: { id: epic.data.id }, body: { releaseId: release.data.id } },
        { user },
      );
      const cleared = await ctx.epicController.updateEpic.fetch(
        { params: { id: epic.data.id }, body: { releaseId: null } },
        { user },
      );

      expect(await releaseOf(user, quest.id)).toBeUndefined();
      expect(cleared.data.releaseCascade?.moved).toBe(1);
    });

    /**
     * Decision 1, and the one that reversed the first draft of this service.
     *
     * ⚠️ `ReleaseContentService` supports a quest whose epic ships in
     * `0.28.0` while the quest ships in `1.0.0` - "a real state, not an
     * error", pinned by `release-contents.spec.ts` - and puts it in the
     * release it NAMES so it is never in two denominators. An overwriting
     * cascade deletes that capability one epic update at a time, silently.
     * So the cascade is a DEFAULT: it fills in, and it never overrules.
     */
    it("leaves a quest that names a release of its own, and counts it", async ({
      expect,
    }) => {
      const user = await createTestUser(ctx);
      const project = await createTestProject(ctx, user);
      const epic = await anEpic(user, project.id);
      const target = await aRelease(user, project.id, "0.30.0");
      const other = await aRelease(user, project.id, "0.29.0");
      const crossing = await aQuestInTheEpic(
        user,
        project.id,
        epic.data.id,
        "Slips a release",
      );
      const follower = await aQuestInTheEpic(
        user,
        project.id,
        epic.data.id,
        "Follows",
      );

      await ctx.questController.updateQuestById.fetch(
        { params: { id: crossing.id }, body: { releaseId: other.data.id } },
        { user },
      );

      const updated = await ctx.epicController.updateEpic.fetch(
        { params: { id: epic.data.id }, body: { releaseId: target.data.id } },
        { user },
      );

      expect(await releaseOf(user, crossing.id)).toBe(other.data.id);
      expect(await releaseOf(user, follower.id)).toBe(target.data.id);
      expect(updated.data.releaseCascade).toEqual({
        moved: 1,
        kept: 1,
        refused: [],
      });
    });

    /**
     * The other half of decision 2, and the case that makes `previous` a
     * parameter rather than something the service could infer.
     *
     * A quest sitting in the epic's PREVIOUS release was following it, so it
     * follows the epic out. Told apart from the case above only by that
     * previous value: without it, "in a different release" is true of a
     * follower too, and every epic that changed release would strand its own
     * quests where they were.
     */
    it("moves a quest that was following the epic's old release", async ({
      expect,
    }) => {
      const user = await createTestUser(ctx);
      const project = await createTestProject(ctx, user);
      const epic = await anEpic(user, project.id);
      const first = await aRelease(user, project.id, "0.29.0");
      const second = await aRelease(user, project.id, "0.30.0");
      const quest = await aQuestInTheEpic(
        user,
        project.id,
        epic.data.id,
        "One",
      );

      await ctx.epicController.updateEpic.fetch(
        { params: { id: epic.data.id }, body: { releaseId: first.data.id } },
        { user },
      );
      expect(await releaseOf(user, quest.id)).toBe(first.data.id);

      const moved = await ctx.epicController.updateEpic.fetch(
        { params: { id: epic.data.id }, body: { releaseId: second.data.id } },
        { user },
      );

      expect(await releaseOf(user, quest.id)).toBe(second.data.id);
      expect(moved.data.releaseCascade).toEqual({
        moved: 1,
        kept: 0,
        refused: [],
      });
    });

    /**
     * Decision 3, at the one place it is reachable.
     *
     * ⚠️ Not through `updateEpic`: that call resolves the epic's own move
     * first, which proves both the old and the new release open, and a
     * follower is by definition in one of those or in none. The case that
     * CAN refuse is a quest joining an epic whose release has since been
     * published - legal, because the epic can still be `planned` and
     * `publishRelease` runs no completeness check. The attach succeeds, the
     * quest keeps no release, and the refusal is reported rather than thrown
     * away or turned into a failed attach.
     */
    it("reports a refused inherit instead of failing the attach", async ({
      expect,
    }) => {
      const user = await createTestUser(ctx);
      const project = await createTestProject(ctx, user);
      const epic = await anEpic(user, project.id);
      const release = await aRelease(user, project.id, "0.29.0");

      await ctx.epicController.updateEpic.fetch(
        { params: { id: epic.data.id }, body: { releaseId: release.data.id } },
        { user },
      );
      await ctx.releaseController.publishRelease.fetch(
        { params: { id: release.data.id }, body: {} },
        { user },
      );

      const late = await ctx.questController.createQuest.fetch(
        {
          body: {
            projectId: project.id,
            title: "Filed after the release shipped",
            area: "orm",
            priority: "high",
          },
        },
        { user },
      );
      const attached = await ctx.epicController.attachQuest.fetch(
        { params: { id: epic.data.id }, body: { questId: late.data.id } },
        { user },
      );

      // The quest is in the epic - the attach itself was never in doubt.
      const filed = await ctx.questController.getQuestById.fetch(
        { params: { id: late.data.id } },
        { user },
      );
      expect(filed.data.epicId).toBe(epic.data.id);
      // It did not join the published release, and the call says so.
      expect(await releaseOf(user, late.data.id)).toBeUndefined();
      expect(attached.data.releaseCascade?.moved).toBe(0);
      expect(attached.data.releaseCascade?.refused).toHaveLength(1);
      expect(attached.data.releaseCascade?.refused[0]?.shortId).toBe(
        late.data.shortId,
      );
      expect(attached.data.releaseCascade?.refused[0]?.reason).toMatch(
        /published/i,
      );
    });

    /**
     * Decision 4. Without this the drift returns the first time somebody adds
     * an eleventh quest, which is how the incident happened.
     */
    it("a quest filed into the epic afterwards inherits its release", async ({
      expect,
    }) => {
      const user = await createTestUser(ctx);
      const project = await createTestProject(ctx, user);
      const epic = await anEpic(user, project.id);
      const release = await aRelease(user, project.id, "0.29.0");

      await ctx.epicController.updateEpic.fetch(
        { params: { id: epic.data.id }, body: { releaseId: release.data.id } },
        { user },
      );

      const late = await ctx.questController.createQuest.fetch(
        {
          body: {
            projectId: project.id,
            title: "The eleventh quest",
            area: "orm",
            priority: "high",
          },
        },
        { user },
      );
      const attached = await ctx.epicController.attachQuest.fetch(
        { params: { id: epic.data.id }, body: { questId: late.data.id } },
        { user },
      );

      expect(await releaseOf(user, late.data.id)).toBe(release.data.id);
      expect(attached.data.releaseCascade).toEqual({
        moved: 1,
        kept: 0,
        refused: [],
      });
    });

    /**
     * An epic in no release must not detach the quest it is given, which is
     * what a cascade written as "always write the epic's release" would do.
     */
    it("says nothing when the epic has no release to inherit", async ({
      expect,
    }) => {
      const user = await createTestUser(ctx);
      const project = await createTestProject(ctx, user);
      const epic = await anEpic(user, project.id);
      const release = await aRelease(user, project.id, "0.29.0");

      const quest = await ctx.questController.createQuest.fetch(
        {
          body: {
            projectId: project.id,
            title: "Loose but placed",
            area: "orm",
            priority: "high",
          },
        },
        { user },
      );
      await ctx.questController.updateQuestById.fetch(
        { params: { id: quest.data.id }, body: { releaseId: release.data.id } },
        { user },
      );

      const attached = await ctx.epicController.attachQuest.fetch(
        { params: { id: epic.data.id }, body: { questId: quest.data.id } },
        { user },
      );

      expect(attached.data.releaseCascade).toBeUndefined();
      expect(await releaseOf(user, quest.data.id)).toBe(release.data.id);
    });

    /**
     * Decision 4 stops at the same line decision 1 draws: inheritance fills
     * in, it does not overrule. A quest that already names a release keeps it
     * on the way in, which is what lets a cross-release quest be FILED into
     * an epic rather than only drift into one.
     */
    it("does not overrule a joining quest that names its own release", async ({
      expect,
    }) => {
      const user = await createTestUser(ctx);
      const project = await createTestProject(ctx, user);
      const epic = await anEpic(user, project.id);
      const epicRelease = await aRelease(user, project.id, "0.29.0");
      const questRelease = await aRelease(user, project.id, "1.0.0");

      await ctx.epicController.updateEpic.fetch(
        {
          params: { id: epic.data.id },
          body: { releaseId: epicRelease.data.id },
        },
        { user },
      );

      const crossing = await ctx.questController.createQuest.fetch(
        {
          body: {
            projectId: project.id,
            title: "Slips to 1.0.0",
            area: "orm",
            priority: "high",
            releaseId: questRelease.data.id,
          },
        },
        { user },
      );
      const attached = await ctx.epicController.attachQuest.fetch(
        { params: { id: epic.data.id }, body: { questId: crossing.data.id } },
        { user },
      );

      expect(await releaseOf(user, crossing.data.id)).toBe(
        questRelease.data.id,
      );
      expect(attached.data.releaseCascade).toEqual({
        moved: 0,
        kept: 1,
        refused: [],
      });
    });

    /**
     * A rename must not read the epic's whole quest set, and must not report
     * a cascade that did not happen.
     */
    it("does not run when the epic's release did not move", async ({
      expect,
    }) => {
      const user = await createTestUser(ctx);
      const project = await createTestProject(ctx, user);
      const epic = await anEpic(user, project.id);
      const release = await aRelease(user, project.id, "0.29.0");
      await aQuestInTheEpic(user, project.id, epic.data.id, "One");

      await ctx.epicController.updateEpic.fetch(
        { params: { id: epic.data.id }, body: { releaseId: release.data.id } },
        { user },
      );
      const renamed = await ctx.epicController.updateEpic.fetch(
        { params: { id: epic.data.id }, body: { title: "Renamed epic" } },
        { user },
      );

      expect(renamed.data.releaseCascade).toBeUndefined();
    });
  });
});
