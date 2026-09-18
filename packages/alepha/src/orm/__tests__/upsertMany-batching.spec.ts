import { Alepha, z } from "alepha";
import { describe, it } from "vitest";

import {
  $entity,
  DatabaseProvider,
  DbTooManyParametersError,
  Repository,
  db,
  sql,
} from "../core/index.ts";
import {
  NodeSqliteProvider,
  nodeSqliteOptions,
} from "../core/providers/drivers/NodeSqliteProvider.ts";

/**
 * A driver that REFUSES a statement binding more than ten values, the way
 * Cloudflare D1 refuses past 100 (`too many SQL variables`), scaled down so a
 * handful of rows crosses it.
 *
 * The refusal is what makes this a proof. `createMany-batching.spec.ts` only
 * lowers `maxBoundParameters`, and the SQLite build underneath accepts far
 * more, so a statement that ignored the ceiling would pass there anyway.
 * Here it cannot: an unsplit upsert is refused exactly as D1 refused Lore's
 * hourly analytics rollup, on every run for a week (#Q2404).
 */
class RefusingCeilingProvider extends NodeSqliteProvider {
  public override readonly maxBoundParameters = 10;

  protected override shimDatabaseSync(): void {
    super.shimDatabaseSync();
    const database = this.sqlite as unknown as {
      prepare: (text: string) => unknown;
    };
    const prepare = database.prepare.bind(database);
    database.prepare = (text: string) => {
      const bound = text.split("?").length - 1;
      if (bound > this.maxBoundParameters) {
        throw new Error(`too many SQL variables (${bound})`);
      }
      return prepare(text);
    };
  }
}

const counters = $entity({
  name: "upsert_batching_counters",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    hour: z.text(),
    path: z.text(),
    count: z.integer(),
  }),
  indexes: [{ columns: ["hour", "path"], unique: true }],
});

class Counters extends Repository<typeof counters.schema> {
  constructor() {
    super(counters);
  }
}

describe("upsertMany batching", () => {
  const boot = async () => {
    const alepha = Alepha.create().with({
      provide: DatabaseProvider,
      use: RefusingCeilingProvider,
    });
    alepha.store.mut(nodeSqliteOptions, (old) => ({
      ...old,
      path: "sqlite://:memory:",
    }));
    const repo = alepha.inject(Counters);
    await alepha.start();
    return { repo };
  };

  // Three values a row, ten a statement: three rows fit, a fourth does not.
  const rows = (n: number, count = 1) =>
    Array.from({ length: n }, (_, i) => ({
      hour: "2026-09-18T10",
      path: `/p${String(i).padStart(2, "0")}`,
      count,
    }));

  it("proves the driver refuses a statement past its ceiling", async ({
    expect,
  }) => {
    const { repo } = await boot();

    // `createMany` has batched since #Q343, so a raw statement is the only way
    // to show the fake refuses: without this, a green spec below could mean
    // the fake never refuses anything.
    await expect(
      repo.query(
        sql`SELECT ${sql.join(
          Array.from({ length: 11 }, (_, i) => sql`${i}`),
          sql`, `,
        )}`,
      ),
    ).rejects.toThrow();
  });

  it("writes more rows than one statement may bind", async ({ expect }) => {
    const { repo } = await boot();

    const values = rows(23);
    const upserted = await repo.upsertMany(values, {
      target: ["hour", "path"],
      set: { count: sql`${repo.table.count} + excluded.count` },
    });

    expect(upserted).toHaveLength(23);
    const stored = await repo.findMany({
      orderBy: [{ column: "path", direction: "asc" }],
    });
    expect(stored.map((r) => r.path)).toEqual(values.map((v) => v.path));
  });

  it("accumulates across batches through `excluded`, never refused", async ({
    expect,
  }) => {
    const { repo } = await boot();
    const accumulate = {
      target: ["hour", "path"] as Array<"hour" | "path">,
      set: { count: sql`${repo.table.count} + excluded.count` },
    };

    await repo.upsertMany(rows(23, 2), accumulate);
    await repo.upsertMany(rows(23, 5), accumulate);

    const stored = await repo.findMany({});
    expect(stored).toHaveLength(23);
    expect(stored.every((r) => r.count === 7)).toBe(true);
  });

  it("reserves what its SET clause binds itself", async ({ expect }) => {
    const { repo } = await boot();

    // A plain value in `set` binds one parameter on every statement, whatever
    // the row count. Three values a row, nine for three rows, plus that one:
    // ten. A batch sized from the rows alone would bind eleven and be refused.
    await expect(
      repo.upsertMany(rows(9), {
        target: ["hour", "path"],
        set: { count: 42 },
      }),
    ).resolves.toHaveLength(9);

    await repo.upsertMany(rows(9), {
      target: ["hour", "path"],
      set: { count: 42 },
    });
    const stored = await repo.findMany({});
    expect(stored.every((r) => r.count === 42)).toBe(true);
  });

  it("still names the ceiling when a single row is wider than it", async ({
    expect,
  }) => {
    const { repo } = await boot();

    // No batching can bind this: one row plus a SET clause of nine plain
    // values is past ten on its own, and the refusal says what to do.
    await expect(
      repo.upsertMany(rows(1), {
        target: ["hour", "path"],
        set: {
          count: sql`${1} + ${2} + ${3} + ${4} + ${5} + ${6} + ${7} + ${8} + ${9}`,
        },
      }),
    ).rejects.toThrow(DbTooManyParametersError);
  });
});
