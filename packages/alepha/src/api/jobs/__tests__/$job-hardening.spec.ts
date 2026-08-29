import { Alepha, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, DbEntityNotFoundError, DbError } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import {
  MemoryQueueProvider,
  QueueDelayNotSupportedError,
  QueueProvider,
  type QueuePushOptions,
} from "alepha/queue";
import { describe, it } from "vitest";

import {
  $job,
  AlephaApiJobs,
  AlephaApiJobsQueue,
  DirectJobDispatcher,
  JobProvider,
  type SweepEntry,
  jobConfig,
  jobExecutionEntity,
} from "../index.ts";

class TestJobProvider extends JobProvider {
  public testDispatchScheduled = this.dispatchScheduled.bind(this);
  public testCreateKeyedExecution = this.createKeyedExecution.bind(this);
  public testSweep = this.sweep.bind(this);
  public testPromoteDue = this.promoteDue.bind(this);
  public testShouldStopHeartbeat = this.shouldStopHeartbeat.bind(this);
  public testRetryBackoffMs = (attempt: number) => this.retryBackoffMs(attempt);
  public testProcessExecution = (jobName: string, executionId: string) =>
    this.processExecution(jobName, executionId);
  public testTrimRingBuffers = this.trimRingBuffers.bind(this);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Poll `fn` until `predicate` returns true, or throw on timeout — fixed
 * sleeps race the in-memory queue under CI load and produce flaky failures.
 */
async function waitFor<T>(
  fn: () => Promise<T> | T,
  predicate: (v: T) => boolean,
  { timeout = 2000, interval = 10, label = "condition" } = {},
): Promise<T> {
  const deadline = Date.now() + timeout;
  let last: T = await fn();
  while (Date.now() < deadline) {
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, interval));
    last = await fn();
  }
  if (predicate(last)) return last;
  throw new Error(
    `waitFor: ${label} not met within ${timeout}ms; last value: ${JSON.stringify(last)}`,
  );
}

describe("$job — long-delay hardening", () => {
  it("keeps a row scheduled when the delay exceeds the optimistic-timer range", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with(AlephaOrmPostgres)
      .with(AlephaApiJobs)
      .with(AlephaApiJobsQueue);
    let calls = 0;
    class LongDelayApp {
      executions = $repository(jobExecutionEntity);
      work = $job({
        schema: z.object({ v: z.integer() }),
        handler: async () => {
          calls++;
        },
      });
    }
    const app = alepha.inject(LongDelayApp);
    await alepha.start();

    // 30 days is past setTimeout's 32-bit range (~24.85 days): an unclamped
    // timer overflows and fires within milliseconds, running the job now.
    const id = await app.work.push({ v: 1 }, { delay: [30, "day"] });
    await sleep(200);

    const rows = await app.executions.findMany({ where: { id: { eq: id } } });
    expect(calls).toBe(0);
    expect(rows[0].status).toBe("scheduled");
  });

  it("dispatchScheduled refuses to promote a row scheduled in the future", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with({ provide: JobProvider, use: TestJobProvider })
      .with(AlephaOrmPostgres)
      .with(AlephaApiJobs)
      .with(AlephaApiJobsQueue);
    let calls = 0;
    class EarlyDispatchApp {
      executions = $repository(jobExecutionEntity);
      work = $job({
        schema: z.object({ v: z.integer() }),
        handler: async () => {
          calls++;
        },
      });
    }
    const app = alepha.inject(EarlyDispatchApp);
    await alepha.start();

    const id = await app.work.push({ v: 1 }, { delay: [1, "hour"] });
    const jobs = alepha.inject(JobProvider) as TestJobProvider;
    // A stray early timer (clock skew, timer overflow) must not run the job
    // an hour ahead of schedule.
    await jobs.testDispatchScheduled("EarlyDispatchApp.work", id);
    await sleep(100);

    const rows = await app.executions.findMany({ where: { id: { eq: id } } });
    expect(calls).toBe(0);
    expect(rows[0].status).toBe("scheduled");
  });
});

describe("$job — sweep guards", () => {
  it("sweep promote does not resurrect a cancelled execution", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with({ provide: JobProvider, use: TestJobProvider })
      .with(AlephaOrmPostgres)
      .with(AlephaApiJobs)
      .with(AlephaApiJobsQueue);
    let calls = 0;
    class SweepGuardApp {
      executions = $repository(jobExecutionEntity);
      work = $job({
        schema: z.object({ v: z.integer() }),
        handler: async () => {
          calls++;
        },
      });
    }
    const app = alepha.inject(SweepGuardApp);
    await alepha.start();

    const id = await app.work.push({ v: 1 }, { delay: [1, "hour"] });
    const jobs = alepha.inject(JobProvider) as TestJobProvider;

    // The sweep read this row while it was still "scheduled"...
    const snapshot = (
      await app.executions.findMany({ where: { id: { eq: id } } })
    )[0];

    // ...then a user cancelled it before the sweep wrote.
    await app.work.cancel(id);

    await jobs.testPromoteDue(snapshot);
    await sleep(100);

    // The cancelled execution must not be promoted back to pending nor run.
    const rows = await app.executions.findMany({ where: { id: { eq: id } } });
    expect(rows[0].status).toBe("cancelled");
    expect(calls).toBe(0);
  });
});

