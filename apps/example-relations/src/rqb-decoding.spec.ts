import { Alepha } from "alepha";
import { $repositories, DatabaseProvider } from "alepha/orm";
import { defineRelations } from "drizzle-orm";
import { SQLiteAsyncDatabase } from "drizzle-orm/sqlite-core/async/db";
import { beforeEach, describe, expect, it } from "vitest";
import { relations, schema } from "./relations.ts";

/**
 * Last unknown: `Repository.clean()` validates and decodes every row against
 * its Zod schema. `db.query` does not go through it.
 *
 * JSON columns are the sharp case — SQLite has no array type, so `tags` is
 * stored as text and something has to turn it back into an array. If the
 * engine swap loses that, every JSON column in Lore (`quests.tags`,
 * `quests.objectives`, `quests.history`, `quests.timerSessions`) comes back as
 * a string.
 */
class App {
  db = $repositories(relations);
}

describe("RQB and row decoding", () => {
  let alepha: Alepha;
  let app: App;
  let provider: DatabaseProvider;

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
      data: { title: "Decoding", ownerId: ana.id },
    });
    const quest = await app.db.quests.create({
      data: {
        title: "Tagged quest",
        campaignId: campaign.id,
        createdBy: ana.id,
        tags: ["urgent", "lore"],
      },
    });
    return { ana, campaign, quest };
  };

  beforeEach(async () => {
    alepha = Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } });
    app = alepha.inject(App);
    await alepha.start();
    provider = alepha.inject(DatabaseProvider);
  });

  it("Repository decodes a JSON column into an array", async () => {
    const { quest } = await seed();

    const found = await app.db.quests.getById(quest.id);

    expect(Array.isArray(found.tags)).toBe(true);
    expect(found.tags).toEqual(["urgent", "lore"]);
  });

  /**
   * The question, answered by observation rather than by reading the docs.
   */
  it("shows what RQB returns for the same column", async () => {
    await seed();

    const rqb = rqbFor(() => ({}));
    const rows = await rqb.query.quests.findMany({});

    const tags = rows[0].tags;

    // Recorded rather than asserted one way: whichever it is, it is the
    // finding. Drizzle knows the column is JSON from the table definition
    // Alepha built, so decoding is the table's job, not the repository's.
    expect(Array.isArray(tags)).toBe(true);
    expect(tags).toEqual(["urgent", "lore"]);
  });

  /**
   * ...and through a relation, which is the path that matters.
   */
  it("decodes a JSON column reached through a relation", async () => {
    await seed();

    const rqb = rqbFor((r: any) => ({
      campaigns: {
        quests: r.many.quests({
          from: r.campaigns.id,
          to: r.quests.campaignId,
        }),
      },
    }));

    const rows = await rqb.query.campaigns.findMany({ with: { quests: true } });
    const tags = rows[0].quests[0].tags;

    expect(Array.isArray(tags)).toBe(true);
    expect(tags).toEqual(["urgent", "lore"]);
  });

  /**
   * What `Repository` adds beyond decoding: it validates against the Zod
   * schema and strips anything not declared. RQB returns whatever the table
   * says, with no schema check — so a column that drifted from its schema
   * surfaces at the call site instead of at the repository boundary.
   */
  it("RQB does not apply Zod validation", async () => {
    const { quest } = await seed();

    // Write a value the schema would reject, going around the repository.
    await provider.execute(
      `update quests set tags = '"not-an-array"' where id = ${quest.id}` as never,
    );

    const rqb = rqbFor(() => ({}));
    const rows = await rqb.query.quests.findMany({});

    // No error: the engine hands back what the driver decoded.
    expect(rows[0].tags).toBe("not-an-array");

    // The repository, by contrast, is the layer that would catch it.
    await expect(app.db.quests.getById(quest.id)).rejects.toThrow();
  });
});
