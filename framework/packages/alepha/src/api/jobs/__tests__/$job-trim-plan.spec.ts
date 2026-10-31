import type { DatabaseSync } from "node:sqlite";

import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, DatabaseProvider } from "alepha/orm";
import { describe, it, vi } from "vitest";

import {
  $job,
  AlephaApiJobs,
  JobProvider,
  jobExecutionEntity,
} from "../index.ts";

class TestJobProvider extends JobProvider {
  public testTrimRingBuffers = this.trimRingBuffers.bind(this);
}

class TestRepo {
  executions = $repository(jobExecutionEntity);
}

class DailyApp {
  tick = $job({
    name: "daily-app.tick",
    description: "A job under test.",
    cron: "0 3 * * *",
    handler: async () => {},
  });
}

/**
 * The trim's plan on SQLite, the engine of D1 (#Q3019). A read that sorts has
 * to fetch every row of the job and status first, which on a busy job passed
 * D1's 5 s timeout on every tick.
 */
describe("$job retention: the trim's query plan", () => {
  it("reads the newest rows through an index, with no sort", async ({
    expect,
  }) => {
    const alepha = Alepha.create({
      env: { DATABASE_URL: "sqlite://:memory:" },
    })
      .with({ provide: JobProvider, use: TestJobProvider })
      .with(AlephaApiJobs)
      .with(TestRepo);
    alepha.inject(DailyApp);
    alepha.inject(DateTimeProvider).pause();
    await alepha.start();

    const now = alepha.inject(DateTimeProvider).now();
    for (let i = 0; i < 40; i++) {
      const at = now.subtract(i * 24, "hour").toISOString();
      await alepha.inject(TestRepo).executions.create({
        jobName: "daily-app.tick",
        status: "ok",
        maxAttempts: 1,
        createdAt: at,
        updatedAt: at,
        completedAt: at,
      });
    }

    // The statements the driver prepares, to explain the real ones.
    const { sqlite } = alepha.inject(DatabaseProvider) as unknown as {
      sqlite: DatabaseSync;
    };
    const prepare = vi.spyOn(sqlite, "prepare");
    await (alepha.inject(JobProvider) as TestJobProvider).testTrimRingBuffers();

    const reads = prepare.mock.calls
      .map(([statement]) => statement)
      .filter((statement) => /order by/i.test(statement));
    expect(reads.length).toBeGreaterThan(0);
    prepare.mockRestore();

    for (const read of reads) {
      const plan = sqlite
        .prepare(`EXPLAIN QUERY PLAN ${read}`)
        .all()
        .map((step) => String(step.detail));
      expect(plan.join("\n")).toMatch(/USING (COVERING )?INDEX/);
      expect(plan.join("\n")).not.toMatch(/TEMP B-TREE/);
    }
  });
});
