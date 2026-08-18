import { Alepha } from "alepha";
import {
  $repositories,
  CloudflareD1Provider,
  DatabaseProvider,
} from "alepha/orm";
import type { Miniflare } from "miniflare";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { d1Miniflare } from "./d1Miniflare.ts";
import { relations } from "./relations.ts";

/**
 * The feature set on Cloudflare D1.
 *
 * This is the dialect the argument for delegating to Drizzle rests on. D1's
 * SQLite has no `jsonb`, so its driver — alone among the four — is constructed
 * with `forbidJsonb: true`, and every relation has to aggregate through
 * `json_object` / `json_group_array` instead. Nobody would rediscover that by
 * hand, and getting it wrong does not fail loudly: `jsonb_group_array` simply
 * is not a function D1 has.
 *
 * Miniflare gives a real D1 binding in-process, so this runs against the same
 * `workerd` implementation a deployed worker gets.
 */
class App {
  db = $repositories(relations);
}

const workers: Miniflare[] = [];

afterAll(async () => {
  await Promise.all(workers.map((mf) => mf.dispose()));
});

/**
 * D1 takes its schema from migration files rather than push-sync. Boot the
 * same app on SQLite, which does push-sync, and copy out the schema the
 * framework generated — so this fixture cannot drift from the entities.
 */
const schemaFromPushSync = async (): Promise<Array<string>> => {
  const source = Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } });
  source.inject(App);
  await source.start();

  const rows = await source
    .inject(DatabaseProvider)
    .execute(
      "select sql from sqlite_master where sql is not null and name not like 'sqlite_%'" as never,
    );

  await source.stop();
  return rows.map((row) => String(row.sql));
};

describe("relations on cloudflare d1", () => {
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
    const empty = await app.db.campaigns.create({
      data: { title: "No Members Yet", ownerId: bo.id },
    });
    await app.db.characters.create({
      data: { name: "Vex", level: 3, campaignId: campaign.id, userId: ana.id },
    });
    const live = await app.db.quests.create({
      data: {
        title: "Find the archive",
        campaignId: campaign.id,
        createdBy: ana.id,
        tags: ["urgent", "lore"],
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

    return { ana, bo, campaign, empty, live };
  };

  beforeEach(async () => {
    const statements = await schemaFromPushSync();

    const mf = d1Miniflare();
    workers.push(mf);

    alepha = Alepha.create({
      env: { DATABASE_URL: "d1://DB" },
    }).with({ provide: DatabaseProvider, use: CloudflareD1Provider });
    alepha.store.set("cloudflare.env", await mf.getBindings());

    app = alepha.inject(App);
    await alepha.start();

    const provider = alepha.inject(DatabaseProvider);
    for (const statement of statements) {
      await provider.execute(statement as never);
    }
  });

  /**
   * The assertion the whole D1 argument comes down to. `forbidJsonb` is read
   * off the live driver rather than assumed, so this proves the flag survives
   * the rebuild — and that nothing emits a function D1 does not have.
   */
  it("aggregates with json_*, never jsonb_*", async () => {
    const { campaign } = await seed();

    const { sql } = app.db.campaigns.toSQL({
      where: { id: { eq: campaign.id } },
      include: { characters: true, quests: true },
    });

    expect(sql).toContain("json_group_array");
    expect(sql).toContain("json_object");
    expect(sql).not.toContain("jsonb");
  });

  it("reads a whole tree in one statement", async () => {
    const { campaign } = await seed();

    const found = await app.db.campaigns.findOne({
      where: { id: { eq: campaign.id } },
      include: { owner: true, characters: true },
    });

    expect(found?.owner?.name).toBe("Ana");
    expect(found?.characters.map((c) => c.name)).toEqual(["Vex"]);

    const { sql } = app.db.campaigns.toSQL({
      where: { id: { eq: campaign.id } },
      include: { owner: true, characters: true },
    });
    expect(sql.match(/from "campaigns"/g)).toHaveLength(1);
  });

  /**
   * A JSON array column reached through a relation: stored as text, decoded by
   * the table, and carried out of a `json_group_array` on the way.
   */
  it("decodes a json array through a relation", async () => {
    const { campaign } = await seed();

    const found = await app.db.campaigns.findOne({
      where: { id: { eq: campaign.id } },
      include: { quests: true },
    });

    expect(found?.quests[0]?.tags).toEqual(["urgent", "lore"]);
  });

  it("hides soft-deleted rows inside a relation", async () => {
    const { campaign } = await seed();

    const found = await app.db.campaigns.findOne({
      where: { id: { eq: campaign.id } },
      include: { quests: true },
    });

    expect(found?.quests.map((q) => q.title)).toEqual(["Find the archive"]);
  });

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

    expect(found?.watching.map((q) => q.title)).toEqual(["Find the archive"]);
  });

  it("nests three levels deep", async () => {
    const { campaign } = await seed();

    const found = await app.db.campaigns.findOne({
      where: { id: { eq: campaign.id } },
      include: { quests: { include: { author: true } } },
    });

    expect(found?.quests[0]?.author?.name).toBe("Ana");
  });

  it("pages with relations and counts", async () => {
    const { campaign } = await seed();

    const page = await app.db.quests.paginate(
      { size: 10 },
      { where: { campaignId: { eq: campaign.id } }, include: { author: true } },
      { count: true },
    );

    expect(page.content.map((q) => q.title)).toEqual(["Find the archive"]);
    expect(page.page.totalElements).toBe(1);
  });

  /**
   * D1 has no SQL-level transactions, so `transactional()` degrades to running
   * the callback directly. A nested create still has to produce the graph —
   * just without the rollback guarantee the other dialects give.
   */
  it("creates a nested graph, without transactions", async () => {
    const { ana } = await seed();

    const created = await app.db.campaigns.create({
      data: {
        title: "Bright Hollow",
        ownerId: ana.id,
        characters: { create: [{ name: "Sable", level: 2, userId: ana.id }] },
      },
      include: { characters: true },
    });

    expect(created.characters.map((c) => c.name)).toEqual(["Sable"]);
  });
});
