import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { EpicController } from "../src/api/controllers/EpicController.ts";
import { FeedbackController } from "../src/api/controllers/FeedbackController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { QuestController } from "../src/api/controllers/QuestController.ts";
import { LoreApi } from "../src/api/index.ts";

/**
 * What a completed quest still accepts, and what it does not (#1752).
 *
 * The gate freezes the quest BODY - title, description, objectives - as an
 * audit record of what was closed. It used to freeze almost everything else
 * too, which made the record less accurate rather than more: `feedbackId` has
 * no other writer at all and is normally only established after the fact, and
 * `area` was already mutable on a completed quest through the areas settings
 * page, since `AreaService.rename` filters on nothing but the project.
 *
 * ⚠️ There was no spec on this gate before, in either direction. The half
 * that matters most is the REFUSALS: widening an allowlist is exactly the
 * change that silently takes the body with it.
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
  questController: QuestController;
  feedbackController: FeedbackController;
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
    questController: alepha.inject(QuestController),
    feedbackController: alepha.inject(FeedbackController),
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

describe("editing a completed quest", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  /**
   * A project with one quest taken all the way to completed, which is the
   * only state this gate looks at.
   */
  const seed = async () => {
    const owner = await createTestUser(ctx);
    const project = (
      await ctx.projectController.createProject.fetch(
        {
          body: {
            title: `Frozen ${Date.now()}`,
            capabilities: [
              { key: "work" as const },
              { key: "knowledge" as const },
              { key: "support" as const },
            ],
          },
        },
        { user: owner },
      )
    ).data;

    const quest = (
      await ctx.questController.createQuest.fetch(
        {
          body: {
            projectId: project.id,
            title: "The original title",
            description: "As closed",
            area: "lore/quests",
            priority: "medium",
            tags: ["feat"],
          },
        },
        { user: owner },
      )
    ).data;

    await ctx.questController.acceptQuest.fetch(
      { params: { id: quest.id } },
      { user: owner },
    );
    await ctx.questController.completeQuest.fetch(
      { params: { id: quest.id }, body: {} },
      { user: owner },
    );

    return { owner, project, quest };
  };

  const update = async (
    ctx: TestContext,
    id: number,
    body: Record<string, unknown>,
    user: { id: string; roles: string[] },
  ) =>
    ctx.questController.updateQuestById.fetch(
      { params: { id }, body: body as never },
      { user },
    );

  it("accepts area, tags, completionMessage and feedbackId", async ({
    expect,
  }) => {
    const { owner, project, quest } = await seed();

    // The feedback has to exist and be ACCEPTED before it can be linked - the
    // guard below the gate, still running on the completed path.
    const feedback = (
      await ctx.feedbackController.submitFeedback.fetch(
        {
          params: { projectId: project.id },
          body: { title: "It crashes", description: "on save" },
        },
        { user: owner },
      )
    ).data;
    await ctx.feedbackController.acceptFeedback.fetch(
      { params: { projectId: project.id, feedbackId: feedback.id } },
      { user: owner },
    );

    const withArea = await update(
      ctx,
      quest.id,
      { area: "lore/feedback" },
      owner,
    );
    expect(withArea.data.area).toBe("lore/feedback");

    const withTags = await update(
      ctx,
      quest.id,
      { tags: ["bug", "regression"] },
      owner,
    );
    expect(withTags.data.tags).toEqual(["bug", "regression"]);

    const withMessage = await update(
      ctx,
      quest.id,
      { completionMessage: "Shipped in the morning" },
      owner,
    );
    expect(withMessage.data.completionMessage).toBe("Shipped in the morning");

    // The field this quest was raised for: 22 completed quests could not be
    // linked to the feedback they resolved.
    const linked = await update(
      ctx,
      quest.id,
      { feedbackId: feedback.id },
      owner,
    );
    expect(linked.data.feedbackId).toBe(feedback.id);

    // And unlinking comes with it, which is what `feedback_shortId: 0` maps to.
    const unlinked = await update(ctx, quest.id, { feedbackId: null }, owner);
    expect(unlinked.data.feedbackId).toBeFalsy();

    // Nothing above touched the body.
    expect(unlinked.data.title).toBe("The original title");
    expect(unlinked.data.description).toBe("As closed");
  });

  it("still refuses the body and the planned values", async ({ expect }) => {
    const { owner, quest } = await seed();

    for (const body of [
      { title: "Rewritten after the fact" },
      { description: "A tidier story" },
      { objectives: [{ title: "Invented afterwards", completed: false }] },
      { priority: "high" },
      { size: 5 },
      { estimateMinutes: 120 },
      { dueAt: "2027-01-01T00:00:00.000Z" },
    ]) {
      // Matched on the message, not merely on "it threw": a schema that
      // happened to reject one of these would pass a bare `toThrow()` while
      // proving nothing about the gate.
      await expect(
        update(ctx, quest.id, body, owner),
        `${Object.keys(body)[0]} should be refused on a completed quest`,
      ).rejects.toThrow(/can be edited on a completed quest/);
    }

    // Unchanged, all of it.
    const after = (
      await ctx.questController.getQuestById.fetch(
        { params: { id: quest.id } },
        { user: owner },
      )
    ).data;
    expect(after.title).toBe("The original title");
    expect(after.description).toBe("As closed");
    expect(after.priority).toBe("medium");
  });

  /**
   * The gate runs BEFORE the field-specific guards, so widening it widens
   * what reaches them. This is the half a naive widening breaks: an allowed
   * field must not become an unchecked one.
   */
  it("keeps the feedback guards running on the completed path", async ({
    expect,
  }) => {
    const { owner, project, quest } = await seed();

    // Not in this project at all.
    await expect(
      update(ctx, quest.id, { feedbackId: 999_999 }, owner),
    ).rejects.toThrow();

    // In the project, but still pending.
    const pending = (
      await ctx.feedbackController.submitFeedback.fetch(
        {
          params: { projectId: project.id },
          body: { title: "Untriaged", description: "not accepted yet" },
        },
        { user: owner },
      )
    ).data;
    await expect(
      update(ctx, quest.id, { feedbackId: pending.id }, owner),
    ).rejects.toThrow();
  });

  /**
   * The other asymmetry the audit turned up: `epic_number` is translated into
   * an `EpicController.attachQuest` call that runs before the field update and
   * has never consulted `completedAt`. Left ungated deliberately - an epic is
   * filing metadata exactly like a release, so under the widened rule it now
   * AGREES with the gate instead of contradicting it. Pinned here so that
   * agreement is a decision on the record rather than an oversight.
   */
  it("files a completed quest under an epic", async ({ expect }) => {
    const { owner, project, quest } = await seed();

    const epics = ctx.alepha.inject(EpicController);
    const epic = (
      await epics.createEpic.fetch(
        {
          params: { projectId: project.id },
          body: { title: "The initiative" },
        },
        { user: owner },
      )
    ).data;

    // The path MCP takes: `epic_number` is not a field on the update body at
    // all, it is translated into this call, which runs first and consults
    // nothing about completion.
    await epics.attachQuest.fetch(
      { params: { id: epic.id }, body: { questId: quest.id } },
      { user: owner },
    );

    const after = (
      await ctx.questController.getQuestById.fetch(
        { params: { id: quest.id } },
        { user: owner },
      )
    ).data;
    expect(after.epicId).toBe(epic.id);
  });
});
