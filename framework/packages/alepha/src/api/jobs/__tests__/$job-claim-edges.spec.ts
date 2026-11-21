import { $hook, Alepha, AlephaError, z } from "alepha";
import { $repository } from "alepha/orm";
import { describe, it } from "vitest";

import {
  $job,
  AlephaApiJobs,
  JobProvider,
  jobExecutionEntity,
} from "../index.ts";

/**
 * What a run does at the edges of its claim: a listener that throws before
 * the handler, a write that misses because the row moved, an execution
 * handed over once stop began, a sweep acting on a stale read.
 *
 * Every case drives `processExecution` (or the sweep action) directly, so
 * nothing waits on a background worker.
 */
class TestJobProvider extends JobProvider {
  public testPromoteDue = this.promoteDue.bind(this);
  public get heldControllers(): number {
    return this.abortControllers.size;
  }
  public beginStop(): void {
    this.stopping = true;
  }
  // The dispatcher runs nothing here: each test starts its runs itself.
  protected override async dispatch(): Promise<void> {}
}

const payloadSchema = z.object({ v: z.integer() });

const boot = async <T extends object>(App: new () => T) => {
  const alepha = Alepha.create({
    env: { DATABASE_URL: "sqlite://:memory:" },
  })
    .with({ provide: JobProvider, use: TestJobProvider })
    .with(AlephaApiJobs);
  const app = alepha.inject(App);
  await alepha.start();
  return { alepha, app, jobs: alepha.inject(JobProvider) as TestJobProvider };
};

