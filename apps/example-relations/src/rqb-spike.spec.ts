import { Alepha } from "alepha";
import { $repositories, DatabaseProvider } from "alepha/orm";
import { defineRelations } from "drizzle-orm";
import { SQLiteAsyncDatabase } from "drizzle-orm/sqlite-core/async/db";
import { describe, expect, it } from "vitest";
import { relations, schema } from "./relations.ts";

/**
 * Spike: can Alepha's runtime-built tables be handed to Drizzle's relational
 * query builder?
 *
 * The obstacle is that `db.query` is populated in the *constructor* of a
 * Drizzle database, from a relations map — and Alepha builds its connection
 * long before an application declares any relations. So this does not try to
 * reconfigure the existing database; it builds a second one that shares the
 * same session, which is where the connection actually lives.
 *
 * This is a spike, not the design. It only has to answer: does the bridge
 * exist at all?
 */
class App {
  db = $repositories(relations);
}

describe("RQB bridge spike", () => {
  const boot = async () => {
    const alepha = Alepha.create({
      env: { DATABASE_URL: "sqlite://:memory:" },
    });
    const app = alepha.inject(App);
    await alepha.start();
    return { alepha, app, provider: alepha.inject(DatabaseProvider) };
  };

  it("hands Alepha's runtime tables to defineRelations and queries through db.query", async () => {
    const { app, provider } = await boot();

    // Seed through the normal API so the data is written by Alepha, not by the
    // spike — otherwise this would only prove Drizzle can read what Drizzle
    // wrote.
    const ana = await app.db.users.create({
      data: { email: "ana@example.com", name: "Ana" },
    });
    const campaign = await app.db.campaigns.create({
      data: { title: "The Sunken Archive", ownerId: ana.id },
    });
    await app.db.characters.create({
      data: { name: "Vex", level: 3, campaignId: campaign.id, userId: ana.id },
    });
    await app.db.characters.create({
      data: { name: "Rill", level: 5, campaignId: campaign.id, userId: ana.id },
    });

    // 1. The runtime half: Alepha already holds a Drizzle table per entity.
    const tables: Record<string, any> = {};
    for (const [key, entity] of Object.entries(schema)) {
      tables[key] = provider.table(entity as never);
    }

    expect(Object.keys(tables).sort()).toEqual([
      "campaigns",
      "characters",
      "questWatchers",
      "quests",
      "users",
    ]);

    // 2. Translate the declaration into Drizzle's own shape.
    const drizzleRelations = defineRelations(tables, (r: any) => ({
      campaigns: {
        owner: r.one.users({ from: r.campaigns.ownerId, to: r.users.id }),
        characters: r.many.characters({
          from: r.campaigns.id,
          to: r.characters.campaignId,
        }),
      },
      characters: {
        user: r.one.users({ from: r.characters.userId, to: r.users.id }),
      },
    }));

    // 3. Build a second database over the *same session*, so it talks to the
    //    connection Alepha already opened rather than a new one.
    const existing = provider.db as any;
    const rqb = new SQLiteAsyncDatabase(
      existing.resultKind ?? "sync",
      existing.dialect,
      existing.session,
      drizzleRelations as any,
      // D1 forbids jsonb; plain sqlite does not. The real executor would read
      // this from the provider's driver.
      false,
    ) as any;

    expect(Object.keys(rqb.query).sort()).toEqual([
      "campaigns",
      "characters",
      "questWatchers",
      "quests",
      "users",
    ]);

    // 4. The actual question.
    const query = rqb.query.campaigns.findMany({
      with: { owner: true, characters: { with: { user: true } } },
    });

    const sql = query.toSQL().sql;
    // One statement, JSON-aggregated — not N queries, and not a join.
    expect(sql).toContain("json_group_array");
    expect(sql).toContain("coalesce");
    expect(sql.match(/from "campaigns"/g)).toHaveLength(1);

    const rows = await query;

    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("The Sunken Archive");
    expect(rows[0].owner?.name).toBe("Ana");
    expect(rows[0].characters.map((c: any) => c.name).sort()).toEqual([
      "Rill",
      "Vex",
    ]);
    expect(rows[0].characters[0].user?.name).toBe("Ana");
  });

  /**
   * The property that actually motivates the swap: everything arrives in one
   * statement, so one round trip — which is what matters on D1.
   */
  it("issues a single query for a two-level include", async () => {
    const { alepha, app, provider } = await boot();

    const ana = await app.db.users.create({
      data: { email: "ana@example.com", name: "Ana" },
    });
    const campaign = await app.db.campaigns.create({
      data: { title: "One Query", ownerId: ana.id },
    });
    await app.db.characters.create({
      data: { name: "Vex", campaignId: campaign.id, userId: ana.id },
    });

    const tables: Record<string, any> = {};
    for (const [key, entity] of Object.entries(schema)) {
      tables[key] = provider.table(entity as never);
    }

    const drizzleRelations = defineRelations(tables, (r: any) => ({
      campaigns: {
        owner: r.one.users({ from: r.campaigns.ownerId, to: r.users.id }),
        characters: r.many.characters({
          from: r.campaigns.id,
          to: r.characters.campaignId,
        }),
      },
    }));

    const existing = provider.db as any;
    const rqb = new SQLiteAsyncDatabase(
      existing.resultKind ?? "sync",
      existing.dialect,
      existing.session,
      drizzleRelations as any,
      false,
    ) as any;

    let statements = 0;
    alepha.events.on("repository:read:before", () => {
      statements++;
    });

    const rows = await rqb.query.campaigns.findMany({
      with: { owner: true, characters: true },
    });

    expect(rows[0].owner?.name).toBe("Ana");
    expect(rows[0].characters).toHaveLength(1);

    // The repository event never fires: this bypasses Alepha's repository
    // entirely and goes straight to the session. Which is precisely the
    // integration cost — see the notes in the README.
    expect(statements).toBe(0);
  });
});
