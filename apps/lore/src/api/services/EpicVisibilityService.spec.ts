import { $inject, Alepha } from "alepha";
import { describe, it } from "vitest";

import {
  createTestEpic,
  createTestProject,
  createTestQuest,
  TestEntityRepositories,
} from "../../../test/fixtures/entities.ts";
import type { Quest } from "../entities/quests.ts";
import { EpicVisibilityService } from "./EpicVisibilityService.ts";

/**
 * The smallest listing surface that exercises the gate for real: it builds
 * a where-clause the way `QuestController.getQuests` does, hands it to
 * `applyBacklogGate`, and runs the result through an actual repository.
 *
 * Running real SQL is the whole point. A stub that re-applied the predicate
 * in TypeScript would happily pass every assertion below while production
 * hid the entire backlog — `NULL NOT IN (1)` is SQL's answer, not
 * JavaScript's.
 *
 * `TestEntityRepositories` is composed rather than extended so that
 * `alepha.inject(TestEntityRepositories)` inside the `createTest*` helpers
 * hits this same cached instance instead of `ContainerLockedError`; see the
 * comment on that class for why every FK target has to be registered before
 * `alepha.start()`.
 */
class TestApp {
  repos = $inject(TestEntityRepositories);
  epicVisibility = $inject(EpicVisibilityService);

  async listVisibleQuests(projectId: number): Promise<Quest[]> {
    const where = this.repos.quests.createQueryWhere();
    where.projectId = { eq: projectId };
    await this.epicVisibility.applyBacklogGate(where, projectId);
    return this.repos.quests.findMany({
      where,
      orderBy: [{ column: "id", direction: "asc" }],
    });
  }
}

describe("EpicVisibilityService", () => {
  it("is a no-op when the project has no planned epic", async ({ expect }) => {
    // Trap 2: `notInArray: []` THROWS. A project with zero planned epics is
    // the normal case, so the clause must be omitted, never passed empty.
    const alepha = Alepha.create({
      // Pinned, like every other lore spec: the ROOT vitest config — the one
      // CI runs — sets DATABASE_URL to a Postgres URL, which this app's
      // SQLite provider rejects outright. A bare `Alepha.create()` passes
      // under `yarn w lore test` and fails under `yarn test`.
      env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
    });
    const app = alepha.inject(TestApp);
    await alepha.start();

    const project = await createTestProject(alepha);
    const where = app.repos.quests.createQueryWhere();
    where.projectId = { eq: project.id };

    await expect(
      app.epicVisibility.applyBacklogGate(where, project.id),
    ).resolves.toBeUndefined();
    expect(where.or).toBeUndefined();

    // And the omission has to survive contact with the query builder: an
    // empty `notInArray` fails at `toSQL`, not at assignment.
    const quest = await createTestQuest(alepha, project);
    expect((await app.listVisibleQuests(project.id)).map((q) => q.id)).toEqual([
      quest.id,
    ]);
  });

  it("keeps quests that belong to no epic at all", async ({ expect }) => {
    // Trap 1: `epicId NOT IN (1)` is SQL NULL when epicId IS NULL, and a
    // NULL predicate excludes the row. Without the isNull branch this hides
    // the ENTIRE backlog.
    const alepha = Alepha.create({
      // Pinned, like every other lore spec: the ROOT vitest config — the one
      // CI runs — sets DATABASE_URL to a Postgres URL, which this app's
      // SQLite provider rejects outright. A bare `Alepha.create()` passes
      // under `yarn w lore test` and fails under `yarn test`.
      env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
    });
    const app = alepha.inject(TestApp);
    await alepha.start();

    const project = await createTestProject(alepha);
    const planned = await createTestEpic(alepha, project, {
      status: "planned",
    });
    const loose = await createTestQuest(alepha, project); // epicId undefined
    await createTestQuest(alepha, project, { epicId: planned.id });

    const visible = await app.listVisibleQuests(project.id);

    expect(visible.map((q) => q.id)).toEqual([loose.id]);
  });

  it("shows quests of an active epic and hides those of a planned one", async ({
    expect,
  }) => {
    const alepha = Alepha.create({
      // Pinned, like every other lore spec: the ROOT vitest config — the one
      // CI runs — sets DATABASE_URL to a Postgres URL, which this app's
      // SQLite provider rejects outright. A bare `Alepha.create()` passes
      // under `yarn w lore test` and fails under `yarn test`.
      env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
    });
    const app = alepha.inject(TestApp);
    await alepha.start();

    const project = await createTestProject(alepha);
    const active = await createTestEpic(alepha, project, { status: "active" });
    const planned = await createTestEpic(alepha, project, {
      status: "planned",
    });
    const shown = await createTestQuest(alepha, project, {
      epicId: active.id,
    });
    await createTestQuest(alepha, project, { epicId: planned.id });

    const visible = await app.listVisibleQuests(project.id);

    expect(visible.map((q) => q.id)).toEqual([shown.id]);
  });

  it("does not leak quests across projects when the gate is applied", async ({
    expect,
  }) => {
    // The gate adds a top-level `or`. QueryManager ANDs it with its sibling
    // keys, but this asserts it rather than trusting it — an `or` that
    // replaced its siblings would return every project's quests.
    const alepha = Alepha.create({
      // Pinned, like every other lore spec: the ROOT vitest config — the one
      // CI runs — sets DATABASE_URL to a Postgres URL, which this app's
      // SQLite provider rejects outright. A bare `Alepha.create()` passes
      // under `yarn w lore test` and fails under `yarn test`.
      env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
    });
    const app = alepha.inject(TestApp);
    await alepha.start();

    const mine = await createTestProject(alepha);
    const other = await createTestProject(alepha);
    await createTestEpic(alepha, mine, { status: "planned" });
    const ours = await createTestQuest(alepha, mine);
    await createTestQuest(alepha, other);

    const visible = await app.listVisibleQuests(mine.id);

    expect(visible.map((q) => q.id)).toEqual([ours.id]);
  });

  it("scopes the planned set to the project", async ({ expect }) => {
    // `plannedEpicIds` feeds a `notInArray` that is NOT project-scoped on
    // its own, so a leak here would hide another project's quests by id.
    const alepha = Alepha.create({
      // Pinned, like every other lore spec: the ROOT vitest config — the one
      // CI runs — sets DATABASE_URL to a Postgres URL, which this app's
      // SQLite provider rejects outright. A bare `Alepha.create()` passes
      // under `yarn w lore test` and fails under `yarn test`.
      env: { LOG_LEVEL: "error", DATABASE_URL: ":memory:" },
    });
    const app = alepha.inject(TestApp);
    await alepha.start();

    const mine = await createTestProject(alepha);
    const other = await createTestProject(alepha);
    const minePlanned = await createTestEpic(alepha, mine, {
      status: "planned",
    });
    await createTestEpic(alepha, other, { status: "planned" });

    expect(await app.epicVisibility.plannedEpicIds(mine.id)).toEqual([
      minePlanned.id,
    ]);
  });
});
