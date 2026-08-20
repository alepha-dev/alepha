import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import { AlephaFake, FakeProvider } from "alepha/fake";
import { AlephaOrm } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EpicController } from "../src/api/controllers/EpicController.ts";
import { FolioController } from "../src/api/controllers/FolioController.ts";
import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { QuestController } from "../src/api/controllers/QuestController.ts";
import { LoreApi } from "../src/api/index.ts";
import { FolioLinkService } from "../src/api/services/FolioLinkService.ts";

const adminUser = { id: crypto.randomUUID(), roles: ["admin"] };

const userDataSchema = z.object({
  username: z.string(),
  email: z.email(),
});

interface TestContext {
  alepha: Alepha;
  adminUserController: AdminUserController;
  projectController: ProjectController;
  folioController: FolioController;
  questController: QuestController;
  epicController: EpicController;
  folioLinkService: FolioLinkService;
  fakeProvider: FakeProvider;
}

const setup = async (): Promise<TestContext> => {
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
  return {
    alepha,
    adminUserController: alepha.inject(AdminUserController),
    projectController: alepha.inject(ProjectController),
    folioController: alepha.inject(FolioController),
    questController: alepha.inject(QuestController),
    epicController: alepha.inject(EpicController),
    folioLinkService: alepha.inject(FolioLinkService),
    fakeProvider: alepha.inject(FakeProvider),
  };
};

const createTestUser = async (ctx: TestContext) => {
  const fakeUser = ctx.fakeProvider.generate(userDataSchema);
  const r = await ctx.adminUserController.createUser.fetch(
    { body: { ...fakeUser, roles: ["user"] } },
    { user: adminUser },
  );
  return { id: r.data.id, roles: r.data.roles };
};

/**
 * The SOURCE side of `folio_links` going polymorphic.
 *
 * Until this landed, `from_id` was a foreign key to `folios` with
 * `ON DELETE CASCADE`, so only a folio could contain a `[[...]]`
 * reference. These pin the three things that changed and that nothing
 * else can catch: a non-folio source round-trips, ids from different
 * tables no longer collide on the unique index, and the cascade that
 * used to clean up after a deleted folio is now application code.
 */
describe("folio_links — a polymorphic source", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setup();
  });
  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const seed = async () => {
    const owner = await createTestUser(ctx);
    const project = await ctx.projectController.createProject.fetch(
      { body: { title: `Links ${Date.now()}` } },
      { user: owner },
    );
    const projectId = project.data.id;
    const target = await ctx.folioController.create.fetch(
      {
        body: { projectId, title: "Target Folio", content: "I am pointed at." },
      },
      { user: owner },
    );
    return { owner, projectId, target: target.data };
  };

  it("records a QUEST as the source of a link to a folio", async () => {
    const { projectId, target } = await seed();

    // A quest id is an integer; `from_id` holds it stringified, the same
    // way `to_id` has always held quest targets.
    await ctx.folioLinkService.syncLinks(
      { kind: "quest", id: 42, projectId },
      `See [[${target.title}]] for the design.`,
    );

    const outbound = await ctx.folioLinkService.findOutbound({
      kind: "quest",
      id: 42,
    });
    expect(outbound).toHaveLength(1);
    expect(outbound[0].fromType).toBe("quest");
    expect(outbound[0].fromId).toBe("42");
    expect(outbound[0].toId).toBe(target.id);

    // And the folio sees it as a backlink — which is the whole point.
    const inbound = await ctx.folioLinkService.findInbound(target.id);
    expect(inbound).toHaveLength(1);
    expect(inbound[0].fromType).toBe("quest");
  });

  it("keeps quest 5 and epic 5 apart on the unique index", async () => {
    const { projectId, target } = await seed();
    const content = `See [[${target.title}]].`;

    // Both stringify to "5". Before `from_type` joined the unique key
    // `(from_id, to_id)` these two rows were the same row, and the second
    // sync failed on the constraint.
    await ctx.folioLinkService.syncLinks(
      { kind: "quest", id: 5, projectId },
      content,
    );
    await ctx.folioLinkService.syncLinks(
      { kind: "epic", id: 5, projectId },
      content,
    );

    const inbound = await ctx.folioLinkService.findInbound(target.id);
    expect(inbound).toHaveLength(2);
    expect(inbound.map((l) => l.fromType).sort()).toEqual(["epic", "quest"]);
  });

  it("re-syncing one source leaves the other's links alone", async () => {
    const { projectId, target } = await seed();
    const content = `See [[${target.title}]].`;
    await ctx.folioLinkService.syncLinks(
      { kind: "quest", id: 5, projectId },
      content,
    );
    await ctx.folioLinkService.syncLinks(
      { kind: "epic", id: 5, projectId },
      content,
    );

    // Emptying the quest's body must not touch the epic's row — the delete
    // inside `syncLinks` is scoped by `fromType` as well as `fromId`.
    await ctx.folioLinkService.syncLinks(
      { kind: "quest", id: 5, projectId },
      "no references any more",
    );

    const inbound = await ctx.folioLinkService.findInbound(target.id);
    expect(inbound).toHaveLength(1);
    expect(inbound[0].fromType).toBe("epic");
  });

  it("deleting a folio drops its outbound links, which no cascade does now", async () => {
    const { owner, projectId, target } = await seed();
    const source = await ctx.folioController.create.fetch(
      {
        body: {
          projectId,
          title: "Source Folio",
          content: `Points at [[${target.title}]].`,
        },
      },
      { user: owner },
    );
    expect(await ctx.folioLinkService.findInbound(target.id)).toHaveLength(1);

    await ctx.folioController.delete.fetch(
      { params: { id: source.data.id } },
      { user: owner },
    );

    // `from_id` is no longer a foreign key, so nothing in the database
    // removes this row — `FolioController.delete` has to, and this is the
    // only thing that would notice if it stopped.
    expect(await ctx.folioLinkService.findInbound(target.id)).toHaveLength(0);
  });
});

