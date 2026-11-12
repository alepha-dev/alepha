import { Alepha } from "alepha";
import { $repository, AlephaOrmTestPostgres } from "alepha/orm";
import { describe, it } from "vitest";

import { AlephaApiJobs, jobExecutionEntity } from "../index.ts";

/**
 * The `steps` column on Postgres, which has no migration folder in the
 * repository: the column reaches it through the schema sync the specs boot
 * with, and this proves the JSON round-trips there. The SQLite apps get it
 * from an `ALTER TABLE ... ADD COLUMN` migration each.
 */
describe("job_executions.steps", () => {
  it("stores a steps record and reads it back, and stays null otherwise", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with(AlephaOrmTestPostgres)
      .with(AlephaApiJobs);
    class App {
      executions = $repository(jobExecutionEntity);
    }
    const app = alepha.inject(App);
    await alepha.start();

    const steps = {
      capture: {
        at: "2026-11-11T09:00:00.000Z",
        ms: 12,
        result: { id: "ch_1", amount: 4200, tags: ["a", null], ok: true },
      },
      "cool-off": {
        at: "2026-11-11T09:00:01.000Z",
        ms: 0,
        until: "2026-11-11T10:00:01.000Z",
      },
    };
    const row = await app.executions.create({
      jobName: "steps.column",
      status: "scheduled",
      steps,
    });
    const read = await app.executions.findById(row.id);
    expect(read?.steps).toEqual(steps);

    const plain = await app.executions.create({ jobName: "steps.column" });
    expect((await app.executions.findById(plain.id))?.steps ?? null).toBe(null);

    await app.executions.updateById(row.id, { steps: null });
    expect((await app.executions.findById(row.id))?.steps ?? null).toBe(null);

    await alepha.stop();
  });
});