describe("$job — lease heartbeat", () => {
  it("keeps renewing through a transient DB error", async ({ expect }) => {
    const alepha = Alepha.create()
      .with({ provide: JobProvider, use: TestJobProvider })
      .with(AlephaOrmPostgres)
      .with(AlephaApiJobs)
      .with(AlephaApiJobsQueue);
    await alepha.start();
    const jobs = alepha.inject(JobProvider) as TestJobProvider;

    // A transient failure must not stop the heartbeat: the handler is still
    // running, so a stopped lease lets another instance's sweep declare it
    // crashed and re-dispatch it — duplicate concurrent execution.
    expect(jobs.testShouldStopHeartbeat(new Error("ECONNRESET"))).toBe(false);
    expect(
      jobs.testShouldStopHeartbeat(new DbError("connection terminated")),
    ).toBe(false);

    // The row being gone or no longer `running` is the one case where there
    // is genuinely nothing left to renew.
    expect(
      jobs.testShouldStopHeartbeat(new DbEntityNotFoundError("job_executions")),
    ).toBe(true);
  });
});

describe("$job — retention", () => {
  it("keeps successful rows forever when the job declares keep.ok = 0", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with(AlephaOrmPostgres)
      .with(AlephaApiJobs)
      .with(AlephaApiJobsQueue);
    // Global "delete successes" — the setting under which the per-job
    // override was silently ignored.
    alepha.store.mut(jobConfig, (c) => ({ ...c, keepLastSuccess: 0 }));

    class AuditApp {
      executions = $repository(jobExecutionEntity);
      // Documented contract of `keep`: `{ ok: 0 }` means KEEP FOREVER (no
      // trim) — the opposite of global `keepLastSuccess: 0`, which means
      // "delete on success". The success path only consulted the global, so
      // audit rows were destroyed at completion.
      work = $job({
        schema: z.object({ v: z.integer() }),
        record: "all",
        keep: { ok: 0, error: 0 },
        handler: async () => {},
      });
    }

    const app = alepha.inject(AuditApp);
    await alepha.start();

    const id = await app.work.push({ v: 1 });

    const rows = await waitFor(
      () => app.executions.findMany({ where: { id: { eq: id } } }),
      (r) => r.length === 0 || r[0]?.status === "ok",
      { label: "execution settled" },
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("ok");
  });
});

describe("$job — key dedup under concurrency", () => {
  it("concurrent pushes with the same key all resolve to one execution", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with(AlephaOrmPostgres)
      .with(AlephaApiJobs)
      .with(AlephaApiJobsQueue);
    class ConcurrentKeyApp {
      executions = $repository(jobExecutionEntity);
      work = $job({
        schema: z.object({ v: z.integer() }),
        handler: async () => {},
      });
    }
    const app = alepha.inject(ConcurrentKeyApp);
    await alepha.start();

    // All pushes issue their dedup pre-check before any row exists; the
    // unique index on (jobName, key) must resolve the race, not throw.
    const ids = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        app.work.push({ v: i }, { key: "race-1", delay: [1, "hour"] }),
      ),
    );
    expect(new Set(ids).size).toBe(1);

    const rows = await app.executions.findMany({
      where: { jobName: { eq: "ConcurrentKeyApp.work" } },
    });
    expect(rows).toHaveLength(1);
  });

  it("returns the winner's id when the insert loses the (jobName, key) race", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with({ provide: JobProvider, use: TestJobProvider })
      .with(AlephaOrmPostgres)
      .with(AlephaApiJobs)
      .with(AlephaApiJobsQueue);
    class RaceLoserApp {
      executions = $repository(jobExecutionEntity);
    }
    const app = alepha.inject(RaceLoserApp);
    await alepha.start();

    // The winner's row lands after the loser's dedup pre-check saw nothing
    // — exactly the race window the unique index guards.
    const winner = await app.executions.create({
      jobName: "RaceLoserApp.work",
      key: "race-2",
      status: "scheduled",
      priority: 2,
      maxAttempts: 1,
    });

    const jobs = alepha.inject(JobProvider) as TestJobProvider;
    const result = await jobs.testCreateKeyedExecution({
      jobName: "RaceLoserApp.work",
      key: "race-2",
      status: "scheduled",
      priority: 2,
      maxAttempts: 1,
    });
    expect(result.created).toBe(false);
    expect(result.id).toBe(winner.id);
  });
});

