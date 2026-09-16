import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";

import { $entity, DatabaseProvider, Repository, db } from "../core/index.ts";
import {
  NodeSqliteProvider,
  nodeSqliteOptions,
} from "../core/providers/drivers/NodeSqliteProvider.ts";

/**
 * A driver that binds at most ten values per statement: Cloudflare D1's
 * ceiling of 100, scaled down so a handful of rows crosses it. The SQLite
 * build underneath accepts far more, so what this proves is the batching
 * arithmetic and that a batched insert still answers every row in order;
 * the driver's own refusal is classified in `orm-errors.spec.ts`.
 */
class TinyCeilingProvider extends NodeSqliteProvider {
  public override readonly maxBoundParameters = 10;
}

const batchingRows = $entity({
  name: "batching_rows",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    a: z.text(),
    b: z.text(),
  }),
});

class TestRepository extends Repository<typeof batchingRows.schema> {
  constructor() {
    super(batchingRows);
  }

  public testBatchSize = (
    rows: ReadonlyArray<Record<string, unknown>>,
    requested?: number,
  ): number => this.insertBatchSize(rows, requested);
}

/**
 * The shape almost every real entity has: a uuid primary key generated
 * app-side and a `version` default. Neither is ever named by a caller, and
 * both bind a value on every row.
 */
const generatedRows = $entity({
  name: "batching_generated_rows",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    version: db.version(),
    a: z.text(),
    b: z.text(),
  }),
});

class GeneratedRepository extends Repository<typeof generatedRows.schema> {
  constructor() {
    super(generatedRows);
  }

  public testBatchSize = (
    rows: ReadonlyArray<Record<string, unknown>>,
    requested?: number,
  ): number => this.insertBatchSize(rows, requested);

  /** What the driver is really handed for these rows. */
  public boundParametersFor = (
    rows: ReadonlyArray<Record<string, unknown>>,
  ): number => (this.rawInsert({}) as any).values(rows).toSQL().params.length;
}

describe("createMany batching", () => {
  const boot = async () => {
    const alepha = Alepha.create().with({
      provide: DatabaseProvider,
      use: TinyCeilingProvider,
    });
    alepha.store.mut(nodeSqliteOptions, (old) => ({
      ...old,
      path: "sqlite://:memory:",
    }));
    const repo = alepha.inject(TestRepository);
    await alepha.start();
    return { alepha, repo };
  };

  it("sizes a statement from the driver's ceiling, not a flat thousand", async () => {
    const { repo } = await boot();
    const twoColumns = [
      { a: "1", b: "1" },
      { a: "2", b: "2" },
    ];

    // Ten values per statement, two per row: five rows.
    expect(repo.testBatchSize(twoColumns)).toBe(5);
    // A caller asking for less than the ceiling allows keeps its number.
    expect(repo.testBatchSize(twoColumns, 3)).toBe(3);
    // The widest row decides, since every row of a statement binds the
    // union of the provided columns.
    expect(repo.testBatchSize([{ a: "1" }, { a: "1", b: "1", c: "1" }])).toBe(
      3,
    );
    // Wider than the ceiling: one row per statement, and the driver says no.
    const wide = Object.fromEntries(
      Array.from({ length: 11 }, (_, i) => [`c${i}`, i]),
    );
    expect(repo.testBatchSize([wide])).toBe(1);
  });

  it("counts the id and version it generates, not just the caller's keys", async () => {
    const alepha = Alepha.create().with({
      provide: DatabaseProvider,
      use: TinyCeilingProvider,
    });
    alepha.store.mut(nodeSqliteOptions, (old) => ({
      ...old,
      path: "sqlite://:memory:",
    }));
    const repo = alepha.inject(GeneratedRepository);
    await alepha.start();

    const twoColumns = [
      { a: "1", b: "1" },
      { a: "2", b: "2" },
    ];

    // Four values per row, not two: `a`, `b`, the generated `id` and
    // `version`. Ten per statement leaves two rows, where counting the
    // caller's keys alone claimed five and bound twenty.
    expect(repo.testBatchSize(twoColumns)).toBe(2);

    // A caller that names the generated column itself is not double-counted.
    expect(
      repo.testBatchSize([
        { id: "00000000-0000-0000-0000-000000000001", a: "1", b: "1" },
      ]),
    ).toBe(2);

    // An explicit `undefined` reads as absent to drizzle, which then binds
    // the default - so it counts exactly as an omitted key does.
    expect(repo.testBatchSize([{ a: "1", b: undefined }])).toBe(3);

    // The arithmetic is pinned against what drizzle ACTUALLY binds, not
    // against a second copy of the same reasoning: a batch of that size must
    // really fit under the ceiling.
    const batch = Array.from(
      { length: repo.testBatchSize(twoColumns) },
      (_, i) => ({
        a: `a${i}`,
        b: `b${i}`,
      }),
    );
    const bound = repo.boundParametersFor(batch);
    expect(bound).toBe(batch.length * 4);
    expect(bound).toBeLessThanOrEqual(10);

    // And every row of a multi-statement insert really lands.
    const values = Array.from({ length: 7 }, (_, i) => ({
      a: `a${i}`,
      b: `b${i}`,
    }));
    const created = await repo.createMany(values);
    expect(created.map((r) => r.a)).toEqual(values.map((v) => v.a));
  });

  it("inserts more rows than one statement may bind, in order", async () => {
    const { repo } = await boot();
    // 23 rows of two columns: five statements of five rows, then three.
    const values = Array.from({ length: 23 }, (_, i) => ({
      a: `a${i}`,
      b: `b${i}`,
    }));

    const created = await repo.createMany(values);

    expect(created.map((r) => r.a)).toEqual(values.map((v) => v.a));
    const stored = await repo.findMany({
      orderBy: [{ column: "id", direction: "asc" }],
    });
    expect(stored.map((r) => r.b)).toEqual(values.map((v) => v.b));
  });
});
