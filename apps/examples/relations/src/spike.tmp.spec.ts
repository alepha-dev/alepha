import { Alepha } from "alepha";
import { $repositories, DatabaseProvider } from "alepha/orm";
import { defineRelations, sql } from "drizzle-orm";
import { SQLiteAsyncDatabase } from "drizzle-orm/sqlite-core/async/db";
import { beforeEach, describe, expect, it } from "vitest";

import { relations, schema } from "./relations.ts";

/**
 * Can a relation-column filter ride alongside the RAW escape hatch?
 *
 * Alepha hands its whole `where` over as `RAW`, which bypasses Drizzle's own
 * filter vocabulary. Drizzle iterates the filter's keys and ANDs them, so the
 * question is whether `{ RAW, someRelation: ... }` composes — and whether the
 * nested side accepts `RAW` too, which would let the same operator vocabulary
 * work at every depth instead of translating twenty operators by hand.
 */
class App {
  db = $repositories(relations);
}

describe("relation filters alongside RAW", () => {
  let alepha: Alepha;
  let app: App;
  let provider: DatabaseProvider;

  const rqb = () => {
    const tables: Record<string, any> = {};
    for (const [key, entity] of Object.entries(schema)) {
      tables[key] = provider.table(entity as never);
    }
    const existing = provider.db as any;
    return new SQLiteAsyncDatabase(
      existing.resultKind ?? "sync",
      existing.dialect,
      existing.session,
      defineRelations(tables, (r: any) => ({
        campaigns: {
          owner: r.one.users({ from: r.campaigns.ownerId, to: r.users.id }),
          quests: r.many.quests({
            from: r.campaigns.id,
            to: r.quests.campaignId,
          }),
        },
        quests: {
          campaign: r.one.campaigns({
            from: r.quests.campaignId,
            to: r.campaigns.id,
          }),
        },
      })) as any,
      false,
    ) as any;
  };

  beforeEach(async () => {
    alepha = Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } });
    app = alepha.inject(App);
    await alepha.start();
    provider = alepha.inject(DatabaseProvider);

    const ana = await app.db.users.create({
      data: { email: "ana@example.com", name: "Ana" },
    });
    const bo = await app.db.users.create({
      data: { email: "bo@example.com", name: "Bo" },
    });
    const anas = await app.db.campaigns.create({
      data: { title: "Ana's", ownerId: ana.id },
    });
    await app.db.campaigns.create({ data: { title: "Bo's", ownerId: bo.id } });
    await app.db.quests.create({
      data: { title: "Q1", campaignId: anas.id, createdBy: ana.id },
    });
  });

  it("filters a root query by a to-one relation's column", async () => {
    const db = rqb();

    const rows = await db.query.campaigns.findMany({
      where: { owner: { name: "Ana" } },
    });

    expect(rows.map((c: any) => c.title)).toEqual(["Ana's"]);
  });

  it("accepts RAW nested inside a relation filter", async () => {
    const db = rqb();

    const rows = await db.query.campaigns.findMany({
      where: {
        owner: { RAW: (t: any) => sql`${t.name} = 'Ana'` },
      },
    });

    expect(rows.map((c: any) => c.title)).toEqual(["Ana's"]);
  });

  it("ANDs a root RAW with a relation filter", async () => {
    const db = rqb();

    const rows = await db.query.campaigns.findMany({
      where: {
        RAW: (t: any) => sql`${t.title} like '%s'`,
        owner: { RAW: (t: any) => sql`${t.name} = 'Ana'` },
      },
    });

    expect(rows.map((c: any) => c.title)).toEqual(["Ana's"]);
  });

  it("filters by a to-many relation, as EXISTS", async () => {
    const db = rqb();

    const withQuests = await db.query.campaigns.findMany({
      where: { quests: { RAW: (t: any) => sql`${t.title} = 'Q1'` } },
    });
    expect(withQuests.map((c: any) => c.title)).toEqual(["Ana's"]);

    const sqlText = db.query.campaigns
      .findMany({ where: { quests: { RAW: (t: any) => sql`1=1` } } })
      .toSQL().sql;
    expect(sqlText).toContain("exists");
  });

  it("nests two relation levels deep", async () => {
    const db = rqb();

    const rows = await db.query.quests.findMany({
      where: {
        campaign: { owner: { RAW: (t: any) => sql`${t.name} = 'Ana'` } },
      },
    });

    expect(rows.map((q: any) => q.title)).toEqual(["Q1"]);
  });
});
