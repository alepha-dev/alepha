import { $hook, Alepha, z } from "alepha";
import { AlephaOrmTestPostgres } from "alepha/orm";
import { describe, expect, it } from "vitest";

import {
  $entity,
  $repository,
  DatabaseProvider,
  db,
  sql,
} from "../core/index.ts";

const notes = $entity({
  name: "test_statement_builder_notes",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    title: z.text(),
    status: z.text(),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    deletedAt: db.deletedAt(),
  }),
});

class App {
  notes = $repository(notes);
  seen: string[] = [];
  onCreate = $hook({
    on: "repository:create:after",
    handler: ({ tableName, entity }) => {
      if (tableName === notes.name) this.seen.push(`create ${entity.title}`);
    },
  });
  onUpdate = $hook({
    on: "repository:update:after",
    handler: ({ tableName, entities }) => {
      if (tableName === notes.name)
        this.seen.push(`update ${entities.map((it) => it.status).join(",")}`);
    },
  });
  onDelete = $hook({
    on: "repository:delete:after",
    handler: ({ tableName, ids }) => {
      if (tableName === notes.name) this.seen.push(`delete ${ids.length}`);
    },
  });
}

const builders = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  const database = alepha.inject(DatabaseProvider);
  await alepha.start();
  const { notes: repo } = app;
  const a = crypto.randomUUID();
  const b = crypto.randomUUID();

  // Insert: cast like create, returned, the event after the batch.
  const [inserted] = await database.atomicBatch([
    repo.insertStatement({ id: a, title: "A", status: "open" }),
    repo.insertStatement({ id: b, title: "B", status: "open" }),
  ]);
  expect(repo.decodeRow(inserted[0])).toMatchObject({ id: a, version: 0 });
  expect(app.seen).toEqual(["create A", "create B"]);

  // `events: false`: the caller emits; nothing fires from the batch.
  app.seen.length = 0;
  const quietId = crypto.randomUUID();
  await database.atomicBatch([
    repo.insertStatement(
      { id: quietId, title: "Q", status: "open" },
      { events: false },
    ),
  ]);
  expect(app.seen).toEqual([]);
  await repo.deleteById(quietId, { force: true });

  // Do nothing on conflict: no row, no event.
  app.seen.length = 0;
  const [skipped] = await database.atomicBatch([
    repo.insertStatement(
      { id: a, title: "again", status: "open" },
      { onConflictDoNothing: true },
    ),
  ]);
  expect(skipped).toEqual([]);
  expect(app.seen).toEqual([]);

  // Update: touch and version by default, each switchable.
  const before = await repo.getById(a);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await database.atomicBatch([
    repo.updateStatement({ id: a }, { status: "touched" }),
  ]);
  const touched = await repo.getById(a);
  expect(touched.version).toBe(before.version + 1);
  expect(touched.updatedAt > before.updatedAt).toBe(true);
  await database.atomicBatch([
    repo.updateStatement(
      { id: a },
      { status: "quiet" },
      { touch: false, version: false },
    ),
  ]);
  const quiet = await repo.getById(a);
  expect(quiet).toMatchObject({
    status: "quiet",
    version: touched.version,
    updatedAt: touched.updatedAt,
  });
  expect(app.seen).toEqual(["update touched", "update quiet"]);

  // Soft-deleted rows: hidden by default, reached with force.
  await repo.deleteById(b);
  app.seen.length = 0;
  const [missed] = await database.atomicBatch([
    repo.updateStatement({ id: b }, { status: "x" }),
  ]);
  expect(missed).toEqual([]);
  await database.atomicBatch([
    repo.updateStatement({ id: b }, { status: "moved" }, { force: true }),
  ]);
  expect((await repo.getById(b, { force: true })).status).toBe("moved");

  // exists / notExists / scalar, with force.
  const [flags] = await database
    .execute(
      sql`SELECT
      CASE WHEN ${repo.exists({ id: b })} THEN 1 ELSE 0 END AS live,
      CASE WHEN ${repo.exists({ id: b }, { force: true })} THEN 1 ELSE 0 END AS any,
      CASE WHEN ${repo.notExists({ id: b })} THEN 1 ELSE 0 END AS gone,
      ${repo.scalar({ id: b }, "status", { force: true })} AS status`,
    )
    .then((rows) => rows);
  expect({
    live: Number(flags.live),
    any: Number(flags.any),
    gone: Number(flags.gone),
    status: flags.status,
  }).toEqual({ live: 0, any: 1, gone: 1, status: "moved" });

  // Delete: hard, live rows unless force.
  app.seen.length = 0;
  await database.atomicBatch([repo.deleteStatement({ id: b })]);
  expect(await repo.findById(b, { force: true })).toBeDefined();
  await database.atomicBatch([
    repo.deleteStatement({ id: b }, { force: true }),
  ]);
  expect(await repo.findById(b, { force: true })).toBeUndefined();
  expect(app.seen).toEqual(["delete 0", "delete 1"]);

  // Inside a transaction: the event waits for the COMMIT, and a rollback
  // drops it.
  app.seen.length = 0;
  const c = crypto.randomUUID();
  await database.transactional(async () => {
    await database.atomicBatch([
      repo.insertStatement({ id: c, title: "C", status: "open" }),
    ]);
    expect(app.seen).toEqual([]);
  });
  expect(app.seen).toEqual(["create C"]);
  app.seen.length = 0;
  await expect(
    database.transactional(async () => {
      await database.atomicBatch([
        repo.insertStatement({
          id: crypto.randomUUID(),
          title: "D",
          status: "open",
        }),
      ]);
      throw new Error("roll back");
    }),
  ).rejects.toThrow("roll back");
  expect(app.seen).toEqual([]);
  await alepha.stop();
};

describe("Repository statement builders", () => {
  it("insert, update, delete, exists and scalar in an atomic batch (sqlite)", async () => {
    await builders(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });

  it("insert, update, delete, exists and scalar in an atomic batch (postgres)", async () => {
    await builders(Alepha.create().with(AlephaOrmTestPostgres));
  });
});
