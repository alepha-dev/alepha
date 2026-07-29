import { Alepha } from "alepha";
import { $repository } from "alepha/orm";
import { beforeEach, describe, expect, it } from "vitest";
import { characters } from "./entities/characters.ts";
import { users } from "./entities/users.ts";
import { relations } from "./relations.ts";

/**
 * Both styles side by side, against the same data.
 *
 * `plain` is today's API. `db` is the same repositories with relations
 * declared. Nothing else differs, so the comparisons below are honest.
 */
class App {
  // Declaration order matters: an entity's foreign keys are resolved against
  // the tables registered before it, so referenced entities come first.
  users = $repository(relations, "users");
  campaigns = $repository(relations, "campaigns");
  characters = $repository(relations, "characters");
  quests = $repository(relations, "quests");

  plainUsers = $repository(users);
  plainCharacters = $repository(characters);
}

const seed = async (app: App) => {
  const ana = await app.plainUsers.create({
    email: "ana@example.com",
    name: "Ana",
  });
  const bo = await app.plainUsers.create({
    email: "bo@example.com",
    name: "Bo",
  });

  const campaign = await app.campaigns.base.create({
    title: "The Sunken Archive",
    ownerId: ana.id,
  });
  const empty = await app.campaigns.base.create({
    title: "No Members Yet",
    ownerId: bo.id,
  });

  await app.characters.base.create({
    name: "Vex",
    level: 3,
    campaignId: campaign.id,
    userId: ana.id,
  });
  await app.characters.base.create({
    name: "Rill",
    level: 5,
    campaignId: campaign.id,
    userId: bo.id,
  });

  const first = await app.quests.base.create({
    title: "Find the archive",
    campaignId: campaign.id,
    createdBy: ana.id,
  });
  const second = await app.quests.base.create({
    title: "Open the vault",
    campaignId: campaign.id,
    createdBy: bo.id,
    dependsOn: first.id,
  });

  return { ana, bo, campaign, empty, first, second };
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
     * This is the shape Lore writes by hand today — see
     * `CampaignController.ts:255-262`, which fetches a campaign's characters,
     * maps out the user ids, then issues a second query with `inArray`. The
     * join lives in application code, and every call site rewrites it.
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

      expect(stitched).toHaveLength(2);
      expect(stitched.map((c) => c.user?.name).sort()).toEqual(["Ana", "Bo"]);
    });

    it("with relations: the same result, declared once", async () => {
      const { campaign } = await seed(app);

      const found = await app.characters.findMany({
        where: { campaignId: { eq: campaign.id } },
        include: { user: true },
      });

      expect(found).toHaveLength(2);
      expect(found.map((c) => c.user?.name).sort()).toEqual(["Ana", "Bo"]);
    });
  });

  describe("to-one", () => {
    it("resolves the related row", async () => {
      const { campaign, ana } = await seed(app);

      const found = await app.campaigns.findOne({
        where: { id: { eq: campaign.id } },
        include: { owner: true },
      });

      expect(found?.owner?.email).toBe(ana.email);
    });

    it("is undefined when the foreign key is null", async () => {
      await seed(app);

      const root = await app.quests.findOne({
        where: { title: { eq: "Find the archive" } },
        include: { blockedBy: true },
      });

      expect(root?.blockedBy).toBeUndefined();
    });

    it("resolves a self relation", async () => {
      const { first } = await seed(app);

      const blocked = await app.quests.findOne({
        where: { title: { eq: "Open the vault" } },
        include: { blockedBy: true },
      });

      expect(blocked?.blockedBy?.id).toBe(first.id);
      expect(blocked?.blockedBy?.title).toBe("Find the archive");
    });
  });

  describe("to-many", () => {
    it("resolves an array", async () => {
      const { campaign } = await seed(app);

      const found = await app.campaigns.findOne({
        where: { id: { eq: campaign.id } },
        include: { characters: true },
      });

      expect(found?.characters.map((c) => c.name).sort()).toEqual([
        "Rill",
        "Vex",
      ]);
    });

    /**
     * The case a SQL join gets wrong. Joining would drop the parent row
     * entirely (inner) or force de-duplicating it back out (left).
     */
    it("is an empty array, not undefined, when nothing matches", async () => {
      const { empty } = await seed(app);

      const found = await app.campaigns.findOne({
        where: { id: { eq: empty.id } },
        include: { characters: true },
      });

      expect(found?.characters).toEqual([]);
    });

    /**
     * The other case a join gets wrong: `limit` would apply to the multiplied
     * row set, silently truncating children instead of parents.
     */
    it("does not let children truncate a limited parent query", async () => {
      const { campaign } = await seed(app);

      const found = await app.campaigns.findMany({
        limit: 1,
        where: { id: { eq: campaign.id } },
        include: { characters: true },
      });

      expect(found).toHaveLength(1);
      expect(found[0]!.characters).toHaveLength(2);
    });
  });

  describe("nested", () => {
    it("follows relations two levels deep", async () => {
      const { campaign } = await seed(app);

      const found = await app.campaigns.findOne({
        where: { id: { eq: campaign.id } },
        include: { characters: { include: { user: true } } },
      });

      const names = found?.characters
        .map((c) => c.user?.name)
        .filter(Boolean)
        .sort();

      expect(names).toEqual(["Ana", "Bo"]);
    });

    it("mixes to-many and to-one at the same level", async () => {
      const { campaign, ana } = await seed(app);

      const found = await app.campaigns.findOne({
        where: { id: { eq: campaign.id } },
        include: { owner: true, quests: { include: { author: true } } },
      });

      expect(found?.owner?.name).toBe("Ana");
      expect(found?.quests).toHaveLength(2);
      expect(found?.quests.map((q) => q.author?.name).sort()).toEqual([
        "Ana",
        "Bo",
      ]);
      expect(found?.owner?.id).toBe(ana.id);
    });
  });

  describe("query cost", () => {
    /**
     * The reason to batch rather than loop. One query for the parents, then
     * one per included relation — regardless of how many rows came back. A
     * naive per-row implementation would issue 1 + N.
     */
    it("issues one query per relation, not per row", async () => {
      const { campaign } = await seed(app);

      let queries = 0;
      alepha.events.on("repository:read:before", () => {
        queries++;
      });

      await app.campaigns.findMany({
        where: { id: { eq: campaign.id } },
        include: { characters: { include: { user: true } } },
      });

      // campaigns + characters + users
      expect(queries).toBe(3);
    });
  });

  describe("type safety", () => {
    it("narrows to exactly what was included", async () => {
      const { campaign } = await seed(app);

      const found = await app.campaigns.findOne({
        where: { id: { eq: campaign.id } },
        include: { characters: true },
      });

      // Included: present and typed.
      const level: number | undefined = found?.characters[0]?.level;
      expect(typeof level).toBe("number");

      // @ts-expect-error `owner` was not included, so it is not on the type.
      found?.owner;

      // @ts-expect-error `user` was not included on the nested character.
      found?.characters[0]?.user;
    });

    /**
     * Caught twice: the `@ts-expect-error` proves the type rejects it, and the
     * rejection proves an untyped caller still gets a named error rather than
     * a relation that is silently always empty.
     */
    it("rejects a relation that was never declared", async () => {
      await seed(app);

      await expect(
        app.campaigns.findOne({
          // @ts-expect-error no `author` relation exists on campaigns.
          include: { author: true },
        }),
      ).rejects.toThrowError(/Unknown relation 'author' on 'campaigns'/);
    });

    it("types a to-many as an array and a to-one as optional", async () => {
      const { campaign } = await seed(app);

      const found = await app.campaigns.findOne({
        where: { id: { eq: campaign.id } },
        include: { characters: true, owner: true },
      });

      // @ts-expect-error `characters` is an array, not a single row.
      found?.characters.name;

      // @ts-expect-error `owner` is optional — it must be narrowed before use.
      const unchecked: string = found?.owner.email;

      // The type is what is being asserted here; at runtime the owner does
      // exist, which is exactly why the compiler has to force the narrowing.
      expect(unchecked).toBe("ana@example.com");
      expect(found?.owner?.email).toBe("ana@example.com");
    });
  });
});