/**
 * Phase 4: the write paths actually calling `syncLinks`.
 *
 * The schema going polymorphic is invisible until something other than a
 * folio writes to it. These drive the real controllers, so they fail if a
 * handler stops syncing — which nothing else would notice, since a stale
 * link graph reads as "no backlinks" rather than as an error.
 */
describe("quests and epics as link sources, through their controllers", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setup();
  });
  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const seedTarget = async () => {
    const owner = await createTestUser(ctx);
    const project = await ctx.projectController.createProject.fetch(
      { body: { title: `Src ${Date.now()}` } },
      { user: owner },
    );
    const projectId = project.data.id;
    const target = await ctx.folioController.create.fetch(
      { body: { projectId, title: "Design Notes", content: "the target" } },
      { user: owner },
    );
    return { owner, projectId, target: target.data };
  };

  it("a link in a quest DESCRIPTION reaches the folio's backlinks", async () => {
    const { owner, projectId, target } = await seedTarget();

    await ctx.questController.createQuest.fetch(
      {
        body: {
          projectId,
          title: "Wire the thing",
          description: `Per [[${target.title}]], do the thing.`,
          area: "orm",
          priority: "high",
          objectives: [],
          attachments: [],
        },
      },
      { user: owner },
    );

    const inbound = await ctx.folioLinkService.findInbound(target.id);
    expect(inbound).toHaveLength(1);
    expect(inbound[0].fromType).toBe("quest");
  });

  it("a link in a completion summary counts too, and does not evict the description's", async () => {
    const { owner, projectId, target } = await seedTarget();
    const second = await ctx.folioController.create.fetch(
      { body: { projectId, title: "Second Folio", content: "x" } },
      { user: owner },
    );

    const quest = await ctx.questController.createQuest.fetch(
      {
        body: {
          projectId,
          title: "Two fields",
          description: `Per [[${target.title}]].`,
          area: "orm",
          priority: "high",
          objectives: [],
          attachments: [],
        },
      },
      { user: owner },
    );

    await ctx.questController.updateQuestById.fetch(
      {
        params: { id: quest.data.id },
        body: { completionMessage: `Also [[${second.data.title}]].` },
      },
      { user: owner },
    );

    // This patch does not send the description, so syncing from the
    // request body alone would have dropped the description's link here.
    const outbound = await ctx.folioLinkService.findOutbound({
      kind: "quest",
      id: quest.data.id,
    });
    expect(outbound.map((l) => l.toId).sort()).toEqual(
      [target.id, second.data.id].sort(),
    );
  });

  it("a link in an EPIC description reaches the folio's backlinks", async () => {
    const { owner, projectId, target } = await seedTarget();

    await ctx.epicController.createEpic.fetch(
      {
        params: { projectId },
        body: {
          title: "Linked epic",
          description: `Specified in [[${target.title}]].`,
        },
      },
      { user: owner },
    );

    const inbound = await ctx.folioLinkService.findInbound(target.id);
    expect(inbound).toHaveLength(1);
    expect(inbound[0].fromType).toBe("epic");
  });

  it("deleting the quest clears its links", async () => {
    const { owner, projectId, target } = await seedTarget();
    const quest = await ctx.questController.createQuest.fetch(
      {
        body: {
          projectId,
          title: "Doomed",
          description: `Per [[${target.title}]].`,
          area: "orm",
          priority: "high",
          objectives: [],
          attachments: [],
        },
      },
      { user: owner },
    );
    expect(await ctx.folioLinkService.findInbound(target.id)).toHaveLength(1);

    await ctx.questController.deleteQuest.fetch(
      { params: { id: quest.data.id } },
      { user: owner },
    );

    expect(await ctx.folioLinkService.findInbound(target.id)).toHaveLength(0);
  });
});

