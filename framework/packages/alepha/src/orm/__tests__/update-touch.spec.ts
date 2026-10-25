import { $hook, Alepha, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { describe, expect, it } from "vitest";

import { $entity, $repository, db } from "../core/index.ts";
import { AlephaOrmPostgres } from "../postgres/index.ts";

const releases = $entity({
  name: "test_touch_releases",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    projectId: z.integer(),
    tag: z.text(),
    defaultSince: z.datetime().nullable().optional(),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
  }),
});

const plain = $entity({
  name: "test_touch_plain",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    label: z.text(),
  }),
});

class App {
  releases = $repository(releases);
  plain = $repository(plain);
  updates = 0;

  onUpdate = $hook({
    on: "repository:update:after",
    handler: async ({ tableName }) => {
      if (tableName === "test_touch_releases") this.updates++;
    },
  });
}

const iso = (value: unknown) => new Date(value as string).toISOString();

/**
 * The shape of Lore's `DefaultReleaseService.set`: clear the default on every
 * release of a project without the activity feed reading it as an edit.
 */
const testUpdateManyLeavesUpdatedAt = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  const dateTime = alepha.inject(DateTimeProvider);
  await alepha.start();

  dateTime.pause();
  const a = await app.releases.create({
    projectId: 1,
    tag: "1.0.0",
    defaultSince: dateTime.nowISOString(),
  });
  const b = await app.releases.create({ projectId: 1, tag: "1.1.0" });

  // A cached read, so the invalidation is observable.
  await app.releases.findMany({}, { cache: { ttl: 60_000 } });

  await dateTime.travel(1, "hour");
  const ids = await app.releases.updateMany(
    { projectId: { eq: 1 }, defaultSince: { isNotNull: true } },
    { defaultSince: null },
    { touch: false },
  );
  expect(ids).toEqual([a.id]);

  const after = await app.releases.getById(a.id);
  expect(after.defaultSince ?? null).toBeNull();
  expect(iso(after.updatedAt)).toBe(iso(a.updatedAt));
  expect(after.version).toBe(a.version + 1);
  expect(app.updates).toBe(1);

  const cached = await app.releases.findMany({}, { cache: { ttl: 60_000 } });
  expect(cached.find((r) => r.id === a.id)?.defaultSince ?? null).toBeNull();

  // The default stays on: the untouched row moves, the touched one does not.
  await app.releases.updateById(b.id, { tag: "1.1.1" });
  const touched = await app.releases.getById(b.id);
  expect(iso(touched.updatedAt)).toBe(dateTime.nowISOString());
};

const testUpdateOneAndSave = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  const dateTime = alepha.inject(DateTimeProvider);
  await alepha.start();

  dateTime.pause();
  const created = await app.releases.create({ projectId: 2, tag: "2.0.0" });
  await dateTime.travel(1, "hour");

  const viaById = await app.releases.updateById(
    created.id,
    { tag: "2.0.1" },
    { touch: false },
  );
  expect(viaById.tag).toBe("2.0.1");
  expect(iso(viaById.updatedAt)).toBe(iso(created.updatedAt));

  const loaded = await app.releases.getById(created.id);
  loaded.tag = "2.0.2";
  await app.releases.save(loaded, { touch: false });
  expect(loaded.tag).toBe("2.0.2");
  expect(loaded.version).toBe(created.version + 2);
  expect(iso(loaded.updatedAt)).toBe(iso(created.updatedAt));

  // An explicit `updatedAt` in the patch is written as given.
  const explicit = "2020-01-01T00:00:00.000Z";
  const written = await app.releases.updateOne(
    { id: { eq: created.id } },
    { updatedAt: explicit },
    { touch: false },
  );
  expect(iso(written.updatedAt)).toBe(explicit);
};

const testNoUpdatedAtColumn = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();

  const row = await app.plain.create({ label: "a" });
  const updated = await app.plain.updateById(
    row.id,
    { label: "b" },
    { touch: false },
  );
  expect(updated.label).toBe("b");
};

/**
 * Compile-time only: reads and upserts do not take `touch`.
 */
const typeChecks = (app: App) => {
  // @ts-expect-error touch is an update option, not a read option
  void app.releases.findMany({}, { touch: false });
  // @ts-expect-error upsert always stamps updatedAt on conflict
  void app.releases.upsert({ projectId: 1, tag: "x" }, { touch: false });
};
void typeChecks;

const sqlite = () =>
  Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } });
const postgres = () => Alepha.create().with(AlephaOrmPostgres);

describe("UpdateOptions.touch", () => {
  it("updateMany with touch: false keeps updatedAt, bumps version, fires events (sqlite)", async () => {
    await testUpdateManyLeavesUpdatedAt(sqlite());
  });

  it("updateMany with touch: false keeps updatedAt, bumps version, fires events (postgres)", async () => {
    await testUpdateManyLeavesUpdatedAt(postgres());
  });

  it("updateById and save honour touch: false (sqlite)", async () => {
    await testUpdateOneAndSave(sqlite());
  });

  it("updateById and save honour touch: false (postgres)", async () => {
    await testUpdateOneAndSave(postgres());
  });

  it("is a no-op on a table without updatedAt", async () => {
    await testNoUpdatedAtColumn(sqlite());
  });
});