describe("$job: the edges of a claim", () => {
  it("fails the run, and releases it, when a job:begin listener throws", async ({
    expect,
  }) => {
    let handled = 0;
    class App {
      executions = $repository(jobExecutionEntity);
      refuse = $hook({
        on: "job:begin",
        handler: ({ name }) => {
          if (name === "claim-edges.begin") {
            throw new AlephaError("listener down");
          }
        },
      });
      work = $job({
        name: "claim-edges.begin",
        description: "A job under test.",
        schema: payloadSchema,
        retry: { retries: 2 },
        handler: async () => {
          handled++;
        },
      });
    }
    const { alepha, app, jobs } = await boot(App);
    const id = await app.work.push({ v: 1 });

    await jobs.processExecution("claim-edges.begin", id).catch(() => {});

    const row = await app.executions.findById(id);
    expect(handled).toBe(0);
    // A failed attempt with retries left, not a `running` row nobody holds.
    expect(row?.status).toBe("scheduled");
    expect(row?.error).toContain("listener down");
    expect(jobs.heldControllers).toBe(0);
    await alepha.stop();
  });

  it("releases an inline cron tick whose job:begin listener throws", async ({
    expect,
  }) => {
    class App {
      executions = $repository(jobExecutionEntity);
      refuse = $hook({
        on: "job:begin",
        handler: ({ name }) => {
          if (name === "claim-edges.tick") {
            throw new AlephaError("listener down");
          }
        },
      });
      tick = $job({
        name: "claim-edges.tick",
        description: "A cron under test.",
        cron: "0 0 1 1 *",
        handler: async () => {},
      });
    }
    const { alepha, app, jobs } = await boot(App);

    await app.tick.trigger().catch(() => {});

    expect(jobs.heldControllers).toBe(0);
    const rows = await app.executions.findMany({
      where: { jobName: { eq: "claim-edges.tick" } },
    });
    expect(rows.map((row) => row.status)).toEqual(["error"]);
    await alepha.stop();
  });

  it("emits no job:success for a run whose row was cancelled elsewhere", async ({
    expect,
  }) => {
    const events: string[] = [];
    class App {
      executions = $repository(jobExecutionEntity);
      onSuccess = $hook({
        on: "job:success",
        handler: ({ name }) => {
          if (name === "claim-edges.cancelled") events.push("success");
        },
      });
      work = $job({
        name: "claim-edges.cancelled",
        description: "A job under test.",
        schema: payloadSchema,
        retention: { ok: { last: 10 } },
        handler: async ({ executionId }) => {
          // What `cancel()` on another instance does: the row is cancelled,
          // and this process holds no controller to abort.
          await this.executions.updateById(executionId, {
            status: "cancelled",
          });
        },
      });
    }
    const { alepha, app, jobs } = await boot(App);
    const id = await app.work.push({ v: 1 });

    await jobs.processExecution("claim-edges.cancelled", id);

    expect((await app.executions.findById(id))?.status).toBe("cancelled");
    expect(events).toEqual([]);
    await alepha.stop();
  });

  it("still emits job:success for a run that kept its row", async ({
    expect,
  }) => {
    const events: string[] = [];
    class App {
      executions = $repository(jobExecutionEntity);
      onSuccess = $hook({
        on: "job:success",
        handler: ({ name }) => {
          events.push(name);
        },
      });
      recorded = $job({
        name: "claim-edges.recorded",
        description: "A job that records its successes.",
        schema: payloadSchema,
        retention: { ok: { last: 10 } },
        handler: async () => {},
      });
      unrecorded = $job({
        name: "claim-edges.unrecorded",
        description: "A job that records no success.",
        schema: payloadSchema,
        retention: { ok: false },
        handler: async () => {},
      });
    }
    const { alepha, app, jobs } = await boot(App);
    const kept = await app.recorded.push({ v: 1 });
    const dropped = await app.unrecorded.push({ v: 2 });

    await jobs.processExecution("claim-edges.recorded", kept);
    await jobs.processExecution("claim-edges.unrecorded", dropped);

    expect(events).toEqual(["claim-edges.recorded", "claim-edges.unrecorded"]);
    expect((await app.executions.findById(kept))?.status).toBe("ok");
    expect(await app.executions.findById(dropped)).toBeUndefined();
    await alepha.stop();
  });

  it("still runs an execution handed to it once stop began (a queue message popped during the drain)", async ({
    expect,
  }) => {
    let handled = 0;
    class App {
      executions = $repository(jobExecutionEntity);
      work = $job({
        name: "claim-edges.stopping",
        description: "A job under test.",
        schema: payloadSchema,
        retention: { ok: { last: 10 } },
        handler: async () => {
          handled++;
        },
      });
    }
    const { alepha, app, jobs } = await boot(App);
    const id = await app.work.push({ v: 1 });

    // The queue consumer acks a message once `processExecution` returns: a
    // return without a run would swallow it, and on a shared queue a
    // stopping replica would swallow the backlog of the others.
    jobs.beginStop();
    await jobs.processExecution("claim-edges.stopping", id);

    expect(handled).toBe(1);
    expect((await app.executions.findById(id))?.status).toBe("ok");
    await alepha.stop();
  });

  it("does not promote a row the sweep read as due and that is no longer", async ({
    expect,
  }) => {
    class App {
      executions = $repository(jobExecutionEntity);
      work = $job({
        name: "claim-edges.promote",
        description: "A job under test.",
        schema: payloadSchema,
        handler: async () => {},
      });
    }
    const { alepha, app, jobs } = await boot(App);
    // The sweep read this row when it was due; it has since run and parked
    // itself an hour ahead (a retry backoff, a reschedule, a sleep).
    const id = await app.work.push({ v: 1 }, { delay: [1, "hour"] });

    await jobs.testPromoteDue({ id, jobName: "claim-edges.promote" });

    expect((await app.executions.findById(id))?.status).toBe("scheduled");
    await alepha.stop();
  });

  it("returns pushMany ids in the order of its items, keyed or not", async ({
    expect,
  }) => {
    class App {
      executions = $repository(jobExecutionEntity);
      work = $job({
        name: "claim-edges.order",
        description: "A job under test.",
        schema: payloadSchema,
        handler: async () => {},
      });
    }
    const { alepha, app } = await boot(App);

    const ids = await app.work.pushMany([
      { payload: { v: 0 } },
      { payload: { v: 1 }, key: "one" },
      { payload: { v: 2 } },
      { payload: { v: 3 }, key: "three" },
    ]);

    const values: unknown[] = [];
    for (const id of ids) {
      values.push((await app.executions.findById(id))?.payload?.v);
    }
    expect(values).toEqual([0, 1, 2, 3]);
    await alepha.stop();
  });
});