describe("$job — lease renewal for long-running jobs", () => {
  const makeLeaseApp = () => {
    const alepha = Alepha.create()
      .with({ provide: JobProvider, use: TestJobProvider })
      .with(AlephaOrmPostgres)
      .with(AlephaApiJobs)
      .with(AlephaApiJobsQueue);
    class LeaseApp {
      executions = $repository(jobExecutionEntity);
      work = $job({
        schema: z.object({ v: z.integer() }),
        handler: async () => {},
      });
    }
    return { alepha, app: alepha.inject(LeaseApp) };
  };

  it("sweep leaves a running row alone while its lease is fresh", async ({
    expect,
  }) => {
    const { alepha, app } = makeLeaseApp();
    await alepha.start();

    // Simulates the other instance's view: the job started on instance A
    // hours ago (no local abort controller here on B), but A's heartbeat
    // keeps the row's updatedAt fresh — B's sweep must not re-dispatch it.
    const row = await app.executions.create({
      jobName: "LeaseApp.work",
      status: "running",
      priority: 2,
      attempt: 1,
      maxAttempts: 1,
      startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });

    const jobs = alepha.inject(JobProvider) as TestJobProvider;
    await jobs.testSweep();

    const rows = await app.executions.findMany({
      where: { id: { eq: row.id } },
    });
    expect(rows[0].status).toBe("running");
  });

  it("sweep still recovers a crashed row once the lease is stale", async ({
    expect,
  }) => {
    const { alepha, app } = makeLeaseApp();
    await alepha.start();

    const row = await app.executions.create({
      jobName: "LeaseApp.work",
      status: "running",
      priority: 2,
      attempt: 1,
      maxAttempts: 1,
      startedAt: new Date().toISOString(),
    });

    // Both startedAt and updatedAt now sit two hours in the sweep's past.
    const time = alepha.inject(DateTimeProvider);
    await time.travel([2, "hour"]);

    const jobs = alepha.inject(JobProvider) as TestJobProvider;
    await jobs.testSweep();

    const rows = await app.executions.findMany({
      where: { id: { eq: row.id } },
    });
    expect(rows[0].status).toBe("error");
  });

  it("renews the lease while the handler runs", async ({ expect }) => {
    const alepha = Alepha.create()
      .with(AlephaOrmPostgres)
      .with(AlephaApiJobs)
      .with(AlephaApiJobsQueue);
    class SlowApp {
      executions = $repository(jobExecutionEntity);
      // timeout 1s → crash threshold 2s → heartbeat ~666ms. The handler
      // outlives the first heartbeat tick (it ignores the abort signal).
      work = $job({
        schema: z.object({ v: z.integer() }),
        timeout: [1, "second"],
        handler: async () => {
          await sleep(1500);
        },
      });
    }
    const app = alepha.inject(SlowApp);
    await alepha.start();

    const id = await app.work.push({ v: 1 });
    const running = await waitFor(
      () => app.executions.findMany({ where: { id: { eq: id } } }),
      (r) => r.length === 1 && r[0].status === "running",
      { label: "row reaches status=running" },
    );
    const leaseAtClaim = running[0].updatedAt;

    const renewed = await waitFor(
      () => app.executions.findMany({ where: { id: { eq: id } } }),
      (r) =>
        r.length === 1 &&
        r[0].status === "running" &&
        r[0].updatedAt > leaseAtClaim,
      { label: "lease renewed while running", timeout: 1400 },
    );
    expect(renewed[0].updatedAt > leaseAtClaim).toBe(true);
  });
});

// ---------------------------------------------------------------------------

/**
 * Accepts every dispatch and does nothing with it, so a swept row keeps the
 * status the sweep left it in.
 */
class SilentJobDispatcher extends DirectJobDispatcher {
  public override async dispatch(): Promise<void> {}
}

/**
 * Records which sweep phase claimed which row, without changing what any
 * phase actually does.
 */
class SweepTableJobProvider extends JobProvider {
  public readonly claimed: Array<{ label: string; id: string }> = [];
  public testSweep = this.sweep.bind(this);

  protected override sweepTable(): SweepEntry[] {
    return super.sweepTable().map((entry) => ({
      ...entry,
      act: async (exec, registration) => {
        this.claimed.push({ label: entry.label, id: exec.id });
        await entry.act(exec, registration);
      },
    }));
  }
}

describe("$job — the sweep table", () => {
  it("claims each status at most once per tick, and never a terminal one", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with({ provide: JobProvider, use: SweepTableJobProvider })
      // Nothing may run behind the sweep's back. A real dispatcher takes the
      // row it was just handed out of `pending` within milliseconds, so a
      // later phase looking at `pending` would find nothing and the test
      // would pass whether or not the phases overlap.
      .with({ provide: DirectJobDispatcher, use: SilentJobDispatcher })
      .with(AlephaOrmPostgres)
      .with(AlephaApiJobs);

    class SweepTableApp {
      executions = $repository(jobExecutionEntity);
      work = $job({
        schema: z.object({ v: z.integer() }),
        handler: async () => {},
      });
    }
    const app = alepha.inject(SweepTableApp);
    await alepha.start();

    // Old enough for every threshold in the table at once. Anything left
    // unclaimed below is unclaimed because of its status, never its age.
    const longAgo = alepha
      .inject(DateTimeProvider)
      .now()
      .subtract(4, "hour")
      .toISOString();

    const statuses = [
      "pending",
      "running",
      "scheduled",
      "ok",
      "error",
      "cancelled",
    ] as const;

    const rows: Record<string, string> = {};
    for (const status of statuses) {
      const row = await app.executions.create({
        jobName: "SweepTableApp.work",
        status,
        priority: 2,
        attempt: 1,
        maxAttempts: 1,
        payload: { v: 1 },
        createdAt: longAgo,
        updatedAt: longAgo,
        scheduledAt: longAgo,
        startedAt: longAgo,
      });
      rows[status] = row.id;
    }

    const jobs = alepha.inject(JobProvider) as SweepTableJobProvider;
    await jobs.testSweep();

    const claimsFor = (id: string) =>
      jobs.claimed.filter((c) => c.id === id).map((c) => c.label);

    expect(claimsFor(rows.pending)).toEqual(["redispatch-stale"]);
    expect(claimsFor(rows.running)).toEqual(["recover-crashed"]);

    // The regression this table exists for: promote-due lifts the scheduled
    // row to `pending`, and redispatch-stale must NOT then claim the row it
    // has just touched. It used to, because it aged rows by `createdAt`.
    expect(claimsFor(rows.scheduled)).toEqual(["promote-due"]);

    // Terminal rows are owned by no entry at all.
    expect(claimsFor(rows.ok)).toEqual([]);
    expect(claimsFor(rows.error)).toEqual([]);
    expect(claimsFor(rows.cancelled)).toEqual([]);
  });
});

// -----------------------------------------------------------------------------------------------------------------

/**
 * Accepts every dispatch and delivers none of it.
 *
 * Models the one path that had no terminal state: a payload that kills the
 * isolate between the dispatch and `claim()`. `attempt` only moves inside
 * `claim()`, so nothing about the retry policy ever notices.
 */
