import { Alepha, z } from "alepha";
import { AlephaOrmTestPostgres } from "alepha/orm";
import { describe, expect, it } from "vitest";

import { $entity, $repository, DatabaseProvider, db, sql } from "../core/index.ts";

const documents = $entity({
  name: "test_jsonb_documents",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    meta: z.object({ kind: z.text(), tags: z.array(z.text()) }),
  }),
});

class App {
  repository = $repository(documents);
}

/**
 * A json column on Postgres holds the document itself. postgres.js
 * JSON-encodes a jsonb parameter, and the column type had already encoded
 * it: stored twice, every document was a JSON string scalar. Reads still
 * round-tripped, so only SQL that looks inside the column could tell.
 */
describe("jsonb storage (postgres)", () => {
  it("stores an object, which SQL can read into", async () => {
    const alepha = Alepha.create().with(AlephaOrmTestPostgres);
    const app = alepha.inject(App);
    const database = alepha.inject(DatabaseProvider);
    await alepha.start();

    await app.repository.create({ meta: { kind: "note", tags: ["a", "b"] } });

    const [row] = await database.execute(
      sql`SELECT jsonb_typeof(meta) AS type, meta->>'kind' AS kind, jsonb_array_length(meta->'tags') AS tags FROM test_jsonb_documents`,
    );
    expect(row).toEqual({ type: "object", kind: "note", tags: 2 });

    const [found] = await app.repository.findMany();
    expect(found.meta).toEqual({ kind: "note", tags: ["a", "b"] });
    await alepha.stop();
  });
});