/**
 * Phase 5: a folio rename rewrites the references that named it.
 *
 * The gap these close was real and silent — renaming a folio left every
 * `[[Old Title]]` in the project pointing at nothing, in the markdown, with
 * no error anywhere. Driven by the link table, so it reaches quests and
 * epics, which a folio-only scan never could.
 */
describe("renaming a folio rewrites the references to it", () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setup();
  });
  afterEach(async () => {
    await ctx.alepha.stop();
  });

  const seedTarget = async () => {
    const owner = await createTestUser(ctx);
    const project = await ctx.projectController.createProject.fetch(
      { body: { title: `Ren ${Date.now()}` } },
      { user: owner },
    );
    const projectId = project.data.id;
    const target = await ctx.folioController.create.fetch(
      { body: { projectId, title: "Old Title", content: "target" } },
      { user: owner },
    );
    return { owner, projectId, target: target.data };
  };

  const rename = async (
    ctxTarget: { id: string },
    owner: { id: string; roles: string[] },
    title: string,
  ) =>
    ctx.folioController.update.fetch(
      { params: { id: ctxTarget.id }, body: { title } },
      { user: owner },
    );

  it("rewrites the token inside another FOLIO", async () => {
    const { owner, projectId, target } = await seedTarget();
    const source = await ctx.folioController.create.fetch(
      {
        body: {
          projectId,
          title: "Source",
          content: "See [[Old Title]] and [[Old Title#section]].",
        },
      },
      { user: owner },
    );

    await rename(target, owner, "New Title");

    const after = await ctx.folioController.get.fetch(
      { params: { id: source.data.id } },
      { user: owner },
    );
    // The anchor survives; the title is swapped in place.
    expect(after.data.content).toBe(
      "See [[New Title]] and [[New Title#section]].",
    );
  });

  it("rewrites the token inside a QUEST, which a folio-only scan would miss", async () => {
    const { owner, projectId, target } = await seedTarget();
    const quest = await ctx.questController.createQuest.fetch(
      {
        body: {
          projectId,
          title: "Q",
          description: "Per [[Old Title]].",
          area: "orm",
          priority: "high",
          objectives: [],
          attachments: [],
        },
      },
      { user: owner },
    );

    await rename(target, owner, "New Title");

    const after = await ctx.questController.getQuestById.fetch(
      { params: { id: quest.data.id } },
      { user: owner },
    );
    expect(after.data.description).toBe("Per [[New Title]].");

    // And the link survives the rename rather than being dropped.
    const inbound = await ctx.folioLinkService.findInbound(target.id);
    expect(inbound).toHaveLength(1);
    expect(inbound[0].fromType).toBe("quest");
  });

  it("leaves prose and other entity kinds alone", async () => {
    const { owner, projectId, target } = await seedTarget();
    const source = await ctx.folioController.create.fetch(
      {
        body: {
          projectId,
          title: "Careful",
          // Bare prose naming the folio, a QUEST token that merely shares
          // the name, and the real reference. Only the last may change.
          content:
            "Old Title is a phrase. [[quest:Old Title]] is a quest. [[Old Title]] is the folio.",
        },
      },
      { user: owner },
    );

    await rename(target, owner, "New Title");

    const after = await ctx.folioController.get.fetch(
      { params: { id: source.data.id } },
      { user: owner },
    );
    expect(after.data.content).toBe(
      "Old Title is a phrase. [[quest:Old Title]] is a quest. [[New Title]] is the folio.",
    );
  });

  it("does not touch a #N reference, which never went stale", async () => {
    const { owner, projectId, target } = await seedTarget();
    const source = await ctx.folioController.create.fetch(
      {
        body: {
          projectId,
          title: "ByNumber",
          content: `See [[#${target.shortId}]].`,
        },
      },
      { user: owner },
    );

    await rename(target, owner, "New Title");

    const after = await ctx.folioController.get.fetch(
      { params: { id: source.data.id } },
      { user: owner },
    );
    expect(after.data.content).toBe(`See [[#${target.shortId}]].`);
  });
});
