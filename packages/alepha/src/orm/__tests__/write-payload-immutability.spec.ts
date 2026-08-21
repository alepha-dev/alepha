import { Alepha, z } from "alepha";
import { describe, expect, it } from "vitest";

import { $entity, $repository, db } from "../core/index.ts";

/**
 * A write must not edit the object the caller handed it. `updateMany` already
 * copies before stamping `updatedAt`; `updateOne` and `upsert` did not, so a
 * shared or reused patch came back carrying a column it never declared.
 */

const items = $entity({
  name: "write_payload_items",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    name: z.text(),
  }),
});

class App {
  repository = $repository(items);
}

const boot = async () => {
  const alepha = Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } });
  const app = alepha.inject(App);
  await alepha.start();
  return app;
};

describe("writes do not mutate the caller's payload", () => {
  it("should leave an updateById patch untouched", async () => {
    const app = await boot();
    const row = await app.repository.create({ name: "a" });

    const patch = { name: "b" };
    await app.repository.updateById(row.id as number, patch);

    expect(Object.keys(patch)).toEqual(["name"]);
  });

  it("should leave an updateOne patch untouched", async () => {
    const app = await boot();
    await app.repository.create({ name: "a" });

    const patch = { name: "b" };
    await app.repository.updateOne({ name: { eq: "a" } }, patch);

    expect(Object.keys(patch)).toEqual(["name"]);
  });

  it("should leave an upsert set clause untouched", async () => {
    const app = await boot();
    const created = await app.repository.create({ name: "a" });

    const set = { name: "b" };
    await app.repository.upsert({ id: created.id, name: "a" }, { set });

    expect(Object.keys(set)).toEqual(["name"]);
  });

  it("should still stamp updatedAt on the persisted row", async () => {
    const app = await boot();
    const row = await app.repository.create({ name: "a" });
    const before = row.updatedAt;

    const updated = await app.repository.updateById(
      row.id as number,
      {
        name: "b",
        // forcing a distinct instant
      } as any,
      { now: "2030-01-01T00:00:00.000Z" },
    );

    expect(updated.updatedAt).not.toEqual(before);
    expect(updated.name).toEqual("b");
  });

  it("should leave a reused StatementOptions untouched on destroy", async () => {
    const softItems = $entity({
      name: "write_payload_soft_items",
      schema: z.object({
        id: db.primaryKey(z.integer()),
        deletedAt: db.deletedAt(),
        name: z.text(),
      }),
    });
    class SoftApp {
      repository = $repository(softItems);
    }
    const alepha = Alepha.create({
      env: { DATABASE_URL: "sqlite://:memory:" },
    });
    const app = alepha.inject(SoftApp);
    await alepha.start();

    const row = await app.repository.create({ name: "a" });
    const opts = {};
    await app.repository.destroy(row, opts);

    expect(Object.keys(opts)).toEqual([]);
  });
});