class BlackHoleJobDispatcher extends DirectJobDispatcher {
  public dispatches = 0;

  public override async dispatch(): Promise<void> {
    this.dispatches++;
  }
}

describe("$job — the sweep is bounded", () => {
  it("drains a backlog larger than one batch across ticks, running each row once", async ({
    expect,
  }) => {
    const handled: number[] = [];

    const alepha = Alepha.create()
      .with({ provide: JobProvider, use: TestJobProvider })
      .with(AlephaOrmPostgres)
      .with(AlephaApiJobs);
    alepha.store.mut(jobConfig, (c) => ({ ...c, sweepBatchSize: 3 }));

    class BacklogApp {
      executions = $repository(jobExecutionEntity);
      work = $job({
        schema: z.object({ v: z.integer() }),
        handler: async ({ payload }) => {
          handled.push(payload.v);
        },
      });
    }

    const app = alepha.inject(BacklogApp);
    const jobs = alepha.inject(JobProvider) as TestJobProvider;
    await alepha.start();

    // Seven rows already due, written straight to the outbox: this is the
    // shape a crash or an outage leaves behind, and it bypasses the
    // optimistic timer so the sweep really is the only thing that can move
    // them.
    const past = new Date(Date.now() - 60_000).toISOString();
    for (let v = 0; v < 7; v++) {
      await app.executions.create({
        jobName: "BacklogApp.work",
        payload: { v },
        status: "scheduled",
        maxAttempts: 1,
        scheduledAt: past,
      });
    }

    const stillScheduled = async () =>
      (
        await app.executions.findMany({
          where: {
            jobName: { eq: "BacklogApp.work" },
            status: { eq: "scheduled" },
          },
        })
      ).length;

    // Each tick promotes exactly one batch. Asserted on the rows rather than
    // on the handler count, because the handlers run asynchronously and an
    // unbounded sweep would race past three before a poll could see it.
    await jobs.testSweep();
    expect(await stillScheduled()).toBe(4);
    await waitFor(
      () => handled.length,
      (n) => n === 3,
      { label: "first batch handled" },
    );

    await jobs.testSweep();
    expect(await stillScheduled()).toBe(1);
    await waitFor(
      () => handled.length,
      (n) => n === 6,
      { label: "second batch handled" },
    );

    await jobs.testSweep();
    expect(await stillScheduled()).toBe(0);
    await waitFor(
      () => handled.length,
      (n) => n === 7,
      { label: "third batch handled" },
    );

    // A fourth tick has nothing left, and above all must not re-run anything.
    await jobs.testSweep();
    await sleep(100);

    expect(handled.length).toBe(7);
    expect([...handled].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("gives up on a pending row nobody ever claims, instead of re-dispatching it forever", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with({ provide: JobProvider, use: TestJobProvider })
      .with({ provide: DirectJobDispatcher, use: BlackHoleJobDispatcher })
      .with(AlephaOrmPostgres)
      .with(AlephaApiJobs);
    alepha.store.mut(jobConfig, (c) => ({
      ...c,
      maxRedispatch: 2,
      // Every pending row is stale the moment it exists, so one sweep call
      // is one re-dispatch and the loop is countable.
      staleThreshold: 0,
    }));

    class LostApp {
      executions = $repository(jobExecutionEntity);
      work = $job({
        schema: z.object({ v: z.integer() }),
        // Never consulted: the row dies before `claim()`, so `attempt` stays
        // 0 and `maxAttempts` never binds. That is exactly why the
        // re-dispatch cap has to exist separately.
        retry: { retries: 5 },
        handler: async () => {},
      });
    }

    const app = alepha.inject(LostApp);
    const jobs = alepha.inject(JobProvider) as TestJobProvider;
    const dispatcher = alepha.inject(
      DirectJobDispatcher,
    ) as BlackHoleJobDispatcher;
    await alepha.start();

    const id = await app.work.push({ v: 1 });
    expect(dispatcher.dispatches).toBe(1);

    await jobs.testSweep();
    expect((await app.executions.findById(id))?.redispatchCount).toBe(1);
    expect(dispatcher.dispatches).toBe(2);

    await jobs.testSweep();
    expect((await app.executions.findById(id))?.redispatchCount).toBe(2);
    expect(dispatcher.dispatches).toBe(3);

    // Budget spent: the next tick ends the row instead of dispatching again.
    await jobs.testSweep();
    const dead = await app.executions.findById(id);
    expect(dead?.status).toBe("error");
    expect(dead?.error).toContain("Never claimed");
    expect(dead?.attempt).toBe(0);
    expect(dispatcher.dispatches).toBe(3);

    // And it stays ended: a terminal row is not the sweep's business.
    await jobs.testSweep();
    expect(dispatcher.dispatches).toBe(3);
    expect((await app.executions.findById(id))?.status).toBe("error");
  });
});

// -----------------------------------------------------------------------------------------------------------------

describe("$job — inline", () => {
  for (const queued of [false, true]) {
    const label = queued ? "with AlephaApiJobsQueue" : "in direct mode";

    it(`resolves only once the handler has finished, ${label}`, async ({
      expect,
    }) => {
      let ran = false;
      let finished = false;
      const alepha = Alepha.create()
        .with(AlephaOrmPostgres)
        .with(AlephaApiJobs);
      if (queued) alepha.with(AlephaApiJobsQueue);

      class App {
        executions = $repository(jobExecutionEntity);
        work = $job({
          schema: z.object({ v: z.integer() }),
          record: "all",
          keep: { ok: 0 },
          handler: async () => {
            ran = true;
            await sleep(30);
            finished = true;
          },
        });
      }

      const app = alepha.with(App).inject(App);
      await alepha.start();

      const id = await app.work.push({ v: 1 }, { inline: true });

      // Not "started". Finished.
      expect(ran).toBe(true);
      expect(finished).toBe(true);

      const row = await app.executions.findById(id);
      expect(row?.status).toBe("ok");
    });

    it(`rejects when the handler fails, and leaves a terminal row, ${label}`, async ({
      expect,
    }) => {
      const alepha = Alepha.create()
        .with({ provide: JobProvider, use: TestJobProvider })
        .with(AlephaOrmPostgres)
        .with(AlephaApiJobs);
      if (queued) alepha.with(AlephaApiJobsQueue);

      let calls = 0;
      class App {
        executions = $repository(jobExecutionEntity);
        work = $job({
          schema: z.object({ v: z.integer() }),
          handler: async () => {
            calls++;
            throw new Error("provider refused");
          },
        });
      }

      const app = alepha.with(App).inject(App);
      const jobs = alepha.inject(JobProvider) as TestJobProvider;
      await alepha.start();

      await expect(
        app.work.push({ v: 1 }, { inline: true }),
      ).rejects.toThrowError("provider refused");

      const rows = await app.executions.findMany({
        where: { jobName: { eq: "App.work" } },
      });
      expect(rows).toHaveLength(1);
      // `error`, never `scheduled`. This is the whole quest: a `scheduled`
      // row would have the sweep deliver the expired payload later anyway.
      expect(rows[0].status).toBe("error");

      // And the sweep really does leave it alone.
      await jobs.testSweep();
      await sleep(50);
      expect(calls).toBe(1);
      expect((await app.executions.findById(rows[0].id))?.status).toBe("error");
    });
  }

  it("a per-push inline overrides a declared retry: one attempt, then terminal", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with({ provide: JobProvider, use: TestJobProvider })
      .with(AlephaOrmPostgres)
      .with(AlephaApiJobs);

    let calls = 0;
    class RetryingApp {
      executions = $repository(jobExecutionEntity);
      work = $job({
        schema: z.object({ v: z.integer() }),
        // Kept for the asynchronous majority of this job's callers.
        retry: { retries: 3 },
        handler: async () => {
          calls++;
          throw new Error("nope");
        },
      });
    }

    const app = alepha.with(RetryingApp).inject(RetryingApp);
    const jobs = alepha.inject(JobProvider) as TestJobProvider;
    await alepha.start();

    await expect(
      app.work.push({ v: 1 }, { inline: true }),
    ).rejects.toThrowError("nope");

    const rows = await app.executions.findMany({
      where: { jobName: { eq: "RetryingApp.work" } },
    });
    expect(rows[0].status).toBe("error");
    expect(rows[0].maxAttempts).toBe(1);

    await jobs.testSweep();
    await sleep(50);
    expect(calls).toBe(1);
  });

  it("a normal push on the same job still retries", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaOrmPostgres).with(AlephaApiJobs);

    class RetryingApp {
      executions = $repository(jobExecutionEntity);
      work = $job({
        schema: z.object({ v: z.integer() }),
        retry: { retries: 3 },
        handler: async () => {
          throw new Error("nope");
        },
      });
    }

    const app = alepha.with(RetryingApp).inject(RetryingApp);
    await alepha.start();

    const id = await app.work.push({ v: 1 });
    const row = await waitFor(
      () => app.executions.findById(id),
      (r) => r?.status === "scheduled",
      { label: "retry scheduled" },
    );
    expect(row?.status).toBe("scheduled");
    expect(row?.maxAttempts).toBe(4);
  });

  it("refuses inline together with cron, or with retry, at registration", async ({
    expect,
  }) => {
    const withCron = Alepha.create()
      .with(AlephaOrmPostgres)
      .with(AlephaApiJobs);
    class CronApp {
      work = $job({
        cron: "0 * * * *",
        inline: true,
        handler: async () => {},
      });
    }
    expect(() => withCron.with(CronApp).inject(CronApp)).toThrowError(
      /no caller to block/,
    );

    const withRetry = Alepha.create()
      .with(AlephaOrmPostgres)
      .with(AlephaApiJobs);
    class RetryApp {
      work = $job({
        schema: z.object({ v: z.integer() }),
        inline: true,
        retry: { retries: 2 },
        handler: async () => {},
      });
    }
    expect(() => withRetry.with(RetryApp).inject(RetryApp)).toThrowError(
      /cannot both be the default/,
    );
  });

  it("refuses inline on pushMany, and inline with a delay", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with(AlephaOrmPostgres).with(AlephaApiJobs);

    class FanOutApp {
      work = $job({
        schema: z.object({ v: z.integer() }),
        inline: true,
        handler: async () => {},
      });
    }

    const app = alepha.with(FanOutApp).inject(FanOutApp);
    await alepha.start();

    await expect(
      app.work.pushMany([{ payload: { v: 1 } }, { payload: { v: 2 } }]),
    ).rejects.toThrowError(/pushMany cannot honour/);

    await expect(
      app.work.push({ v: 1 }, { delay: [1, "hour"] }),
    ).rejects.toThrowError(/Pick one/);
  });
});

