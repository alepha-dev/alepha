import { Alepha, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { describe, expect, it } from "vitest";

import { $entity, $repository, db, sql } from "../core/index.ts";
import { AlephaOrmPostgres } from "../postgres/index.ts";

const epics = $entity({
  name: "test_sq_epics",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    projectId: z.integer(),
    status: z.text(),
    deletedAt: db.deletedAt(),
  }),
});

const quests = $entity({
  name: "test_sq_quests",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    projectId: z.integer(),
    title: z.text(),
    epicId: z.integer().nullable().optional(),
    dependsOn: z.integer().nullable().optional(),
    completedAt: z.datetime().nullable().optional(),
    shelvedAt: z.datetime().nullable().optional(),
    deletedAt: db.deletedAt(),
  }),
});

const releases = $entity({
  name: "test_sq_releases",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    projectId: z.integer(),
    tag: z.text(),
  }),
});

class App {
  epics = $repository(epics);
  quests = $repository(quests);
  releases = $repository(releases);
}

/**
 * Epic e1: every quest done. e2: one open quest. e3: draft, open quest. e4:
 * its only open quest is soft-deleted. Ids are generated (Postgres ignores
 * explicit ones), so the seed returns them by name.
 */
const seed = async (app: App, now: string) => {
  const [e1, e2, e3, e4] = await app.epics.createMany([
    { projectId: 1, status: "in_progress" },
    { projectId: 1, status: "in_progress" },
    { projectId: 1, status: "draft" },
    { projectId: 1, status: "in_progress" },
  ]);
  const [done, shelved, open, draft, deleted, loose] =
    await app.quests.createMany([
      { projectId: 1, title: "done", epicId: e1.id, completedAt: now },
      { projectId: 1, title: "shelved", epicId: e1.id, shelvedAt: now },
      { projectId: 1, title: "open", epicId: e2.id },
      { projectId: 1, title: "draft work", epicId: e3.id },
      { projectId: 1, title: "deleted", epicId: e4.id },
      { projectId: 1, title: "loose" },
    ]);
  const [blocked, unblocked] = await app.quests.createMany([
    { projectId: 1, title: "blocked", dependsOn: open.id },
    { projectId: 1, title: "unblocked", dependsOn: done.id },
  ]);
  await app.quests.deleteById(deleted.id);
  return {
    e1: e1.id,
    e2: e2.id,
    e3: e3.id,
    e4: e4.id,
    done: done.id,
    shelved: shelved.id,
    open: open.id,
    draft: draft.id,
    loose: loose.id,
    blocked: blocked.id,
    unblocked: unblocked.id,
  };
};

const sorted = (ids: Array<number | string>) =>
  [...ids].map(Number).sort((a, b) => a - b);

/**
 * `EpicWorkflowService.finish` / `sweep`: epics with no open quest left.
 * The soft-deleted quest of epic 4 does not keep it open.
 */
const testNotExists = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();
  const ids = await seed(app, alepha.inject(DateTimeProvider).nowISOString());

  const finished = await app.epics.findMany({
    where: {
      notExists: app.quests.subquery({
        epicId: { eq: app.epics.table.id },
        completedAt: { isNull: true },
        shelvedAt: { isNull: true },
      }),
    },
    orderBy: "id",
  });
  expect(sorted(finished.map((e) => e.id))).toEqual(sorted([ids.e1, ids.e4]));

  // `force` keeps the soft-deleted quest, and epic 4 is open again.
  const withDeleted = await app.epics.findMany({
    where: {
      notExists: app.quests.subquery(
        {
          epicId: { eq: app.epics.table.id },
          completedAt: { isNull: true },
          shelvedAt: { isNull: true },
        },
        undefined,
        { force: true },
      ),
    },
    orderBy: "id",
  });
  expect(withDeleted.map((e) => e.id)).toEqual([ids.e1]);

  // Same shape through updateMany, as `sweep` writes it.
  const swept = await app.epics.updateMany(
    {
      status: { eq: "in_progress" },
      notExists: app.quests.subquery({
        epicId: { eq: app.epics.table.id },
        completedAt: { isNull: true },
        shelvedAt: { isNull: true },
      }),
    },
    { status: "completed" },
  );
  expect(sorted(swept)).toEqual(sorted([ids.e1, ids.e4]));
};

/**
 * `EpicVisibilityService.applyBacklogGate`: quests outside the project's draft
 * epics, loose ones included.
 */
