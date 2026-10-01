import { Alepha, z } from "alepha";
import { describe, it } from "vitest";

import {
  $entity,
  $repository,
  db,
  DbVersionMismatchError,
} from "../core/index.ts";
import { AlephaOrmPostgres } from "../postgres/index.ts";

const doc = $entity({
  name: "version_docs",
  schema: z.object({
    id: db.primaryKey(z.integer(), {}, { mode: "byDefault" }),
    title: z.text(),
    slug: z.text().optional(),
    version: db.version(),
    deletedAt: db.deletedAt(),
  }),
  indexes: [{ column: "slug", unique: true }],
});

class App {
  docs = $repository(doc);
}

const suite = (create: () => Alepha) => {
  const setup = async () => {
    const alepha = create();
    const app = alepha.inject(App);
    await alepha.start();
    return app;
  };

  it("is bumped by updateById, updateMany, upsert and a soft delete", async ({
    expect,
  }) => {
    const app = await setup();
    const created = await app.docs.create({ title: "a", slug: "a" });
    expect(created.version).toBe(0);

    const updated = await app.docs.updateById(created.id, { title: "b" });
    expect(updated.version).toBe(1);

    await app.docs.updateMany({ id: { eq: created.id } }, { title: "c" });
    expect((await app.docs.getById(created.id)).version).toBe(2);

    const upserted = await app.docs.upsert(
      { title: "d", slug: "a" },
      { target: ["slug"] },
    );
    expect(upserted.version).toBe(3);

    await app.docs.deleteById(created.id);
    const [deleted] = await app.docs.findMany(
      { where: { id: { eq: created.id } } },
      { force: true },
    );
    expect(deleted?.version).toBe(4);
  });

  it("save() bumps the version and assigns the new row back", async ({
    expect,
  }) => {
    const app = await setup();
    const entity = await app.docs.create({ title: "a" });

    entity.title = "b";
    await app.docs.save(entity);

    expect(entity.version).toBe(1);
    expect((await app.docs.getById(entity.id)).title).toBe("b");
  });

  it("save() racing updateById fails with a 409 mismatch and leaves the object as loaded", async ({
    expect,
  }) => {
    const app = await setup();
    const created = await app.docs.create({ title: "a" });
    const loaded = await app.docs.getById(created.id);

    await app.docs.updateById(created.id, { title: "concurrent" });

    loaded.title = "stale";
    const error = await app.docs.save(loaded).catch((e) => e);
    expect(error).toBeInstanceOf(DbVersionMismatchError);
    expect(error.status).toBe(409);

    expect(loaded.version).toBe(0);
    expect((await app.docs.getById(created.id)).title).toBe("concurrent");
  });

  it("a retry of the same object after a mismatch does not overwrite", async ({
    expect,
  }) => {
    const app = await setup();
    const created = await app.docs.create({ title: "a" });
    const loaded = await app.docs.getById(created.id);

    await app.docs.updateById(created.id, { title: "concurrent" });
    loaded.title = "stale";
    await expect(app.docs.save(loaded)).rejects.toThrow(DbVersionMismatchError);

    // The version of the failed attempt used to stay bumped in memory,
    // so this retry matched the concurrent writer's version.
    await expect(app.docs.save(loaded)).rejects.toThrow(DbVersionMismatchError);
    expect((await app.docs.getById(created.id)).title).toBe("concurrent");
  });
};

describe("db.version()", () => {
  describe("sqlite", () => {
    suite(() => Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } }));
  });
  describe("postgres", () => {
    suite(() => Alepha.create().with(AlephaOrmPostgres));
  });
});
