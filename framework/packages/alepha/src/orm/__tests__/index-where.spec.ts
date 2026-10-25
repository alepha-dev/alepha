import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";

import { $entity, $repository, db, sql } from "../core/index.ts";
import { DrizzleKitProvider } from "../core/providers/DrizzleKitProvider.ts";
import { AlephaOrmPostgres } from "../postgres/index.ts";

/**
 * The shape of Lore's `quests_open_idx`, plus a value that has to be inlined
 * and the logical operators.
 */
const quests = $entity({
  name: "test_index_where_quests",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    projectId: z.integer(),
    status: z.text(),
    completedAt: z.datetime().optional(),
    shelvedAt: z.datetime().optional(),
    deletedAt: db.deletedAt(),
  }),
  indexes: [
    {
      columns: ["projectId", "deletedAt", "completedAt", "shelvedAt"],
      name: "test_index_where_open_idx",
      where: {
        deletedAt: { isNull: true },
        completedAt: { isNull: true },
        shelvedAt: { isNull: true },
      },
    },
    {
      column: "status",
      name: "test_index_where_status_idx",
      where: {
        or: [{ status: { eq: "draft" } }, { not: { projectId: { gt: 10 } } }],
      },
    },
    {
      column: "projectId",
      name: "test_index_where_raw_idx",
      where: sql`deleted_at IS NULL`,
    },
  ],
});

class App {
  quests = $repository(quests);
}

const indexStatements = (statements: string[]) =>
  statements.filter((s) => s.includes("test_index_where_"));

const predicates = (snapshot: any) =>
  Object.fromEntries(
    (snapshot.ddl as any[])
      .filter((d) => d.entityType === "indexes" && d.name.startsWith("test_"))
      .map((d) => [d.name, d.where]),
  );

/**
 * The index is created (`start()` pushes it), its predicate is the compiled
 * where-object with values inlined, and a migration generated from its own
 * snapshot is empty: the compiled text is stable from one build to the next.
 */
const testCompiledPredicate = async (
  alepha: Alepha,
  expected: Record<string, string>,
) => {
  const app = alepha.inject(App);
  await alepha.start();
  const kit = alepha.inject(DrizzleKitProvider);

  const first = await kit.generateMigration(app.quests.provider);
  expect(predicates(first.snapshot)).toEqual(expected);
  expect(indexStatements(first.statements).join("\n")).not.toContain("$1");

  const again = await kit.generateMigration(
    app.quests.provider,
    first.snapshot,
  );
  expect(indexStatements(again.statements)).toEqual([]);

  // The index admits the rows it should: a write through it still works.
  await app.quests.create({ projectId: 1, status: "draft" });
  expect(await app.quests.count({ status: { eq: "draft" } })).toBe(1);
};

const refusing = (where: unknown) =>
  $entity({
    name: "test_index_where_refused",
    schema: z.object({
      id: db.primaryKey(z.integer()),
      projectId: z.integer(),
      parentId: z.integer().optional(),
    }),
    indexes: [
      { column: "projectId", name: "refused_idx", where: where as any },
    ],
  });

const testRefusals = async () => {
  const cases: Array<[unknown, RegExp]> = [
    [{ exists: sql`select 1` }, /'exists'/],
    [{ notExists: sql`select 1` }, /'notExists'/],
    [{ project: { id: { eq: 1 } } }, /'project', which is not a column/],
    [{ and: [sql`1 = 1`] }, /raw SQL fragment nested/],
    [{ projectId: sql`1` }, /raw SQL fragment as the value of 'projectId'/],
    [{ parentId: { inArray: sql`select 1` } }, /operand of 'parentId'/],
  ];

  for (const [where, message] of cases) {
    const alepha = Alepha.create({
      env: { DATABASE_URL: "sqlite://:memory:" },
    });
    const entity = refusing(where);
    class Refused {
      repo = $repository(entity);
    }
    alepha.inject(Refused);

    // Raised while the schema is built, and wrapped by the sync: read the
    // cause chain.
    const error = await alepha.start().then(
      () => undefined,
      (e: unknown) => e,
    );
    const chain: string[] = [];
    for (let e: any = error; e; e = e.cause) chain.push(String(e.message));
    expect(chain.join("\n")).toMatch(message);
    expect(chain.join("\n")).toMatch(/Partial index 'refused_idx'/);
  }
};

const OPEN_PG =
  '((("deleted_at" is null)) and (("completed_at" is null)) and (("shelved_at" is null)))';
const STATUS_PG = `(("status" = 'draft') or (not ("project_id" > 10)))`;

const q = (column: string) => `"test_index_where_quests"."${column}"`;
const OPEN_SQLITE = `(((${q("deleted_at")} is null)) and ((${q("completed_at")} is null)) and ((${q("shelved_at")} is null)))`;
const STATUS_SQLITE = `((${q("status")} = 'draft') or (not (${q("project_id")} > 10)))`;

describe("partial index where-object", () => {
  it("compiles, inlines values and does not drift (sqlite)", async () => {
    await testCompiledPredicate(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
      {
        test_index_where_open_idx: OPEN_SQLITE,
        test_index_where_status_idx: STATUS_SQLITE,
        test_index_where_raw_idx: "deleted_at IS NULL",
      },
    );
  });

  it("compiles, inlines values and does not drift (postgres)", async () => {
    await testCompiledPredicate(Alepha.create().with(AlephaOrmPostgres), {
      test_index_where_open_idx: OPEN_PG,
      test_index_where_status_idx: STATUS_PG,
      test_index_where_raw_idx: "deleted_at IS NULL",
    });
  });

  it("refuses subqueries, joins and nested fragments, naming the index", async () => {
    await testRefusals();
  });
});
