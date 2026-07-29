import { Alepha } from "alepha";
import { $repositories, DatabaseProvider } from "alepha/orm";
import { NodePostgresProvider } from "alepha/orm/postgres";
import { beforeEach, describe, expect, it } from "vitest";
import { relations } from "./relations.ts";

/**
 * The same feature set against Postgres.
 *
 * Every other spec here runs on SQLite, which is the dialect where the
 * relational query builder emits correlated subqueries. Postgres takes a
 * different strategy entirely — lateral joins with `json_agg` — and reaches it
 * through a different database class, with a different constructor and a
 * different transaction object. None of that is exercised by a SQLite test, so
 * a translation that works there proves nothing about the dialect Lore's
 * self-hosted deployments would use.
 */
class App {
  db = $repositories(relations);
}

describe("relations on postgres", () => {
  let alepha: Alepha;
  let app: App;

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
    await app.db.characters.create({
      data: { name: "Vex", level: 3, campaignId: campaign.id, userId: ana.id },
    });
    await app.db.characters.create({
      data: { name: "Rill", level: 5, campaignId: campaign.id, userId: bo.id },
    });
    const live = await app.db.quests.create({
      data: {
        title: "Find the archive",
        campaignId: campaign.id,
        createdBy: ana.id,
        tags: ["urgent"],
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
      data: { questId: live.id, userId: ana.id },
    });

    return { ana, bo, campaign, live };
  };

  beforeEach(async () => {
    alepha = Alepha.create({
      env: {
        DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:15432/postgres",
      },
    }).with({ provide: DatabaseProvider, use: NodePostgresProvider });
    app = alepha.inject(App);
    // The provider creates -- and drops -- a throwaway schema per test run, so
    // there is nothing to clean up between them.
    await alepha.start();
  });

  it("resolves a to-one and a to-many in one statement", async () => {
    const { campaign, ana } = await seed();

    const found = await app.db.campaigns.findOne({
      where: { id: { eq: campaign.id } },
      include: { owner: true, characters: true },
    });

    expect(found?.owner).toMatchObject({ id: ana.id, name: "Ana" });
    expect(found?.characters.map((c) => c.name).sort()).toEqual([
      "Rill",
      "Vex",
    ]);

    const { sql } = app.db.campaigns.toSQL({
      where: { id: { eq: campaign.id } },
      include: { owner: true, characters: true },
    });

    // The Postgres strategy, which is not the SQLite one.
    expect(sql).toContain("lateral");
    expect(sql.match(/from "[^"]+"\."campaigns"/g)).toHaveLength(1);
  });

  it("hides soft-deleted rows inside a relation", async () => {
    const { campaign } = await seed();

    const found = await app.db.campaigns.findOne({
      where: { id: { eq: campaign.id } },
      include: { quests: true },
    });

    expect(found?.quests.map((q) => q.title)).toEqual(["Find the archive"]);
  });

  it("decodes a json column reached through a relation", async () => {
    const { campaign } = await seed();

    const found = await app.db.campaigns.findOne({
      where: { id: { eq: campaign.id } },
      include: { quests: true },
    });

    expect(found?.quests[0]?.tags).toEqual(["urgent"]);
  });

  it("resolves a many-to-many through its junction", async () => {
    const { ana } = await seed();

    const found = await app.db.users.findOne({
      where: { id: { eq: ana.id } },
      include: { watching: true },
    });

    expect(found?.watching.map((q) => q.title)).toEqual(["Find the archive"]);
  });

  /**
   * The path a SQLite test cannot reach: on Postgres a transaction is its own
   * object with its own session, so a relational read inside one has to be
   * built over *that* session or it reads around the transaction. `create`
   * with `include` does exactly this — it writes and re-reads in one block.
   */
  it("reads inside a transaction, and sees the transaction's own writes", async () => {
    const { ana } = await seed();

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

  it("paginates with relations", async () => {
    const { campaign } = await seed();

    const page = await app.db.quests.paginate(
      { size: 1 },
      { where: { campaignId: { eq: campaign.id } }, include: { author: true } },
      { count: true },
    );

    expect(page.content).toHaveLength(1);
    expect(page.content[0]?.author?.name).toBe("Ana");
    expect(page.page.totalElements).toBe(1);
  });
});

describe("transaction probes", () => {
  let alepha: Alepha;
  let app: App;
  let provider: DatabaseProvider;

  beforeEach(async () => {
    alepha = Alepha.create({
      env: {
        DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:15432/postgres",
      },
    }).with({ provide: DatabaseProvider, use: NodePostgresProvider });
    app = alepha.inject(App);
    await alepha.start();
    provider = alepha.inject(DatabaseProvider);
  });

  it("PROBE A: is a nested create atomic?", async () => {
    const ana = await app.db.users.create({
      data: { email: "ana@example.com", name: "Ana" },
    });

    await app.db.campaigns
      .create({
        data: {
          title: "Half built",
          ownerId: ana.id,
          // `campaignId` is not null on characters, but `userId` points at a
          // user that does not exist -> the child insert must fail.
          characters: {
            create: [
              {
                name: "Ghost",
                level: 1,
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
    expect(survivors.map((c) => c.title)).toEqual([]);
  });

  it("PROBE B: does a relational read inside transactional() see its writes?", async () => {
    const ana = await app.db.users.create({
      data: { email: "ana@example.com", name: "Ana" },
    });

    let seen = -1;
    await provider.transactional(async () => {
      const campaign = await app.db.campaigns.create({
        data: { title: "Uncommitted", ownerId: ana.id },
      });
      const found = await app.db.campaigns.findOne({
        where: { id: { eq: campaign.id } },
        include: { owner: true },
      });
      seen = found ? 1 : 0;
    });

    expect(seen).toBe(1);
  });
});
