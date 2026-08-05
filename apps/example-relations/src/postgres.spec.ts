import { Alepha } from "alepha";
import { $repositories, DatabaseProvider } from "alepha/orm";
import { NodePostgresProvider } from "alepha/orm/postgres";
import { beforeEach, describe, expect, it } from "vitest";
import { relations } from "./relations.ts";

/**
 * The same feature set against Postgres.
 *
 * Every other spec here runs on SQLite, and almost nothing about the two is
 * shared below the declaration:
 *
 * - the relational query builder emits correlated subqueries on SQLite and
 *   lateral joins with `json_agg` on Postgres;
 * - the database class is different, with a different constructor;
 * - a transaction is a real object with its own session, where on SQLite the
 *   transaction *is* the connection;
 * - the driver returns native types rather than the handful SQLite has.
 *
 * So a translation that works on SQLite proves very little about the dialect a
 * self-hosted deployment would run. These are the tests only Postgres can
 * fail.
 */
class App {
  db = $repositories(relations);
}

describe("relations on postgres", () => {
  let alepha: Alepha;
  let app: App;
  let provider: DatabaseProvider;

  const seed = async () => {
    const ana = await app.db.users.create({
      data: { email: "ana@example.com", name: "Ana" },
    });
    const bo = await app.db.users.create({
      data: { email: "bo@example.com", name: "Bo" },
    });
    const campaign = await app.db.campaigns.create({
      data: { title: "The Sunken Archive", ownerId: ana.id },
    });
    const empty = await app.db.campaigns.create({
      data: { title: "No Members Yet", ownerId: bo.id },
    });
    await app.db.characters.create({
      data: { name: "Vex", level: 3, campaignId: campaign.id, userId: ana.id },
    });
    await app.db.characters.create({
      data: { name: "Rill", level: 5, campaignId: campaign.id, userId: bo.id },
    });
    const first = await app.db.quests.create({
      data: {
        title: "Find the archive",
        campaignId: campaign.id,
        createdBy: ana.id,
        tags: ["urgent", "lore"],
      },
    });
    const second = await app.db.quests.create({
      data: {
        title: "Open the vault",
        campaignId: campaign.id,
        createdBy: bo.id,
        dependsOn: first.id,
      },
    });
    const doomed = await app.db.quests.create({
      data: {
        title: "Deleted quest",
        campaignId: campaign.id,
        createdBy: ana.id,
      },
    });
    await app.db.quests.deleteById(doomed.id);

    await app.db.questWatchers.create({
      data: { questId: first.id, userId: ana.id },
    });
    await app.db.questWatchers.create({
      data: { questId: second.id, userId: ana.id },
    });
    await app.db.questWatchers.create({
      data: { questId: first.id, userId: bo.id },
    });

    return { ana, bo, campaign, empty, first, second, doomed };
  };

  beforeEach(async () => {
    alepha = Alepha.create({
      env: {
        DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:15432/postgres",
      },
    }).with({ provide: DatabaseProvider, use: NodePostgresProvider });
    app = alepha.inject(App);
    // The provider creates -- and drops -- a throwaway schema per run, so
    // there is nothing to clean up between tests.
    await alepha.start();
    provider = alepha.inject(DatabaseProvider);
  });

  describe("the dialect strategy", () => {
    it("uses lateral joins, one per included relation", async () => {
      const { campaign } = await seed();

      const { sql } = app.db.campaigns.toSQL({
        where: { id: { eq: campaign.id } },
        include: { owner: true, characters: true, quests: true },
      });

      expect(sql.match(/lateral/g)).toHaveLength(3);
      expect(sql.match(/from "[^"]+"\."campaigns"/g)).toHaveLength(1);
    });

    it("aggregates a to-many with json, rather than multiplying rows", async () => {
      const { campaign } = await seed();

      const rows = await app.db.campaigns.findMany({
        where: { id: { eq: campaign.id } },
        include: { characters: true },
      });

      // A plain join would return one row per character.
      expect(rows).toHaveLength(1);
      expect(rows[0]!.characters).toHaveLength(2);
    });
  });

  describe("shapes", () => {
    it("resolves a to-one", async () => {
      const { campaign, ana } = await seed();

      const found = await app.db.campaigns.findOne({
        where: { id: { eq: campaign.id } },
        include: { owner: true },
      });

      expect(found?.owner).toMatchObject({ id: ana.id, name: "Ana" });
    });

    /**
     * An absent to-one comes back here from a lateral join that matched
     * nothing, which is not the code path SQLite takes.
     */
    it("gives undefined for a to-one whose key is null", async () => {
      await seed();

      const root = await app.db.quests.findOne({
        where: { title: { eq: "Find the archive" } },
        include: { blockedBy: true },
      });

      expect(root?.blockedBy).toBeUndefined();
    });

    it("resolves a self relation", async () => {
      const { first } = await seed();

      const blocked = await app.db.quests.findOne({
        where: { title: { eq: "Open the vault" } },
        include: { blockedBy: true },
      });

      expect(blocked?.blockedBy?.id).toBe(first.id);
    });

    /**
     * `json_agg` over no rows is NULL rather than an empty array, so an empty
     * to-many is exactly where a dialect difference surfaces as `undefined`.
     */
    it("gives an empty array for a to-many that matched nothing", async () => {
      const { empty } = await seed();

      const found = await app.db.campaigns.findOne({
        where: { id: { eq: empty.id } },
        include: { characters: true },
      });

      expect(found?.characters).toEqual([]);
    });

    it("resolves a many-to-many through its junction", async () => {
      const { ana } = await seed();

      const found = await app.db.users.findOne({
        where: { id: { eq: ana.id } },
        include: { watching: true },
      });

      expect(found?.watching.map((q) => q.title).sort()).toEqual([
        "Find the archive",
        "Open the vault",
      ]);
    });

    it("nests three levels deep in one statement", async () => {
      const { campaign } = await seed();

      const args = {
        where: { id: { eq: campaign.id } },
        include: { quests: { include: { author: true } } },
      } as const;

      const found = await app.db.campaigns.findOne(args);
      expect(found?.quests.map((q) => q.author?.name).sort()).toEqual([
        "Ana",
        "Bo",
      ]);

      expect(
        app.db.campaigns.toSQL(args).sql.match(/from "[^"]+"\."campaigns"/g),
      ).toHaveLength(1);
    });
  });

  describe("relation-level query", () => {
    it("orders and limits inside the relation", async () => {
      const { campaign } = await seed();

      const found = await app.db.campaigns.findOne({
        where: { id: { eq: campaign.id } },
        include: {
          characters: {
            orderBy: { column: "level", direction: "desc" },
            limit: 1,
          },
        },
      });

      expect(found?.characters.map((c) => c.name)).toEqual(["Rill"]);
    });

    /**
     * The limit binds per parent. Inside a lateral subquery that is what it
     * means; on a plain join it would cap the whole result and starve every
     * parent but the first.
     */
    it("limits per parent, not across the result", async () => {
      const { ana, bo } = await seed();

      const rows = await app.db.users.findMany({
        where: { id: { inArray: [ana.id, bo.id] } },
        include: { watching: { limit: 1 } },
      });

      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.watching).toHaveLength(1);
      }
    });

    it("projects relation columns with select", async () => {
      const { campaign } = await seed();

      const found = await app.db.campaigns.findOne({
        where: { id: { eq: campaign.id } },
        include: { characters: { select: ["name"] } },
      });

      expect(Object.keys(found!.characters[0]!)).toEqual(["name"]);
    });

    /**
     * Projecting the parent away must not take the relation with it: the join
     * key is still needed to resolve, and must not resurface in the result.
     */
    it("keeps a relation working when select omits its join column", async () => {
      const { campaign } = await seed();

      const found = await app.db.campaigns.findOne({
        where: { id: { eq: campaign.id } },
        select: ["title"],
        include: { owner: true },
      });

      expect(found?.owner?.name).toBe("Ana");
      expect(Object.keys(found as object).sort()).toEqual(["owner", "title"]);
    });
  });

  describe("cross-cutting predicates", () => {
    it("hides soft-deleted rows inside a relation", async () => {
      const { campaign } = await seed();

      const found = await app.db.campaigns.findOne({
        where: { id: { eq: campaign.id } },
        include: { quests: true },
      });

      expect(found?.quests.map((q) => q.title).sort()).toEqual([
        "Find the archive",
        "Open the vault",
      ]);
    });

    it("hides them through a many-to-many too", async () => {
      const { ana, doomed } = await seed();

      await app.db.questWatchers.create({
        data: { questId: doomed.id, userId: ana.id },
      });

      const found = await app.db.users.findOne({
        where: { id: { eq: ana.id } },
        include: { watching: true },
      });

      expect(found?.watching.map((q) => q.title)).not.toContain(
        "Deleted quest",
      );
    });

    /**
     * A caller's own relation filter is added to the predicate, never
     * substituted for it.
     */
    it("still hides them when the caller adds its own relation filter", async () => {
      const { campaign } = await seed();

      const found = await app.db.campaigns.findOne({
        where: { id: { eq: campaign.id } },
        include: { quests: { where: { title: { like: "%quest%" } } } },
      });

      // "Deleted quest" is the only row matching that filter, and it is gone.
      expect(found?.quests).toEqual([]);
    });
  });

  describe("decoding", () => {
    it("decodes a json array reached through a relation", async () => {
      const { campaign } = await seed();

      const found = await app.db.campaigns.findOne({
        where: { id: { eq: campaign.id } },
        include: { quests: true },
      });

      const tagged = found?.quests.find((q) => q.title === "Find the archive");
      expect(tagged?.tags).toEqual(["urgent", "lore"]);
    });

    /**
     * Postgres hands back native types the driver has to map. A uuid key
     * reached through a relation is where a lost decode would show up.
     */
    it("decodes uuid and integer keys through a relation", async () => {
      const { campaign, ana } = await seed();

      const found = await app.db.campaigns.findOne({
        where: { id: { eq: campaign.id } },
        include: { characters: true },
      });

      expect(typeof found!.characters[0]!.userId).toBe("string");
      expect(found!.characters.map((c) => c.userId)).toContain(ana.id);
      expect(typeof found!.characters[0]!.campaignId).toBe("number");
    });

    /**
     * Validation still runs on a row reached through a relation. Drifting
     * `tags` the way the SQLite spec does is impossible here -- Postgres backs
     * it with a real array column -- so this drifts a value the column accepts
     * and the schema does not.
     */
    it("rejects a row that drifted from its schema, through a relation", async () => {
      const { campaign } = await seed();

      await provider.execute(
        `update ${provider.schema}.users set email = 'not-an-email'` as never,
      );

      await expect(
        app.db.campaigns.findOne({
          where: { id: { eq: campaign.id } },
          include: { owner: true },
        }),
      ).rejects.toThrow();
    });
  });

  describe("transactions", () => {
    /**
     * The path SQLite cannot reach: here a transaction is its own object with
     * its own session, so a relational read inside one is built over that
     * session or it reads around the transaction entirely.
     */
    it("a relational read inside transactional() sees its own writes", async () => {
      const ana = await app.db.users.create({
        data: { email: "ana@example.com", name: "Ana" },
      });

      let seen: string | undefined;
      await provider.transactional(async () => {
        const campaign = await app.db.campaigns.create({
          data: { title: "Uncommitted", ownerId: ana.id },
        });
        const found = await app.db.campaigns.findOne({
          where: { id: { eq: campaign.id } },
          include: { owner: true },
        });
        seen = found?.owner?.name;
      });

      expect(seen).toBe("Ana");
    });

    it("create with include reads back the graph it just wrote", async () => {
      const ana = await app.db.users.create({
        data: { email: "ana@example.com", name: "Ana" },
      });

      const created = await app.db.campaigns.create({
        data: {
          title: "Written and read in one block",
          ownerId: ana.id,
          characters: { create: [{ name: "Nix", level: 1, userId: ana.id }] },
        },
        include: { owner: true, characters: true },
      });

      expect(created.owner?.name).toBe("Ana");
      expect(created.characters.map((c) => c.name)).toEqual(["Nix"]);
    });

    /**
     * A failing child has to take the parent with it. This is the test that
     * caught `create` opening a transaction nothing ran inside of.
     */
    it("rolls the parent back when a nested child fails", async () => {
      const ana = await app.db.users.create({
        data: { email: "ana@example.com", name: "Ana" },
      });

      await app.db.campaigns
        .create({
          data: {
            title: "Half built",
            ownerId: ana.id,
            characters: {
              create: [
                {
                  name: "Ghost",
                  level: 1,
                  // No such user: the child insert violates its foreign key.
                  userId: "00000000-0000-0000-0000-000000000000",
                },
              ],
            },
          },
        })
        .catch(() => {});

      const survivors = await app.db.campaigns.findMany({
        where: { title: { eq: "Half built" } },
      });
      expect(survivors).toEqual([]);
    });

    /**
     * Two transactions at once, which SQLite serializes and so cannot test.
     * Each holds its own session, and the relational database is cached per
     * session — so a marker shared rather than per-context would have one
     * block reading through the other's transaction.
     */
    it("keeps concurrent transactions isolated from each other", async () => {
      const ana = await app.db.users.create({
        data: { email: "ana@example.com", name: "Ana" },
      });

      const block = async (title: string) =>
        await provider.transactional(async () => {
          const campaign = await app.db.campaigns.create({
            data: { title, ownerId: ana.id },
          });
          // Give the sibling block a chance to interleave here.
          await new Promise((resolve) => setImmediate(resolve));

          const mine = await app.db.campaigns.findMany({
            where: { ownerId: { eq: ana.id } },
            include: { owner: true },
          });
          return { id: campaign.id, titles: mine.map((c) => c.title) };
        });

      const [left, right] = await Promise.all([block("Left"), block("Right")]);

      // Each block must see its own row, and neither may miss it.
      expect(left.titles).toContain("Left");
      expect(right.titles).toContain("Right");
      expect(left.id).not.toBe(right.id);
    });

    /**
     * The same failure as above, but forced rather than raced for.
     *
     * The test above depends on how the two blocks interleave, and the
     * interleaving that breaks is not the common one — it passed for weeks and
     * then failed once on a loaded CI runner. What it needs is for both blocks
     * to open a transaction of their own, which happens whenever they are
     * issued back-to-back: `transactional()` reads the marker synchronously and
     * only writes it once `db.transaction()` holds a connection, so neither
     * sees the other. From there a single shared marker means the first block
     * to finish clears it while the second is still inside its transaction —
     * and every query the second one makes after that runs on a pooled
     * connection, outside any transaction, seeing committed rows and not its
     * own.
     *
     * The gates below pin that order down, so this fails every time rather than
     * once a month.
     */
    it("keeps its transaction when a concurrent one finishes first", async () => {
      const ana = await app.db.users.create({
        data: { email: "ana@example.com", name: "Ana" },
      });

      const deferred = () => {
        let resolve!: () => void;
        const promise = new Promise<void>((r) => {
          resolve = r;
        });
        return { promise, resolve };
      };

      const rightInserted = deferred();
      const leftDone = deferred();

      const left = provider
        .transactional(async () => {
          await rightInserted.promise;
          await app.db.campaigns.create({
            data: { title: "Left", ownerId: ana.id },
          });
        })
        .then(() => leftDone.resolve());

      const right = provider.transactional(async () => {
        await app.db.campaigns.create({
          data: { title: "Right", ownerId: ana.id },
        });
        rightInserted.resolve();
        await leftDone.promise;
        const mine = await app.db.campaigns.findMany({
          where: { ownerId: { eq: ana.id } },
        });
        return mine.map((c) => c.title);
      });

      const [, titles] = await Promise.all([left, right]);

      expect(titles).toContain("Right");
    });
  });

  describe("pagination", () => {
    it("pages with relations and counts", async () => {
      const { campaign } = await seed();

      const page = await app.db.quests.paginate(
        { size: 1 },
        {
          where: { campaignId: { eq: campaign.id } },
          include: { author: true },
        },
        { count: true },
      );

      expect(page.content).toHaveLength(1);
      expect(page.content[0]?.author?.name).toBeTypeOf("string");
      // Two live quests; the soft-deleted one counts for neither.
      expect(page.page.totalElements).toBe(2);
      expect(page.page.totalPages).toBe(2);
    });

    it("orders and offsets the page, not the relations", async () => {
      const { campaign } = await seed();

      const page = await app.db.quests.paginate(
        { size: 1, page: 1 },
        {
          where: { campaignId: { eq: campaign.id } },
          orderBy: { column: "title", direction: "asc" },
          include: { watchers: true },
        },
        { count: true },
      );

      expect(page.content.map((q) => q.title)).toEqual(["Open the vault"]);
      // The relation is still resolved in full for the row on this page.
      expect(page.content[0]!.watchers).toHaveLength(1);
    });
  });

  describe("writes with relations", () => {
    it("update takes where and data, and can include", async () => {
      const { campaign } = await seed();

      const updated = await app.db.campaigns.update({
        where: { id: { eq: campaign.id } },
        data: { title: "Renamed" },
        include: { owner: true },
      });

      expect(updated.title).toBe("Renamed");
      expect(updated.owner?.name).toBe("Ana");
    });

    it("upsert can include too", async () => {
      const { first, ana } = await seed();

      const row = await app.db.questWatchers.upsert({
        create: { questId: first.id, userId: ana.id },
        target: ["questId", "userId"],
        include: { quest: true },
      });

      expect(row.quest?.title).toBe("Find the archive");
    });

    it("creates a to-one before the row that references it", async () => {
      const created = await app.db.campaigns.create({
        data: {
          title: "Founded by a new user",
          owner: { create: { email: "new@example.com", name: "Newcomer" } },
        },
        include: { owner: true },
      });

      expect(created.owner?.name).toBe("Newcomer");
    });
  });

  describe("failure modes", () => {
    it("classifies a driver error the same with and without a relation", async () => {
      await seed();

      await provider.execute(
        `drop table ${provider.schema}.characters cascade` as never,
      );

      const relational = await app.db.campaigns
        .findMany({ include: { characters: true } })
        .then(() => "no error")
        .catch((error) => error.constructor.name);

      const plain = await app.db.characters.base
        .findMany({})
        .then(() => "no error")
        .catch((error) => error.constructor.name);

      expect(relational).toBe(plain);
      expect(relational).toBe("DbTableNotFoundError");
    });

    it("names an undeclared relation rather than failing at the driver", async () => {
      await seed();

      await expect(
        app.db.campaigns.findMany({ include: { author: true } } as never),
      ).rejects.toThrow(/Unknown relation 'author' on 'campaigns'/);
    });
  });
});
