import { Alepha, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, DbEntityNotFoundError } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, expect, it } from "vitest";

import {
  $job,
  AlephaApiJobs,
  JobProvider,
  type JobClaimFence,
  jobExecutionEntity,
} from "../index.ts";

/**
 * A run that lost its lease (a frozen process, a GC pause, a partition) keeps
 * going while the sweep re-dispatches its row and a newer attempt runs. Every
 * write the stale run makes afterwards is fenced on the claim it holds,
 * `attempt` and `startedAt` together, so it changes nothing on the newer one.
 */
class TestJobProvider extends JobProvider {
  public testClaim = (id: string) => this.claim(id);
  public testGuardedUpdate = this.guardedUpdate.bind(this);
  public testRenewLease = this.renewLease.bind(this);
  public testDeleteRunning = (id: string, fence: JobClaimFence) =>
    this.executions.deleteMany({
      id: { eq: id },
      status: { eq: "running" },
      ...this.fenceWhere(fence),
    });
  public testHandleFailure = (
    id: string,
    name: string,
    attempt: number,
    fence: JobClaimFence,
  ) =>
    this.handleFailure(
      id,
      this.jobs.get(name)!,
      attempt,
      new Error("late failure"),
      undefined,
      fence,
    );
}

class App {
  executions = $repository(jobExecutionEntity);
  work = $job({
    name: "fencing-app.work",
    description: "A job under test.",
    schema: z.object({ v: z.integer() }),
    retry: { retries: 3 },
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

  const claim = async (id: string): Promise<JobClaimFence> => {
    // Two claims of one row never share a millisecond in real life: the
    // second needs the first lease to have expired.
    await clock.travel([1, "second"]);
    const row = await jobs.testClaim(id);
    expect(row).toBeTruthy();
    return { attempt: row!.attempt, startedAt: row!.startedAt };
  };

  /**
   * Attempt N claims the row, loses its lease, and the sweep hands the row to
   * attempt N+1, which claims it in turn.
   */
  const staleAndCurrent = async () => {
    const row = await app.executions.create({
      jobName: "fencing-app.work",
      status: "pending",
      payload: { v: 1 },
      maxAttempts: 4,
    });
    const stale = await claim(row.id);
    await app.executions.updateById(row.id, { status: "pending" });
    const current = await claim(row.id);
    return { id: row.id, stale, current };
  };

  const read = (id: string) => app.executions.findById(id);

  return { app, jobs, clock, claim, staleAndCurrent, read };
};

describe("$job: a stale attempt cannot touch a newer one", () => {
  it("does not let a stale attempt that finishes late finalize or delete the newer attempt", async () => {
    const { jobs, staleAndCurrent, read } = await boot();
    const { id, stale, current } = await staleAndCurrent();
    expect(current.attempt).toBe(stale.attempt + 1);

    const wrote = await jobs.testGuardedUpdate(
      id,
      ["running"],
      { status: "ok" },
      "success",
      stale,
    );
    const deleted = await jobs.testDeleteRunning(id, stale);
    await jobs.testHandleFailure(id, "fencing-app.work", stale.attempt, stale);

    expect(wrote).toBe(false);
    expect(deleted).toHaveLength(0);
    const row = await read(id);
    expect(row?.status).toBe("running");
    expect(row?.attempt).toBe(current.attempt);
    expect(row?.error ?? null).toBeNull();

    // The attempt that holds the claim still finishes normally.
    expect(
      await jobs.testGuardedUpdate(
        id,
        ["running"],
        { status: "ok" },
        "success",
        current,
      ),
    ).toBe(true);
    expect((await read(id))?.status).toBe("ok");
  });

  it("does not let a stale heartbeat extend the newer attempt's lease", async () => {
    const { jobs, clock, staleAndCurrent, read } = await boot();
    const { id, stale, current } = await staleAndCurrent();
    const before = (await read(id))?.updatedAt;

    await clock.travel([1, "minute"]);
    await expect(jobs.testRenewLease(id, stale)).rejects.toThrow(
      DbEntityNotFoundError,
    );
    expect((await read(id))?.updatedAt).toBe(before);

    await jobs.testRenewLease(id, current);
    expect((await read(id))?.updatedAt).not.toBe(before);
  });

  it("does not let an attempt from before a reschedule finalize the rescheduled attempt with the same number", async () => {
    const { app, jobs, clock, claim, read } = await boot();
    const row = await app.executions.create({
      jobName: "fencing-app.work",
      status: "pending",
      payload: { v: 1 },
      maxAttempts: 4,
    });
    const beforeReschedule = await claim(row.id);

    // What `reschedule()` writes: the next stage, attempt back to 0.
    await app.executions.updateById(row.id, {
      status: "scheduled",
      scheduledAt: clock.nowISOString(),
      attempt: 0,
    });
    const afterReschedule = await claim(row.id);
    expect(afterReschedule.attempt).toBe(beforeReschedule.attempt);

    const wrote = await jobs.testGuardedUpdate(
      row.id,
      ["running"],
      { status: "ok" },
      "success",
      beforeReschedule,
    );

    expect(wrote).toBe(false);
    expect((await read(row.id))?.status).toBe("running");
  });
});