// -----------------------------------------------------------------------------------------------------------------

/**
 * Pins the jitter so a backoff assertion is about the curve, not the dice.
 */
class FixedJitterJobProvider extends TestJobProvider {
  protected override randomFraction(): number {
    return 1;
  }
}

/**
 * A backend at the bottom of the capability ladder: it can carry a message,
 * it cannot hold one. Stands in for `RedisQueueProvider`.
 */
class NoDelayQueueProvider extends MemoryQueueProvider {
  public declined = 0;

  public override async push(
    queue: string,
    message: string,
    options?: QueuePushOptions,
  ): Promise<void> {
    if (options?.delaySeconds && options.delaySeconds > 0) {
      this.declined++;
      throw new QueueDelayNotSupportedError("no delay tier here");
    }
    return super.push(queue, message, options);
  }
}

describe("$job — retries have real backoff", () => {
  for (const queued of [false, true]) {
    const label = queued ? "in queue mode" : "in direct mode";

    it(`retries at the backoff rather than on the sweep grid, ${label}`, async ({
      expect,
    }) => {
      const alepha = Alepha.create()
        .with({ provide: JobProvider, use: FixedJitterJobProvider })
        .with(AlephaOrmPostgres)
        .with(AlephaApiJobs);
      if (queued) alepha.with(AlephaApiJobsQueue);
      // 120 ms ceiling instead of 5 s, so the test does not have to wait out
      // a production curve to observe the shape of it.
      alepha.store.mut(jobConfig, (c) => ({
        ...c,
        retryBackoffBase: 120,
        retryBackoffMax: 120,
        // Long enough that nothing here can be attributed to the sweep.
        sweepCron: "0 0 1 1 *",
      }));

      let attempts = 0;
      class App {
        executions = $repository(jobExecutionEntity);
        work = $job({
          schema: z.object({ v: z.integer() }),
          retry: { retries: 1 },
          handler: async () => {
            attempts++;
            throw new Error("downstream is unhappy");
          },
        });
      }

      const app = alepha.with(App).inject(App);
      await alepha.start();

      const started = Date.now();
      await app.work.push({ v: 1 });

      // The second attempt arrives on its own, without any sweep at all.
      await waitFor(
        () => attempts,
        (n) => n === 2,
        { label: "second attempt runs off the backoff", timeout: 5_000 },
      );
      // And it waited: the old behaviour dispatched a retry immediately or
      // not at all.
      expect(Date.now() - started).toBeGreaterThanOrEqual(100);

      const rows = await waitFor(
        () =>
          app.executions.findMany({ where: { jobName: { eq: "App.work" } } }),
        (r) => r[0]?.status === "error",
        { label: "terminal after the last attempt" },
      );
      expect(rows[0].attempt).toBe(2);
    });
  }

  it("grows the ceiling exponentially and caps it", async ({ expect }) => {
    const alepha = Alepha.create()
      .with({ provide: JobProvider, use: FixedJitterJobProvider })
      .with(AlephaOrmPostgres)
      .with(AlephaApiJobs);
    alepha.store.mut(jobConfig, (c) => ({
      ...c,
      retryBackoffBase: 1_000,
      retryBackoffMax: 5_000,
    }));
    class App {
      work = $job({
        schema: z.object({ v: z.integer() }),
        handler: async () => {},
      });
    }
    alepha.with(App).inject(App);
    await alepha.start();

    // randomFraction is pinned to 1, so this reads the ceiling itself.
    const jobs = alepha.inject(JobProvider) as FixedJitterJobProvider;
    expect(jobs.testRetryBackoffMs(1)).toBe(1_000);
    expect(jobs.testRetryBackoffMs(2)).toBe(2_000);
    expect(jobs.testRetryBackoffMs(3)).toBe(4_000);
    expect(jobs.testRetryBackoffMs(4)).toBe(5_000);
    // Capped, not overflowed: 2 ** 99 would be Infinity.
    expect(jobs.testRetryBackoffMs(100)).toBe(5_000);
  });

  it("jitters, so a whole failing population does not retry in lockstep", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with({ provide: JobProvider, use: TestJobProvider })
      .with(AlephaOrmPostgres)
      .with(AlephaApiJobs);
    alepha.store.mut(jobConfig, (c) => ({ ...c, retryBackoffBase: 100_000 }));
    class App {
      work = $job({
        schema: z.object({ v: z.integer() }),
        handler: async () => {},
      });
    }
    alepha.with(App).inject(App);
    await alepha.start();

    const jobs = alepha.inject(JobProvider) as TestJobProvider;
    const draws = new Set(
      Array.from({ length: 50 }, () => jobs.testRetryBackoffMs(1)),
    );
    // Before this quest every retrying row in the system shared one
    // `scheduledAt` and the sweep promoted them as a single herd.
    expect(draws.size).toBeGreaterThan(40);
  });
});

