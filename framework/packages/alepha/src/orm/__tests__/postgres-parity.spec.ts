import { Alepha, z } from "alepha";
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
  name: "test_postgres_parity_notes",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    tags: z.array(z.text()),
    meta: z.object({ kind: z.text() }),
    hits: db.default(z.int64(), 0),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
  }),
});

class App {
  repository = $repository(notes);
}

/**
 * Where Postgres answered differently from SQLite for the same repository
 * call: each case passes on both dialects.
 */
const parity = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  const database = alepha.inject(DatabaseProvider);
  await alepha.start();

  const note = await app.repository.create({
    tags: ["bug", "ui"],
    meta: { kind: "held" },
    hits: Number.MAX_SAFE_INTEGER,
  });

  // A pattern over an array or a JSON column reads its JSON text, which is
  // what SQLite stores; Postgres refused `text[] ~~ unknown`.
  const ids = async (where: object) =>
    (await app.repository.findMany({ where: where as never })).map(
      (row) => row.id,
    );
  expect(await ids({ tags: { like: '%"bug"%' } })).toEqual([note.id]);
  expect(await ids({ tags: { like: '%"feat"%' } })).toEqual([]);
  expect(await ids({ tags: { notLike: '%"feat"%' } })).toEqual([note.id]);
  expect(await ids({ meta: { like: '%"held"%' } })).toEqual([note.id]);

  // A row read back matches on its own `updatedAt`: Postgres's `now()`
  // stamped microseconds, which a JS date cannot hold.
  expect(await ids({ updatedAt: note.updatedAt })).toEqual([note.id]);

  // A raw RETURNING row decodes as a repository read does: a Postgres bigint
  // arrives as a string.
  const [rows] = await database.atomicBatch([
    app.repository.updateStatement({ id: note.id }, { hits: 1 }),
  ]);
  expect(app.repository.decodeRow(rows[0]).hits).toBe(1);

  const [row] = await database.execute(
    sql`SELECT hits FROM test_postgres_parity_notes`,
  );
  expect(Number(row.hits)).toBe(1);
  await alepha.stop();
};

describe("postgres parity", () => {
  it("answers as sqlite does (sqlite)", async () => {
    await parity(Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }));
  });

  it("answers as sqlite does (postgres)", async () => {
    await parity(Alepha.create().with(AlephaOrmTestPostgres));
  });
});
