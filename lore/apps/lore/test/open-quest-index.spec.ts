import { Alepha, z } from "alepha";
import { AdminUserController, AlephaApiUsers } from "alepha/api/users";
import { AlephaEmail } from "alepha/email";
import {
  LogDestinationProvider,
  MemoryDestinationProvider,
} from "alepha/logger";
import { AlephaOrm, DatabaseProvider, sql } from "alepha/orm";
import { AlephaSecurity } from "alepha/security";
import { AlephaServer } from "alepha/server";
import { AlephaFake, FakeProvider } from "alepha/testing/faker";
import { describe, it } from "vitest";

import { ProjectController } from "../src/api/controllers/ProjectController.ts";
import { QuestController } from "../src/api/controllers/QuestController.ts";
import { LoreApi } from "../src/api/index.ts";
import { OpenQuestScope } from "../src/api/services/OpenQuestScope.ts";

/**
 * That `quests_open_idx` is the index the open-quest count actually uses.
 *
 * An unused partial index announces nothing: it is dead weight that costs an
 * index write per open quest and answers no query, and nothing in the schema,
 * the types or the migration snapshot can tell it apart from a working one.
 * The first shape of this index - `(project_id, epic_id)` with the three null
 * columns in its `WHERE` alone - was exactly that. `EXPLAIN QUERY PLAN` chose
 * `quests_project_id_deleted_at_idx` over it every time, because that index
 * binds two equality constraints and a bare `(project_id, epic_id)` binds
 * one. See the index's own comment on `quests` for the fix.
 *
 * ## Why the plan is read off the driver's own statement
 *
 * The statement is taken from the SQL trace log rather than written out here.
 * A hand-written copy is a second spelling of the query, and the thing under
 * test is precisely whether SQLite can prove THIS query's `WHERE` implies the
 * index's - so a copy that drifts by one parenthesis tests nothing and still
 * passes.
 *
 * ## Both shapes
 *
 * The backlog gate contributes an `epic_id IS NULL OR epic_id NOT IN (...)`
 * term only when the project set has a draft epic in it, so the count has two
 * real shapes in production and each is asserted.
 */
describe("The open-quest count's index", () => {
  it("is served by the covering partial index, gated and ungated", async ({
    expect,
  }) => {
    const alepha = Alepha.create({
      env: { LOG_LEVEL: "trace", SERVER_PORT: 0, DATABASE_URL: ":memory:" },
    }).with({
      provide: LogDestinationProvider,
      use: MemoryDestinationProvider,
    });
    alepha.with(AlephaOrm);
    alepha.with(AlephaServer);
    alepha.with(AlephaSecurity);
    alepha.with(AlephaEmail);
    alepha.with(AlephaApiUsers);
    alepha.with(AlephaFake);
    alepha.with(LoreApi);
    await alepha.start();

    const logs = alepha.inject(MemoryDestinationProvider);
    const admins = alepha.inject(AdminUserController);
    const projectApi = alepha.inject(ProjectController);
    const questApi = alepha.inject(QuestController);
    const database = alepha.inject(DatabaseProvider);
    const fake = alepha.inject(FakeProvider);
    const scope = alepha.inject(OpenQuestScope);

    const created = await admins.createUser.fetch(
      {
        body: {
          ...fake.generate(
            z.object({ username: z.string(), email: z.email() }),
          ),
          roles: ["user"],
        },
      },
      { user: { id: crypto.randomUUID(), roles: ["admin"] } },
    );
    const user = { id: created.data.id, roles: created.data.roles };

    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      // Letters, not numbers: a title that slugs to `project-0` is reserved.
      const project = await projectApi.createProject.fetch(
        { body: { title: `Garden ${String.fromCharCode(97 + i)}` } },
        { user } as never,
      );
      ids.push(project.data.id);
      for (let q = 0; q < 5; q++) {
        await questApi.createQuest.fetch(
          {
            body: {
              projectId: project.data.id,
              title: `Quest ${q}`,
              area: "general",
              priority: "medium",
            },
          },
          { user } as never,
        );
      }
    }

    // A draft epic in the FIRST project only, so the two counts below are the
    // gated shape and the ungated one. Written as raw SQL rather than through
    // `createEpic`, which gates on the Work capability's `epics` option: what
    // this spec needs is the row, not the write path.
    await database.run(
      sql.raw(
        `INSERT INTO epics (project_id, number, title, description, status, created_at, updated_at)
         VALUES (${ids[0]}, 1, 'Draft epic', 'x', 'draft', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      ),
      z.object({}),
    );

    const questStatements = async (call: () => Promise<unknown>) => {
      const before = logs.logs.length;
      await call();
      return logs.logs
        .slice(before)
        .filter(
          (entry) =>
            entry.level === "TRACE" &&
            /^\s*select/i.test(String(entry.message)) &&
            String(entry.message).includes('from "quests"'),
        )
        .map((entry) => String(entry.message));
    };

    const gated = await questStatements(() => scope.countByProject(ids));
    const ungated = await questStatements(() =>
      scope.countByProject([ids[1], ids[2]]),
    );

    expect(gated).toHaveLength(1);
    expect(ungated).toHaveLength(1);
    // The gate is only in the first one, which is what makes them two shapes.
    expect(gated[0]).toContain("epic_id");
    expect(ungated[0]).not.toContain("epic_id");

    for (const statement of [gated[0], ungated[0]]) {
      // The placeholders stand for project ids and epic ids, so any integer
      // reads the same to the planner: it binds constraints, not values.
      const plan = await database.run(
        sql.raw(`EXPLAIN QUERY PLAN ${statement.replace(/\?/g, "1")}`),
        z.object({ detail: z.string() }),
      );
      const detail = plan.map((row) => row.detail).join("\n");
      expect(detail).toContain("quests_open_idx");
      // Covering: neither the gate nor the count reaches the table.
      expect(detail).toContain("COVERING INDEX");
    }

    await alepha.stop();
  }, 120_000);
});