describe("$job — delaySeconds on the dispatch interface", () => {
  it("a backend that declines a delay never enqueues immediately", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with({ provide: JobProvider, use: TestJobProvider })
      .with({ provide: QueueProvider, use: NoDelayQueueProvider })
      .with(AlephaOrmPostgres)
      .with(AlephaApiJobs)
      .with(AlephaApiJobsQueue);

    let calls = 0;
    class App {
      executions = $repository(jobExecutionEntity);
      work = $job({
        schema: z.object({ v: z.integer() }),
        handler: async () => {
          calls++;
        },
      });
    }

    const app = alepha.with(App).inject(App);
    const jobs = alepha.inject(JobProvider) as TestJobProvider;
    const queue = alepha.inject(QueueProvider) as NoDelayQueueProvider;
    await alepha.start();

    const id = await app.work.push({ v: 1 }, { delay: [1, "hour"] });

    expect(queue.declined).toBe(1);
    // Declined, so nothing was delivered. The row is still waiting for its
    // own time, which is the point: ignoring the delay would have run the
    // job an hour early.
    await sleep(80);
    expect(calls).toBe(0);
    expect((await app.executions.findById(id))?.status).toBe("scheduled");

    // ...and the sweep is still the backstop. Age the row and tick.
    const past = new Date(Date.now() - 60_000).toISOString();
    await app.executions.updateMany(
      { id: { eq: id } },
      { scheduledAt: past },
      { now: past },
    );
    await jobs.testSweep();
    await waitFor(
      () => calls,
      (n) => n === 1,
      { label: "sweep delivered the declined dispatch" },
    );
  });

  it("falls back to the local promoting timer when the backend declines", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with({ provide: JobProvider, use: TestJobProvider })
      .with({ provide: QueueProvider, use: NoDelayQueueProvider })
      .with(AlephaOrmPostgres)
      .with(AlephaApiJobs)
      .with(AlephaApiJobsQueue);
    // No sweep at all, so nothing but the timer can deliver this.
    alepha.store.mut(jobConfig, (c) => ({ ...c, sweepCron: "0 0 1 1 *" }));

    let calls = 0;
    class App {
      executions = $repository(jobExecutionEntity);
      work = $job({
        schema: z.object({ v: z.integer() }),
        handler: async () => {
          calls++;
        },
      });
    }

    const app = alepha.with(App).inject(App);
    const queue = alepha.inject(QueueProvider) as NoDelayQueueProvider;
    await alepha.start();

    const started = Date.now();
    const id = await app.work.push({ v: 1 }, { delay: [150, "millisecond"] });
    expect(queue.declined).toBe(1);
    expect(calls).toBe(0);

    // This is the claim the epic rests on for Node: a broker with no delay
    // tier still gets exact timing, because the local timer PROMOTES rather
    // than delivers and so is dispatcher-agnostic. Zero work on the broker.
    await waitFor(
      () => calls,
      (n) => n === 1,
      { label: "local timer delivered the declined delay" },
    );
    expect(Date.now() - started).toBeGreaterThanOrEqual(140);
    expect((await app.executions.findById(id))?.status).toBeUndefined();
  });

  it("a transport that holds the message delivers it, and the claim refuses it early", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with({ provide: JobProvider, use: TestJobProvider })
      .with(AlephaOrmPostgres)
      .with(AlephaApiJobs)
      .with(AlephaApiJobsQueue);
    // No sweep, so only the transport's own delay can move this row.
    alepha.store.mut(jobConfig, (c) => ({ ...c, sweepCron: "0 0 1 1 *" }));

    let calls = 0;
    class App {
      executions = $repository(jobExecutionEntity);
      work = $job({
        schema: z.object({ v: z.integer() }),
        handler: async () => {
          calls++;
        },
      });
    }

    const app = alepha.with(App).inject(App);
    const jobs = alepha.inject(JobProvider) as TestJobProvider;
    await alepha.start();

    const id = await app.work.push({ v: 1 }, { delay: [10, "minute"] });
    await sleep(80);
    expect(calls).toBe(0);

    // An EARLY delivery (a clamped Cloudflare delay, clock skew) must not
    // run the job: the claim's own `scheduledAt <= now` guard refuses it and
    // the row is left exactly as it was.
    await jobs.testProcessExecution("App.work", id);
    expect(calls).toBe(0);
    const row = await app.executions.findById(id);
    expect(row?.status).toBe("scheduled");
    expect(row?.attempt).toBe(0);

    // Due now: the same delivery claims straight out of `scheduled`, which
    // is what lets a transport hold the message without anything having to
    // promote the row first.
    const past = new Date(Date.now() - 1_000).toISOString();
    await app.executions.updateMany(
      { id: { eq: id } },
      { scheduledAt: past },
      { now: past },
    );
    await jobs.testProcessExecution("App.work", id);
    expect(calls).toBe(1);
  });

  it("two replicas racing one promotion produce exactly one dispatch", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with({ provide: JobProvider, use: TestJobProvider })
      .with(AlephaOrmPostgres)
      .with(AlephaApiJobs);
    alepha.store.mut(jobConfig, (c) => ({ ...c, sweepCron: "0 0 1 1 *" }));

    let calls = 0;
    class App {
      executions = $repository(jobExecutionEntity);
      work = $job({
        schema: z.object({ v: z.integer() }),
        handler: async () => {
          calls++;
          await sleep(20);
        },
      });
    }

    const app = alepha.with(App).inject(App);
    const jobs = alepha.inject(JobProvider) as TestJobProvider;
    await alepha.start();

    // A row already due, so both promotions are live at once — the shape two
    // replicas holding the same timer produce.
    const id = await app.work.push({ v: 1 }, { delay: [10, "minute"] });
    const past = new Date(Date.now() - 1_000).toISOString();
    await app.executions.updateMany(
      { id: { eq: id } },
      { scheduledAt: past },
      { now: past },
    );

    await Promise.all([
      jobs.testDispatchScheduled("App.work", id),
      jobs.testDispatchScheduled("App.work", id),
    ]);
    await waitFor(
      () => calls,
      (n) => n >= 1,
      { label: "the winner ran" },
    );
    await sleep(120);

    // The guarded promotion picks one winner, and the claim absorbs anything
    // that gets past it. Both belts matter: a duplicate delivery is a normal
    // event for any at-least-once transport.
    expect(calls).toBe(1);
  });
});

