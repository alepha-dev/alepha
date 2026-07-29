import { Alepha } from "alepha";
import { $repositories, DatabaseProvider, Repository } from "alepha/orm";
import { defineRelations } from "drizzle-orm";
import { SQLiteAsyncDatabase } from "drizzle-orm/sqlite-core/async/db";
import { beforeEach, describe, expect, it } from "vitest";
import { quests } from "./entities/quests.ts";
import { relations, schema } from "./relations.ts";

/**
 * The two things the research left untested, rather than assumed away.
 *
 * If Zod validation and events/cache cannot be recovered on top of RQB, "not a
 * blocker" was wishful. Both are checked here.
 */
class App {
  db = $repositories(relations);
}

/** Exposes the protected row-cleaning so it can be driven directly. */
class TestQuestRepository extends Repository<typeof quests.schema> {
  constructor() {
    super(quests);
  }
  public testClean = this.clean.bind(this);
}

describe("recovering Repository behaviour on top of RQB", () => {
  let alepha: Alepha;
  let app: App;
  let provider: DatabaseProvider;
  let repository: TestQuestRepository;

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
      data: { title: "Recovery", ownerId: ana.id },
    });
    const quest = await app.db.quests.create({
      data: {
        title: "Tagged",
        campaignId: campaign.id,
        createdBy: ana.id,
        tags: ["a", "b"],
      },
    });
    return { ana, campaign, quest };
  };

  beforeEach(async () => {
    alepha = Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } });
    app = alepha.inject(App);
    // Before start(): the container locks once started, and this is a service
    // the application itself never declares.
    repository = alepha.inject(TestQuestRepository);
    await alepha.start();
    provider = alepha.inject(DatabaseProvider);
  });

  /**
   * The risk: validation runs against the entity schema, and an RQB row also
   * carries relation fields the schema knows nothing about. If cleaning drops
   * or rejects them, recovering validation would destroy the relations it was
   * meant to protect.
   */
  it("cleaning an RQB row keeps its relation fields intact", async () => {
    await seed();

    const rqb = rqbFor((r: any) => ({
      quests: {
        author: r.one.users({ from: r.quests.createdBy, to: r.users.id }),
      },
    }));

    const rows = await rqb.query.quests.findMany({ with: { author: true } });
    const raw = rows[0];

    expect(raw.author?.name).toBe("Ana");

    // Pull the relation aside, validate the entity, put it back — the pattern
    // `cleanWithJoins` already uses for the join mapper.
    const { author, ...columnsOnly } = raw;
    const cleaned = {
      ...repository.testClean(columnsOnly, quests.schema),
      author,
    };

    expect(cleaned.title).toBe("Tagged");
    expect(cleaned.tags).toEqual(["a", "b"]);
    expect((cleaned as any).author?.name).toBe("Ana");
  });

  /**
   * And that cleaning still does its job: a drifted value is rejected rather
   * than passed through, which is the whole point of running it.
   */
  it("cleaning still rejects a value that drifted from the schema", async () => {
    const { quest } = await seed();

    await provider.execute(
      `update quests set tags = '"not-an-array"' where id = ${quest.id}` as never,
    );

    const rqb = rqbFor(() => ({}));
    const rows = await rqb.query.quests.findMany({});

    expect(() => repository.testClean(rows[0], quests.schema)).toThrow();
  });

  /**
   * Events are emitted by the repository, not the engine, so they are
   * recoverable by construction — the question is only whether the payload
   * still makes sense when one statement touches several tables.
   */
  it("events can be emitted around an RQB query, but name one table", async () => {
    await seed();

    const seen: string[] = [];
    alepha.events.on("repository:read:before", (e: any) => {
      seen.push(e.tableName);
    });

    const rqb = rqbFor((r: any) => ({
      campaigns: {
        quests: r.many.quests({
          from: r.campaigns.id,
          to: r.quests.campaignId,
        }),
      },
    }));

    await alepha.events.emit("repository:read:before", {
      tableName: "campaigns",
      query: {},
    } as never);
    await rqb.query.campaigns.findMany({ with: { quests: true } });

    // One event, one table named — yet the statement read two. Any cache keyed
    // per table would under-invalidate: writing a quest would not invalidate a
    // cached campaigns-with-quests result.
    expect(seen).toEqual(["campaigns"]);
  });
});
