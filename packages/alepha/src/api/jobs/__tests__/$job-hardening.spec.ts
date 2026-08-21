import { Alepha, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, DbEntityNotFoundError, DbError } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";

import {
  $job,
  AlephaApiJobs,
  AlephaApiJobsQueue,
  JobProvider,
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
