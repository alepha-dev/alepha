import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, it } from "vitest";

import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { QuestController } from "../src/api/controllers/QuestController.ts";
import { LoreApi } from "../src/api/index.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

/**
 * What an `updated` history row now records (quest #1318, feedback #2004).
 *
 * Every mutation used to write one bare `updated`, so uploading an attachment
 * and renaming a quest produced the same "updated the quest" line and two
 * unrelated edits were indistinguishable in the feed.
 *
 * ⚠️ The description of that quest says the rows "already know which fields
 * moved". They did not: the history entry had `action`, `objectiveId`,
 * `targetUserId` and `column`, and nothing about fields. `changes` is new.
 */
describe("quest history records what changed", () => {
  let ctx: Awaited<ReturnType<typeof setup>>;

  const setup = async () => {
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

    const admin = alepha.inject(AdminUserController);
    const projects = alepha.inject(ProjectController);
    const quests = alepha.inject(QuestController);
    const fake = alepha.inject(FakeProvider);

    const created = await admin.createUser.fetch(
      { body: { ...fake.generate(userDataSchema), roles: ["user"] } },
      { user: adminUser },
    );
    const owner = { id: created.data.id, roles: created.data.roles };

    const project = await projects.createProject.fetch(
      { body: { title: "History probe" } },
      { user: owner },
    );

    const quest = await quests.createQuest.fetch(
      {
        body: {
          title: "Original title",
          description: "<p>before</p>",
          area: "core",
          priority: "medium",
          projectId: project.data.id,
          objectives: [],
          tags: ["alpha"],
        },
      },
      { user: owner },
    );

    /**
     * Applies one patch and returns the `changes` of the row it produced.
     */
    const edit = async (body: Record<string, unknown>) => {
      const before = await quests.getQuestById.fetch(
        { params: { id: quest.data.id } },
        { user: owner },
      );
      const after = await quests.updateQuestById.fetch(
        {
          params: { id: quest.data.id },
          body: { expectedUpdatedAt: before.data.updatedAt, ...body } as never,
        },
        { user: owner },
      );
      const history = after.data.history;
      return history[history.length - 1]?.changes ?? [];
    };

    return { alepha, edit, quests, owner, quest: quest.data };
  };

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(async () => {
    await ctx.alepha.stop();
  });

  it("names a priority change with both values", async ({ expect }) => {
    expect(await ctx.edit({ priority: "high" })).toContainEqual({
      field: "priority",
      from: "medium",
      to: "high",
    });
  });

  it("names the area a quest moved to", async ({ expect }) => {
    expect(await ctx.edit({ area: "lore/quests" })).toContainEqual({
      field: "area",
      from: "core",
      to: "lore/quests",
    });
  });

  it("keeps the OLD title, since the new one is the heading above the feed", async ({
    expect,
  }) => {
    expect(await ctx.edit({ title: "Renamed" })).toContainEqual({
      field: "title",
      from: "Original title",
    });
  });

  it("records a description edit with no values", async ({ expect }) => {
    // A markdown diff is unreadable in a one-line feed entry, and "edited the
    // description" is the honest whole of it.
    expect(await ctx.edit({ description: "<p>after</p>" })).toContainEqual({
      field: "description",
    });
  });

  it("splits a tag change into what was added and what was removed", async ({
    expect,
  }) => {
    const changes = await ctx.edit({ tags: ["beta", "gamma"] });
    expect(changes).toContainEqual({ field: "tags", to: "beta, gamma" });
    expect(changes).toContainEqual({ field: "tags", from: "alpha" });
  });

  it("records every field a single save moved", async ({ expect }) => {
    const changes = await ctx.edit({
      priority: "low",
      area: "lore/ui",
      title: "Both at once",
    });
    expect(changes.map((change) => change.field).sort()).toEqual([
      "area",
      "priority",
      "title",
    ]);
  });

  it("writes no change for a save that moved nothing", async ({ expect }) => {
    // The row is still written - somebody did press save - but it carries no
    // claim about a field, so the feed falls back to the generic line rather
    // than inventing one.
    expect(await ctx.edit({ priority: "medium" })).toEqual([]);
  });

  it("does not report the bookkeeping fields as changes", async ({
    expect,
  }) => {
    // `attachments` is rewritten on every save to fold in images embedded in
    // the markdown, so a diff that trusted the patch would report an
    // attachment change on an edit that touched none.
    const changes = await ctx.edit({ description: "<p>no images</p>" });
    expect(changes.map((change) => change.field)).toEqual(["description"]);
  });
});
