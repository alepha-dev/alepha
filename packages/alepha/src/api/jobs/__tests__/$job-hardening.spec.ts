import { Alepha, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, DbEntityNotFoundError, DbError } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
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
