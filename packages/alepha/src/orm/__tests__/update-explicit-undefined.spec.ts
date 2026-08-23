import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";

import { $entity, $repository, db } from "../core/index.ts";
import { AlephaOrmPostgres } from "../postgres/index.ts";

const tickets = $entity({
  name: "test_update_explicit_undefined",
  schema: z.object({
    id: db.primaryKey(z.integer(), {}, { mode: "byDefault" }),
    title: z.text(),
    status: z.text().default("new"),
  }),
});

class App {
  repository = $repository(tickets);
}

/**
 * An update payload often comes straight from a form or a partial object
 * where an untouched field is `undefined` rather than absent. Re-encoding
 * such a key against the partial schema re-applied the column's default, so
 * `{ title, status: undefined }` quietly reset `status` to "new".
 */
const testExplicitUndefinedIsANoop = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  const created = await app.repository.create({ title: "a", status: "done" });

  const updated = await app.repository.updateById(created.id, {
    title: "b",
    status: undefined,
  });

  expect(updated.title).toBe("b");
  expect(updated.status).toBe("done");
};

describe("update with an explicit undefined", () => {
  it("leaves a defaulted column untouched (sqlite)", async () => {
    await testExplicitUndefinedIsANoop(
      Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }),
    );
  });

  it("leaves a defaulted column untouched (postgres)", async () => {
    await testExplicitUndefinedIsANoop(Alepha.create().with(AlephaOrmPostgres));
  });
});