// -----------------------------------------------------------------------------------------------------------------

describe("$job — trim is proportional to the work done", () => {
  it("trims a job back even when it produced far more rows than the old cap", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with({ provide: JobProvider, use: TestJobProvider })
      .with(AlephaOrmPostgres)
      .with(AlephaApiJobs);

    class NoisyApp {
      executions = $repository(jobExecutionEntity);
      work = $job({
        schema: z.object({ v: z.integer() }),
        keep: { error: 3 },
        handler: async () => {},
      });
    }

    const app = alepha.with(NoisyApp).inject(NoisyApp);
    const jobs = alepha.inject(JobProvider) as TestJobProvider;
    await alepha.start();

    // 120 error rows against a buffer of 3. The old trim read `keep + 50`
    // and deleted whatever was past `keep`, so it could never remove more
    // than 50 in a tick and a job at this rate grew without bound forever.
    for (let v = 0; v < 120; v++) {
      await app.executions.create({
        jobName: "NoisyApp.work",
        status: "error",
        error: `boom ${v}`,
        maxAttempts: 1,
      });
    }

    await jobs.testTrimRingBuffers();

    const left = await app.executions.findMany({
      where: { jobName: { eq: "NoisyApp.work" }, status: { eq: "error" } },
    });
    expect(left).toHaveLength(3);
  });

  it("leaves a buffer that is exactly at its limit alone", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with({ provide: JobProvider, use: TestJobProvider })
      .with(AlephaOrmPostgres)
      .with(AlephaApiJobs);

    class QuietApp {
      executions = $repository(jobExecutionEntity);
      work = $job({
        schema: z.object({ v: z.integer() }),
        keep: { error: 3 },
        handler: async () => {},
      });
    }

    const app = alepha.with(QuietApp).inject(QuietApp);
    const jobs = alepha.inject(JobProvider) as TestJobProvider;
    await alepha.start();

    const ids: string[] = [];
    for (let v = 0; v < 3; v++) {
      const row = await app.executions.create({
        jobName: "QuietApp.work",
        status: "error",
        error: `boom ${v}`,
        maxAttempts: 1,
      });
      ids.push(row.id);
    }

    await jobs.testTrimRingBuffers();

    const left = await app.executions.findMany({
      where: { jobName: { eq: "QuietApp.work" }, status: { eq: "error" } },
    });
    expect(left.map((r) => r.id).sort()).toEqual([...ids].sort());
  });

  it("keeps a per-job keep of 0 forever, which is the opposite of the global 0", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with({ provide: JobProvider, use: TestJobProvider })
      .with(AlephaOrmPostgres)
      .with(AlephaApiJobs);
    // The global says "delete on success". The per-job 0 says "keep
    // forever". They are documented opposites and conflating them once
    // destroyed the audit trail of every job declaring `keep: { ok: 0 }`.
    alepha.store.mut(jobConfig, (c) => ({ ...c, keepLastSuccess: 0 }));

    class AuditApp {
      executions = $repository(jobExecutionEntity);
      work = $job({
        schema: z.object({ v: z.integer() }),
        record: "all",
        keep: { ok: 0, error: 0 },
        handler: async () => {},
      });
    }

    const app = alepha.with(AuditApp).inject(AuditApp);
    const jobs = alepha.inject(JobProvider) as TestJobProvider;
    await alepha.start();

    for (let v = 0; v < 5; v++) {
      await app.executions.create({
        jobName: "AuditApp.work",
        status: "ok",
        maxAttempts: 1,
      });
    }

    await jobs.testTrimRingBuffers();

    const left = await app.executions.findMany({
      where: { jobName: { eq: "AuditApp.work" }, status: { eq: "ok" } },
    });
    expect(left).toHaveLength(5);
  });

  it("a cron whose buffer is one row updates it instead of insert-then-delete", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with({ provide: JobProvider, use: TestJobProvider })
      .with(AlephaOrmPostgres)
      .with(AlephaApiJobs);

    let ticks = 0;
    class TickApp {
      executions = $repository(jobExecutionEntity);
      // No explicit `record`: registration gives a cron `record: "all"` with
      // `keep.ok = 1`, which is the configuration that used to INSERT a row
      // per tick so trim could delete it again.
      beat = $job({
        cron: "0 * * * *",
        handler: async () => {
          ticks++;
        },
      });
    }

    const app = alepha.with(TickApp).inject(TickApp);
    await alepha.start();

    await app.beat.trigger();
    const first = await app.executions.findMany({
      where: { jobName: { eq: "TickApp.beat" }, status: { eq: "ok" } },
    });
    expect(first).toHaveLength(1);

    await app.beat.trigger();
    await app.beat.trigger();
    expect(ticks).toBe(3);

    const after = await app.executions.findMany({
      where: { jobName: { eq: "TickApp.beat" }, status: { eq: "ok" } },
    });
    // One row throughout, and it is the SAME row: three ticks used to mean
    // three inserts and two deletes for one timestamp.
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(first[0].id);
    // And it is current, which is the only thing the admin "Last run" reads.
    expect(new Date(after[0].startedAt!).getTime()).toBeGreaterThanOrEqual(
      new Date(first[0].startedAt!).getTime(),
    );
  });

  it("a cron keeping more than one row still inserts, so its history survives", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with({ provide: JobProvider, use: TestJobProvider })
      .with(AlephaOrmPostgres)
      .with(AlephaApiJobs);

    class HistoryApp {
      executions = $repository(jobExecutionEntity);
      beat = $job({
        cron: "0 * * * *",
        record: "all",
        keep: { ok: 5 },
        handler: async () => {},
      });
    }

    const app = alepha.with(HistoryApp).inject(HistoryApp);
    await alepha.start();

    await app.beat.trigger();
    await app.beat.trigger();
    await app.beat.trigger();

    const rows = await app.executions.findMany({
      where: { jobName: { eq: "HistoryApp.beat" }, status: { eq: "ok" } },
    });
    expect(rows).toHaveLength(3);
  });
});