const testNotInArraySubquery = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();
  const ids = await seed(app, alepha.inject(DateTimeProvider).nowISOString());

  const visible = await app.quests.findMany({
    where: {
      or: [
        { epicId: { isNull: true } },
        {
          epicId: {
            notInArray: app.epics.subquery(
              { projectId: { eq: 1 }, status: { eq: "draft" } },
              "id",
            ),
          },
        },
      ],
    },
    orderBy: "id",
  });
  expect(sorted(visible.map((q) => q.id))).toEqual(
    sorted([
      ids.done,
      ids.shelved,
      ids.open,
      ids.loose,
      ids.blocked,
      ids.unblocked,
    ]),
  );

  const inDrafts = await app.quests.findMany({
    where: {
      epicId: {
        inArray: app.epics.subquery({ status: { eq: "draft" } }, "id"),
      },
    },
  });
  expect(inDrafts.map((q) => q.id)).toEqual([ids.draft]);
};

/**
 * `DefaultReleaseService.set`: the EXISTS guard, an update that applies only
 * when a row of another table exists.
 */
const testExistsGuard = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();
  const ids = await seed(app, alepha.inject(DateTimeProvider).nowISOString());
  await app.releases.create({ projectId: 1, tag: "1.0.0" });

  const guarded = await app.epics.updateMany(
    {
      id: { eq: ids.e2 },
      exists: app.releases.subquery({
        projectId: { eq: app.epics.table.projectId },
        tag: { eq: "1.0.0" },
      }),
    },
    { status: "released" },
  );
  expect(guarded).toEqual([ids.e2]);

  const missed = await app.epics.updateMany(
    {
      id: { eq: ids.e2 },
      exists: app.releases.subquery({ tag: { eq: "9.9.9" } }),
    },
    { status: "never" },
  );
  expect(missed).toEqual([]);
};

/**
 * The attention report's `blocked_quests`: a quest whose dependency is still
 * open, a subquery of the outer query's own table.
 */
const testSelfReferencing = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();
  const ids = await seed(app, alepha.inject(DateTimeProvider).nowISOString());

  const blocked = await app.quests.findMany({
    where: {
      exists: app.quests.subquery({
        id: { eq: app.quests.table.dependsOn },
        completedAt: { isNull: true },
      }),
    },
  });
  expect(blocked.map((q) => q.id)).toEqual([ids.blocked]);

  expect(() =>
    app.quests.subquery({
      exists: app.quests.subquery({ id: { eq: 1 } }),
    }),
  ).toThrow(/cannot nest another subquery/);
};

/**
 * Columns and SQL fragments as comparison values, for every operator.
 */
const testColumnAndSqlValues = async (alepha: Alepha) => {
  const app = alepha.inject(App);
  await alepha.start();
  const ids = await seed(app, alepha.inject(DateTimeProvider).nowISOString());
  const t = app.quests.table;

  // Another column as the value: quests whose dependency was created
  // before them.
  const later = await app.quests.findMany({
    where: { id: { gt: t.dependsOn }, dependsOn: { lte: sql`${ids.done}` } },
  });
  expect(later.map((q) => q.id)).toEqual([ids.unblocked]);

  const columns = await app.quests.findMany({
    where: { projectId: { eq: t.projectId }, dependsOn: { ne: t.id } },
  });
  expect(sorted(columns.map((q) => q.id))).toEqual(
    sorted([ids.blocked, ids.unblocked]),
  );

  const fragments = await app.quests.findMany({
    where: { id: { gte: sql`${ids.loose}`, lt: sql`${ids.unblocked}` } },
  });
  expect(sorted(fragments.map((q) => q.id))).toEqual(
    sorted([ids.loose, ids.blocked]),
  );
};

const sqlite = () =>
  Alepha.create({ env: { DATABASE_URL: "sqlite://:memory:" } });
const postgres = () => Alepha.create().with(AlephaOrmPostgres);

describe("Repository.subquery", () => {
  it("notExists finds epics with no open quest, soft delete applied (sqlite)", async () => {
    await testNotExists(sqlite());
  });

  it("notExists finds epics with no open quest, soft delete applied (postgres)", async () => {
    await testNotExists(postgres());
  });

  it("notInArray / inArray take a column subquery (sqlite)", async () => {
    await testNotInArraySubquery(sqlite());
  });

  it("notInArray / inArray take a column subquery (postgres)", async () => {
    await testNotInArraySubquery(postgres());
  });

  it("exists guards an update on another table (sqlite)", async () => {
    await testExistsGuard(sqlite());
  });

  it("exists guards an update on another table (postgres)", async () => {
    await testExistsGuard(postgres());
  });

  it("a self-referencing subquery reads the outer row; nesting throws (sqlite)", async () => {
    await testSelfReferencing(sqlite());
  });

  it("a self-referencing subquery reads the outer row; nesting throws (postgres)", async () => {
    await testSelfReferencing(postgres());
  });

  it("eq / ne / gt / gte / lt / lte take a column or an SQL fragment (sqlite)", async () => {
    await testColumnAndSqlValues(sqlite());
  });

  it("eq / ne / gt / gte / lt / lte take a column or an SQL fragment (postgres)", async () => {
    await testColumnAndSqlValues(postgres());
  });
});
