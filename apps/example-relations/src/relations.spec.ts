import { Alepha } from "alepha";
import { $client, $repository } from "alepha/orm";
import { beforeEach, describe, expect, it } from "vitest";
import { characters } from "./entities/characters.ts";
import { users } from "./entities/users.ts";
import { relations } from "./relations.ts";

/**
 * Both styles side by side, against the same data.
 *
 * `db` is the Prisma-shaped client — one binding for every entity. `plain*`
 * are today's relation-unaware repositories, kept so the before/after
 * comparison is honest rather than rhetorical.
 */
class App {
  db = $client(relations);

  plainUsers = $repository(users);
  plainCharacters = $repository(characters);
}

const seed = async (app: App) => {
  const { db } = app;

  const ana = await db.users.base.create({
    email: "ana@example.com",
    name: "Ana",
  });
  const bo = await db.users.base.create({
    email: "bo@example.com",
    name: "Bo",
  });

  const campaign = await db.campaigns.base.create({
    title: "The Sunken Archive",
    ownerId: ana.id,
  });
  const empty = await db.campaigns.base.create({
    title: "No Members Yet",
    ownerId: bo.id,
  });

  const vex = await db.characters.base.create({
    name: "Vex",
    level: 3,
    campaignId: campaign.id,
    userId: ana.id,
  });
  const rill = await db.characters.base.create({
    name: "Rill",
    level: 5,
    campaignId: campaign.id,
    userId: bo.id,
  });

  const first = await db.quests.base.create({
    title: "Find the archive",
    campaignId: campaign.id,
    createdBy: ana.id,
  });
  const second = await db.quests.base.create({
    title: "Open the vault",
    campaignId: campaign.id,
    createdBy: bo.id,
    dependsOn: first.id,
  });

  // Ana watches both quests; Bo watches only the first.
  await db.questWatchers.base.create({ questId: first.id, userId: ana.id });
  await db.questWatchers.base.create({ questId: second.id, userId: ana.id });
  await db.questWatchers.base.create({ questId: first.id, userId: bo.id });

  return { ana, bo, campaign, empty, vex, rill, first, second };
};

