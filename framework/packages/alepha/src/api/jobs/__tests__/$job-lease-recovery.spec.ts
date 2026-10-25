import { Alepha, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, expect, it } from "vitest";

import {
  $job,
  AlephaApiJobs,
  JobProvider,
  jobExecutionEntity,
} from "../index.ts";

/**
 * A run whose instance died: its lease (the fresher of `startedAt` and the
 * heartbeat's `updatedAt`) expires, and the sweep takes the row back. With
 * retries left it is scheduled again, after a backoff; at its last attempt it
 * ends in `error`. Never a third state, and never past `maxAttempts`.
 */
class TestJobProvider extends JobProvider {
  public testSweep = this.sweep.bind(this);
  public testRetryBackoffMs = (attempt: number) => this.retryBackoffMs(attempt);
  protected override randomFraction(): number {
    // No jitter: the backoff is its ceiling, so it can be asserted.
    return 1;
  }
}

class App {
  executions = $repository(jobExecutionEntity);
  work = $job({
    name: "lease-recovery.work",
    description: "A job under test.",
    schema: z.object({ v: z.integer() }),
    retry: { retries: 2 },
    handler: async () => {},
  });
}

const boot = async () => {
  const alepha = Alepha.create()
    .with({ provide: JobProvider, use: TestJobProvider })
    .with(AlephaOrmPostgres)
    .with(AlephaApiJobs);
  const app = alepha.inject(App);
  await alepha.start();
  const jobs = alepha.inject(JobProvider) as TestJobProvider;
  const clock = alepha.inject(DateTimeProvider);

  /**
   * A row an instance claimed for `attempt` and then died holding.
   */
  const crashed = (attempt: number) =>
    app.executions.create({
      jobName: "lease-recovery.work",
      status: "running",
      payload: { v: 1 },
      attempt,
      maxAttempts: 3,
      startedAt: clock.nowISOString(),
    });

  return { app, jobs, clock, crashed };
};

describe("$job: a lost lease is recovered by the sweep", () => {
  it("leaves the row alone while its lease is fresh", async () => {
    const { app, jobs, crashed } = await boot();
    const row = await crashed(1);

    await jobs.testSweep();

    expect((await app.executions.findById(row.id))?.status).toBe("running");
  });

  it("schedules a retry after the backoff when attempts are left", async () => {
    const { app, jobs, clock, crashed } = await boot();
    const row = await crashed(1);

    await clock.travel([2, "hours"]);
    const sweptAt = clock.now().valueOf();
    await jobs.testSweep();

    const after = await app.executions.findById(row.id);
    expect(after?.status).toBe("scheduled");
    expect(after?.error).toContain("Execution assumed crashed");
    // Attempt 1 failed, so the wait is the first step of the curve.
    const due = new Date(after!.scheduledAt!).valueOf();
    expect(due - sweptAt).toBeGreaterThanOrEqual(jobs.testRetryBackoffMs(1));
  });

  it("grows the backoff with each attempt, up to its cap", async () => {
    const { jobs } = await boot();
    const first = jobs.testRetryBackoffMs(1);
    const second = jobs.testRetryBackoffMs(2);
    const third = jobs.testRetryBackoffMs(3);
    const capped = jobs.testRetryBackoffMs(40);

    expect(second).toBe(first * 2);
    expect(third).toBe(first * 4);
    expect(Number.isFinite(capped)).toBe(true);
    expect(capped).toBeGreaterThanOrEqual(third);
  });

  it("ends in error, with no further retry, when the last attempt is lost", async () => {
    const { app, jobs, clock, crashed } = await boot();
    // retries: 2 is three attempts in all; this one was the third.
    const row = await crashed(3);

    await clock.travel([2, "hours"]);
    await jobs.testSweep();

    const after = await app.executions.findById(row.id);
    expect(after?.status).toBe("error");
    expect(after?.attempt).toBe(3);
    expect(after?.error).toContain("Execution assumed crashed");
  });
});
