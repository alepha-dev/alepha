import { Alepha } from "alepha";
import { $repositories, DatabaseProvider } from "alepha/orm";
import { defineRelations } from "drizzle-orm";
import { SQLiteAsyncDatabase } from "drizzle-orm/sqlite-core/async/db";
import { beforeEach, describe, expect, it } from "vitest";
import { relations, schema } from "./relations.ts";

/**
 * The question the first spike raised: `Repository` filters soft-deleted rows
 * out of every read, and `db.query` does not go through `Repository`. So does
 * adopting Drizzle's engine mean losing that, or can the filter be injected?
 *
 * This matters more than performance. `quests.deletedAt` exists in Lore, and a
 * relation that quietly returns deleted rows is a correctness bug that looks
 * like data corruption from the outside.
 */
class App {
  db = $repositories(relations);
}

describe("RQB and cross-cutting concerns", () => {
  let alepha: Alepha;
  let app: App;
  let provider: DatabaseProvider;

  /** Build an RQB database over the session Alepha already opened. */
  const rqbFor = (define: (r: any) => any) => {
    const tables: Record<string, any> = {};
    for (const [key, entity] of Object.entries(schema)) {
      tables[key] = provider.table(entity as never);
    }

    const existing = provider.db as any;
    return new SQLiteAsyncDatabase(
      existing.resultKind ?? "sync",
      existing.dialect,
      existing.session,
      defineRelations(tables, define) as any,
      false,
    ) as any;
  };

  const seed = async () => {
    const ana = await app.db.users.create({
      data: { email: "ana@example.com", name: "Ana" },
    });
    const campaign = await app.db.campaigns.create({
      data: { title: "The Sunken Archive", ownerId: ana.id },
    });

    const live = await app.db.quests.create({
      data: { title: "Live quest", campaignId: campaign.id, createdBy: ana.id },
    });
    const doomed = await app.db.quests.create({
      data: {
        title: "Deleted quest",
        campaignId: campaign.id,
        createdBy: ana.id,
      },
    });

    // Soft delete, the way the application does it.
    await app.db.quests.deleteById(doomed.id);

    return { ana, campaign, live, doomed };
  };

  beforeEach(async () => {
    alepha = Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } });
    app = alepha.inject(App);
    await alepha.start();
    provider = alepha.inject(DatabaseProvider);
  });

  it("Repository hides soft-deleted rows, as today", async () => {
    const { campaign } = await seed();

    const found = await app.db.campaigns.findOne({
      where: { id: { eq: campaign.id } },
      include: { quests: true },
    });

    expect(found?.quests.map((q) => q.title)).toEqual(["Live quest"]);
  });

  /**
   * The failure mode, demonstrated rather than asserted from the docs. Naively
   * swapping the executor for `db.query` leaks deleted rows into a relation.
   */
  it("raw RQB leaks soft-deleted rows into a relation", async () => {
    const { campaign } = await seed();

    const rqb = rqbFor((r: any) => ({
      campaigns: {
        quests: r.many.quests({
          from: r.campaigns.id,
          to: r.quests.campaignId,
        }),
      },
    }));

    const rows = await rqb.query.campaigns.findMany({
      where: { id: campaign.id },
      with: { quests: true },
    });

    expect(rows[0].quests.map((q: any) => q.title).sort()).toEqual([
      "Deleted quest",
      "Live quest",
    ]);
  });

  /**
   * ...and the fix. A relation can carry its own `where`, so the soft-delete
   * predicate can be pushed into the declaration itself rather than left to
   * every call site.
   */
  it("a relation-level where filters them out again", async () => {
    const { campaign } = await seed();

    const rqb = rqbFor((r: any) => ({
      campaigns: {
        quests: r.many.quests({
          from: r.campaigns.id,
          to: r.quests.campaignId,
        }),
      },
    }));

    const rows = await rqb.query.campaigns.findMany({
      where: { id: campaign.id },
      with: { quests: { where: { deletedAt: { isNull: true } } } },
    });

    expect(rows[0].quests.map((q: any) => q.title)).toEqual(["Live quest"]);
  });

  /**
   * Better still: `defineRelations` accepts a predefined `where` on the
   * relation itself, so the filter lives in the declaration and no call site
   * can forget it. That is the shape an Alepha executor would generate.
   */
  it("a predefined where on the relation makes it impossible to forget", async () => {
    const { campaign } = await seed();

    const rqb = rqbFor((r: any) => ({
      campaigns: {
        quests: r.many.quests({
          from: r.campaigns.id,
          to: r.quests.campaignId,
          where: { deletedAt: { isNull: true } },
        }),
      },
    }));

    const rows = await rqb.query.campaigns.findMany({
      where: { id: campaign.id },
      // No filter at the call site at all.
      with: { quests: true },
    });

    expect(rows[0].quests.map((q: any) => q.title)).toEqual(["Live quest"]);
  });

  /**
   * Still one statement — pushing the predicate in does not cost a round trip.
   */
  it("keeps it to a single statement", async () => {
    const { campaign } = await seed();

    const rqb = rqbFor((r: any) => ({
      campaigns: {
        quests: r.many.quests({
          from: r.campaigns.id,
          to: r.quests.campaignId,
          where: { deletedAt: { isNull: true } },
        }),
      },
    }));

    const sql = rqb.query.campaigns
      .findMany({ where: { id: campaign.id }, with: { quests: true } })
      .toSQL().sql;

    expect(sql.match(/from "campaigns"/g)).toHaveLength(1);
    expect(sql).toContain("json_group_array");
    expect(sql).toContain("deleted_at");
  });
});