describe("relations", () => {
  let alepha: Alepha;
  let app: App;

  beforeEach(async () => {
    alepha = Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } });
    app = alepha.inject(App);
    await alepha.start();
  });

  describe("the problem it removes", () => {
    /**
     * The shape Lore writes by hand today — see `CampaignController.ts:255-262`,
     * which fetches a campaign's characters, maps out the user ids, then issues
     * a second query with `inArray`. The join lives in application code, and
     * every call site rewrites it.
     */
    it("today: the join is hand-written at the call site", async () => {
      const { campaign } = await seed(app);

      const campaignCharacters = await app.plainCharacters.findMany({
        where: { campaignId: { eq: campaign.id } },
      });
      const userIds = campaignCharacters.map((it) => it.userId);
      const members = await app.plainUsers.findMany({
        where: { id: { inArray: userIds } },
      });

      // ...and stitching them back together is a third step the caller owns.
      const byId = new Map(members.map((u) => [u.id, u]));
      const stitched = campaignCharacters.map((c) => ({
        ...c,
        user: byId.get(c.userId),
      }));

      expect(stitched.map((c) => c.user?.name).sort()).toEqual(["Ana", "Bo"]);
    });

    it("with relations: the same result, declared once", async () => {
      const { campaign } = await seed(app);

      const found = await app.db.characters.findMany({
        where: { campaignId: { eq: campaign.id } },
        include: { user: true },
      });

      expect(found.map((c) => c.user?.name).sort()).toEqual(["Ana", "Bo"]);
    });
  });

  describe("to-one", () => {
    it("resolves the related row", async () => {
      const { campaign, ana } = await seed(app);

      const found = await app.db.campaigns.findOne({
        where: { id: { eq: campaign.id } },
        include: { owner: true },
      });

      expect(found?.owner?.email).toBe(ana.email);
    });

    it("is undefined when the foreign key is null", async () => {
      await seed(app);

      const root = await app.db.quests.findOne({
        where: { title: { eq: "Find the archive" } },
        include: { blockedBy: true },
      });

      expect(root?.blockedBy).toBeUndefined();
    });

    it("resolves a self relation", async () => {
      const { first } = await seed(app);

      const blocked = await app.db.quests.findOne({
        where: { title: { eq: "Open the vault" } },
        include: { blockedBy: true },
      });

      expect(blocked?.blockedBy?.id).toBe(first.id);
    });
  });

  describe("to-many", () => {
    it("resolves an array", async () => {
      const { campaign } = await seed(app);

      const found = await app.db.campaigns.findOne({
        where: { id: { eq: campaign.id } },
        include: { characters: true },
      });

      expect(found?.characters.map((c) => c.name).sort()).toEqual([
        "Rill",
        "Vex",
      ]);
    });

    /**
     * A join gets this wrong: inner drops the parent, left forces
     * de-duplicating it back out.
     */
    it("is an empty array, not undefined, when nothing matches", async () => {
      const { empty } = await seed(app);

      const found = await app.db.campaigns.findOne({
        where: { id: { eq: empty.id } },
        include: { characters: true },
      });

      expect(found?.characters).toEqual([]);
    });

    /**
     * The other case a join gets wrong: `limit` would apply to the multiplied
     * row set, truncating children instead of parents.
     */
    it("does not let children truncate a limited parent query", async () => {
      const { campaign } = await seed(app);

      const found = await app.db.campaigns.findMany({
        limit: 1,
        where: { id: { eq: campaign.id } },
        include: { characters: true },
      });

      expect(found).toHaveLength(1);
      expect(found[0]!.characters).toHaveLength(2);
    });
  });

  describe("many-to-many", () => {
    it("resolves through the junction table", async () => {
      const { ana } = await seed(app);

      const found = await app.db.users.findOne({
        where: { id: { eq: ana.id } },
        include: { watching: true },
      });

      expect(found?.watching.map((q) => q.title).sort()).toEqual([
        "Find the archive",
        "Open the vault",
      ]);
    });

    it("resolves the other direction too", async () => {
      const { first } = await seed(app);

      const found = await app.db.quests.findOne({
        where: { id: { eq: first.id } },
        include: { watchers: true },
      });

      expect(found?.watchers.map((u) => u.name).sort()).toEqual(["Ana", "Bo"]);
    });

    /**
     * The junction is never exposed. A row reached through it is a plain
     * target row, with no link columns bolted on.
     */
    it("does not leak junction columns onto the result", async () => {
      const { ana } = await seed(app);

      const found = await app.db.users.findOne({
        where: { id: { eq: ana.id } },
        include: { watching: true },
      });

      const keys = Object.keys(found!.watching[0]!);
      expect(keys).toContain("title");
      expect(keys).not.toContain("userId");
      expect(keys).not.toContain("questId");
    });

    it("is empty when nothing links", async () => {
      const { bo } = await seed(app);
      await app.db.questWatchers.base.deleteMany({ userId: { eq: bo.id } });

      const found = await app.db.users.findOne({
        where: { id: { eq: bo.id } },
        include: { watching: true },
      });

      expect(found?.watching).toEqual([]);
    });
  });

  describe("filtering and shaping a relation", () => {
    it("filters with where", async () => {
      const { campaign } = await seed(app);

      const found = await app.db.campaigns.findOne({
        where: { id: { eq: campaign.id } },
        include: { characters: { where: { level: { gte: 5 } } } },
      });

      expect(found?.characters.map((c) => c.name)).toEqual(["Rill"]);
    });

    it("orders", async () => {
      const { campaign } = await seed(app);

      const found = await app.db.campaigns.findOne({
        where: { id: { eq: campaign.id } },
        include: {
          characters: { orderBy: { column: "level", direction: "desc" } },
        },
      });

      expect(found?.characters.map((c) => c.name)).toEqual(["Rill", "Vex"]);
    });

    /**
     * `limit` is per parent, like Prisma's `take` — not a cap across the whole
     * batch. With several parents that means slicing after grouping.
     */
    it("limits per parent, not across the batch", async () => {
      const { ana, bo } = await seed(app);

      const found = await app.db.users.findMany({
        where: { id: { inArray: [ana.id, bo.id] } },
        include: { watching: { limit: 1 } },
      });

      expect(found).toHaveLength(2);
      for (const user of found) {
        expect(user.watching.length).toBeLessThanOrEqual(1);
      }
      // Ana watches 2 and Bo 1; capped at 1 each, that is 2 — not 1.
      expect(found.reduce((n, u) => n + u.watching.length, 0)).toBe(2);
    });

    it("projects columns with select", async () => {
      const { campaign } = await seed(app);

      const found = await app.db.campaigns.findOne({
        where: { id: { eq: campaign.id } },
        include: { characters: { select: ["name"] } },
      });

      expect(Object.keys(found!.characters[0]!)).toEqual(["name"]);
    });

    /**
     * The grouping column has to be fetched to stitch rows back to parents,
     * but it must not survive into a result the caller did not ask for.
     */
    it("drops the join column when select omits it", async () => {
      const { campaign } = await seed(app);

      const found = await app.db.campaigns.findOne({
        where: { id: { eq: campaign.id } },
        include: { characters: { select: ["name"] } },
      });

      expect(found!.characters[0]).not.toHaveProperty("campaignId");
      expect(found!.characters).toHaveLength(2);
    });

    it("combines where, orderBy, limit and select", async () => {
      const { campaign } = await seed(app);

      const found = await app.db.campaigns.findOne({
        where: { id: { eq: campaign.id } },
        include: {
          characters: {
            where: { level: { gte: 1 } },
            orderBy: { column: "level", direction: "desc" },
            limit: 1,
            select: ["name", "level"],
          },
        },
      });

      expect(found?.characters).toEqual([{ name: "Rill", level: 5 }]);
    });
  });

  describe("root select", () => {
    /**
     * Closes the gap where `columns:` narrowed the runtime row but not the
     * type, so the compiler kept promising fields that had been stripped.
     */
    it("projects and narrows the root row", async () => {
      const { campaign } = await seed(app);

      const found = await app.db.campaigns.findOne({
        where: { id: { eq: campaign.id } },
        select: ["id", "title"],
      });

      expect(Object.keys(found!).sort()).toEqual(["id", "title"]);

      // @ts-expect-error `ownerId` was not selected, so it is not on the type.
      found?.ownerId;
    });

    it("works alongside include", async () => {
      const { campaign } = await seed(app);

      const found = await app.db.campaigns.findOne({
        where: { id: { eq: campaign.id } },
        select: ["title"],
        include: { owner: { select: ["name"] } },
      });

      expect(found?.title).toBe("The Sunken Archive");
      expect(found?.owner).toEqual({ name: "Ana" });
    });
  });

  describe("nested writes", () => {
    it("creates a to-many graph in one call", async () => {
      const { ana } = await seed(app);

      const created = await app.db.campaigns.create({
        data: {
          title: "Bright Hollow",
          ownerId: ana.id,
          characters: {
            create: [
              { name: "Sable", level: 2, userId: ana.id },
              { name: "Thorn", level: 4, userId: ana.id },
            ],
          },
        },
        include: { characters: true },
      });

      expect(created.title).toBe("Bright Hollow");
      expect(created.characters.map((c) => c.name).sort()).toEqual([
        "Sable",
        "Thorn",
      ]);
    });

    /**
     * The opposite ordering: a to-one related row must exist *before* this row,
     * because this row's foreign key points at it.
     */
    it("creates a to-one relation before the row that references it", async () => {
      await seed(app);

      const created = await app.db.campaigns.create({
        data: {
          title: "Owned By A New User",
          owner: {
            create: { email: "cy@example.com", name: "Cy" },
          },
        },
        include: { owner: true },
      });

      expect(created.owner?.name).toBe("Cy");

      const persisted = await app.db.users.findOne({
        where: { email: { eq: "cy@example.com" } },
      });
      expect(persisted).toBeDefined();
    });

    it("nests several levels deep", async () => {
      const { ana } = await seed(app);

      const created = await app.db.users.create({
        data: {
          email: "deep@example.com",
          name: "Deep",
          campaigns: {
            create: [
              {
                title: "Nested Campaign",
                characters: { create: [{ name: "Wisp", userId: ana.id }] },
              },
            ],
          },
        },
        include: { campaigns: { include: { characters: true } } },
      });

      expect(created.campaigns[0]?.characters[0]?.name).toBe("Wisp");
    });

    /**
     * One transaction for the whole graph — a failure part-way through must
     * leave nothing behind, not a parent with missing children.
     */
    it("rolls the whole graph back when a nested row fails", async () => {
      const { ana } = await seed(app);

      const before = await app.db.campaigns.count();

      await expect(
        app.db.campaigns.create({
          data: {
            title: "Doomed",
            ownerId: ana.id,
            characters: {
              // `userId` violates the foreign key, so the child insert fails
              // after the parent has already been written.
              create: [
                {
                  name: "Ghost",
                  userId: "00000000-0000-0000-0000-000000000000",
                },
              ],
            },
          },
        }),
      ).rejects.toThrow();

      expect(await app.db.campaigns.count()).toBe(before);
    });
  });

  describe("parity with the plain repository", () => {
    it("getOne throws when nothing matches", async () => {
      await seed(app);

      await expect(
        app.db.campaigns.getOne({ where: { title: { eq: "nope" } } }),
      ).rejects.toThrowError(/No 'campaigns'/);
    });

    it("findById and getById resolve relations", async () => {
      const { campaign } = await seed(app);

      const found = await app.db.campaigns.findById(campaign.id, {
        include: { owner: true },
      });
      expect(found?.owner?.name).toBe("Ana");

      const strict = await app.db.campaigns.getById(campaign.id, {
        include: { characters: true },
      });
      expect(strict.characters).toHaveLength(2);
    });

    it("getById throws for a missing id", async () => {
      await seed(app);

      await expect(app.db.campaigns.getById(9999)).rejects.toThrowError(
        /No 'campaigns' with id/,
      );
    });

    /**
     * Relations resolve for the page that came back, not the whole table —
     * page size bounds the work.
     */
    it("paginate resolves relations for the page only", async () => {
      await seed(app);

      const page = await app.db.campaigns.paginate(
        { size: 1, page: 0 },
        { include: { owner: true } },
        { count: true },
      );

      expect(page.content).toHaveLength(1);
      expect(page.content[0]!.owner?.name).toBeDefined();
      expect(page.page.totalElements).toBe(2);
    });

    it("count ignores relations", async () => {
      await seed(app);

      expect(await app.db.campaigns.count()).toBe(2);
      expect(
        await app.db.campaigns.count({
          where: { title: { like: "%Sunken%" } },
        }),
      ).toBe(1);
    });

    it("base exposes every unchanged operation, fully typed", async () => {
      const { campaign } = await seed(app);

      const updated = await app.db.campaigns.base.updateById(campaign.id, {
        title: "Renamed",
      });

      expect(updated.title).toBe("Renamed");
    });
  });

  describe("query cost", () => {
    /**
     * One query for the parents, then one per included relation — regardless
     * of how many rows came back. A per-row implementation would issue 1 + N.
     */
    it("issues one query per relation, not per row", async () => {
      const { campaign } = await seed(app);

      let queries = 0;
      alepha.events.on("repository:read:before", () => {
        queries++;
      });

      await app.db.campaigns.findMany({
        where: { id: { eq: campaign.id } },
        include: { characters: { include: { user: true } } },
      });

      // campaigns + characters + users
      expect(queries).toBe(3);
    });

    it("adds exactly one query for the junction on a many-to-many", async () => {
      const { ana } = await seed(app);

      let queries = 0;
      alepha.events.on("repository:read:before", () => {
        queries++;
      });

      await app.db.users.findMany({
        where: { id: { eq: ana.id } },
        include: { watching: true },
      });

      // users + questWatchers + quests
      expect(queries).toBe(3);
    });
  });

  describe("type safety", () => {
    it("narrows to exactly what was included", async () => {
      const { campaign } = await seed(app);

      const found = await app.db.campaigns.findOne({
        where: { id: { eq: campaign.id } },
        include: { characters: true },
      });

      const level: number | undefined = found?.characters[0]?.level;
      expect(typeof level).toBe("number");

      // @ts-expect-error `owner` was not included, so it is not on the type.
      found?.owner;

      // @ts-expect-error `user` was not included on the nested character.
      found?.characters[0]?.user;
    });

    /**
     * Caught twice: the type rejects it, and an untyped caller still gets a
     * named error rather than a relation that is silently always empty.
     */
    it("rejects a relation that was never declared", async () => {
      await seed(app);

      await expect(
        app.db.campaigns.findOne({
          // @ts-expect-error no `author` relation exists on campaigns.
          include: { author: true },
        }),
      ).rejects.toThrowError(/Unknown relation 'author' on 'campaigns'/);
    });

    it("types a to-many as an array and a to-one as optional", async () => {
      const { campaign } = await seed(app);

      const found = await app.db.campaigns.findOne({
        where: { id: { eq: campaign.id } },
        include: { characters: true, owner: true },
      });

      // @ts-expect-error `characters` is an array, not a single row.
      found?.characters.name;

      // @ts-expect-error `owner` is optional — it must be narrowed before use.
      const unchecked: string = found?.owner.email;

      expect(unchecked).toBe("ana@example.com");
    });

    it("narrows a selected relation to its projected columns", async () => {
      const { campaign } = await seed(app);

      const found = await app.db.campaigns.findOne({
        where: { id: { eq: campaign.id } },
        include: { characters: { select: ["name"] } },
      });

      const name: string | undefined = found?.characters[0]?.name;
      expect(name).toBeDefined();

      // @ts-expect-error `level` was not selected on the relation.
      found?.characters[0]?.level;
    });

    it("rejects a column that does not exist in select", async () => {
      await seed(app);

      await expect(
        app.db.campaigns.findMany({
          // @ts-expect-error `nope` is not a column of campaigns.
          select: ["nope"],
        }),
      ).rejects.toThrowError(/Column 'nope' not found/);
    });
  });
});
