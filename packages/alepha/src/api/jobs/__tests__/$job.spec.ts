import { Alepha, AlephaError, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { LockProvider, MemoryLockProvider } from "alepha/lock";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { CronProvider } from "alepha/scheduler";
import { describe, it } from "vitest";

import {
  $job,
  AlephaApiJobs,
  AlephaApiJobsQueue,
  JobProvider,
  jobExecutionEntity,
} from "../index.ts";

/**
 * Backdate a `scheduled` row so the sweep considers it due.
 *
 * Retries carry an exponential, jittered backoff, so a test that drives the
 * sweep by hand has to say WHEN it is pretending to be, or it is asserting
 * on the jitter. `opts.now` is what keeps `updatedAt` from being stamped
 * forward at the same time.
 */
const forceDue = async (repo: any, jobName: string) => {
  const past = new Date(Date.now() - 60_000).toISOString();
  await repo.updateMany(
    { jobName: { eq: jobName }, status: { eq: "scheduled" } },
    { scheduledAt: past },
    { now: past },
  );
};

const makeApp = () =>
  Alepha.create()
    .with(AlephaOrmPostgres)
    .with(AlephaApiJobs)
    .with(AlephaApiJobsQueue);

/**
 * App without `AlephaApiJobsQueue` — exercises *direct* mode.
 */
const makeAppDirect = () =>
  Alepha.create().with(AlephaOrmPostgres).with(AlephaApiJobs);

/**
 * Poll `fn` until `predicate` returns true, or throw on timeout.
 * Use this instead of `setTimeout(r, fixedMs)` — fixed sleeps race the
 * in-memory queue under CI load and produce flaky failures.
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

describe("$job — registration validation", () => {
  it("rejects jobs declaring both cron and schema", async ({ expect }) => {
    const alepha = makeApp();
    class App {
      bad = $job({
        cron: "* * * * *",
        schema: z.object({ id: z.text() }),
        handler: async () => {},
      });
    }
    expect(() => alepha.inject(App)).toThrow(AlephaError);
  });

  it("rejects jobs with neither cron nor schema", async ({ expect }) => {
    const alepha = makeApp();
    class App {
      bad = $job({
        handler: async () => {},
      });
    }
    expect(() => alepha.inject(App)).toThrow(AlephaError);
  });
});

// ---------------------------------------------------------------------------

describe("$job — cron mode", () => {
  it("runs handler inline on trigger and keeps the last successful run", async ({
    expect,
  }) => {
    const alepha = makeApp();
    let calls = 0;
    class App {
      executions = $repository(jobExecutionEntity);
      tick = $job({
        cron: "0 0 * * *",
        handler: async () => {
          calls++;
        },
      });
    }
    const app = alepha.inject(App);
    await alepha.start();
    await app.tick.trigger();
    expect(calls).toBe(1);
    // Cron jobs keep their last successful run by default so "Last run" works.
    const rows = await app.executions.findMany({
      where: { jobName: { eq: "App.tick" } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("ok");
  });

  it("records no row on success when record is 'error' (opt-out)", async ({
    expect,
  }) => {
    const alepha = makeApp();
    class App {
      executions = $repository(jobExecutionEntity);
      tick = $job({
        cron: "0 0 * * *",
        record: "error",
        handler: async () => {},
      });
    }
    const app = alepha.inject(App);
    await alepha.start();
    await app.tick.trigger();
    const rows = await app.executions.findMany({
      where: { jobName: { eq: "App.tick" } },
    });
    expect(rows).toHaveLength(0);
  });

  it("records an error row when cron handler throws", async ({ expect }) => {
    const alepha = makeApp();
    class App {
      executions = $repository(jobExecutionEntity);
      tick = $job({
        cron: "0 0 * * *",
        handler: async () => {
          throw new Error("boom");
        },
      });
    }
    const app = alepha.inject(App);
    await alepha.start();
    await app.tick.trigger();
    const rows = await app.executions.findMany({
      where: { jobName: { eq: "App.tick" } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("error");
    expect(rows[0].error).toBe("boom");
  });

  it("records a success row when record: 'all'", async ({ expect }) => {
    const alepha = makeApp();
    class App {
      executions = $repository(jobExecutionEntity);
      tick = $job({
        cron: "0 0 * * *",
        record: "all",
        handler: async () => {},
      });
    }
    const app = alepha.inject(App);
    await alepha.start();
    await app.tick.trigger();
    const rows = await app.executions.findMany({
      where: { jobName: { eq: "App.tick" } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("ok");
  });
});

// ---------------------------------------------------------------------------

describe("$job — captured logs", () => {
  it("attaches the run's log entries to the error row", async ({ expect }) => {
    const alepha = makeApp();
    class App {
      log = $logger();
      executions = $repository(jobExecutionEntity);
      tick = $job({
        cron: "0 0 * * *",
        handler: async () => {
          this.log.info("before the failure");
          throw new Error("boom");
        },
      });
    }
    const app = alepha.inject(App);
    await alepha.start();
    await app.tick.trigger();

    const rows = await app.executions.findMany({
      where: { jobName: { eq: "App.tick" } },
    });
    expect(rows[0].logs?.map((entry) => entry.message)).toContain(
      "before the failure",
    );
  });

  it("keeps no logs on a successful row", async ({ expect }) => {
    const alepha = makeApp();
    class App {
      log = $logger();
      executions = $repository(jobExecutionEntity);
      tick = $job({
        cron: "0 0 * * *",
        record: "all",
        handler: async () => {
          this.log.info("all good");
        },
      });
    }
    const app = alepha.inject(App);
    await alepha.start();
    await app.tick.trigger();

    const rows = await app.executions.findMany({
      where: { jobName: { eq: "App.tick" } },
    });
    expect(rows[0].status).toBe("ok");
    expect(rows[0].logs).toBeUndefined();
  });

  it("does not leak one run's logs into the next", async ({ expect }) => {
    const alepha = makeApp();
    class App {
      log = $logger();
      executions = $repository(jobExecutionEntity);
      tick = $job({
        cron: "0 0 * * *",
        handler: async () => {
          this.log.info(`run ${++runs}`);
          throw new Error("boom");
        },
      });
    }
    let runs = 0;
    const app = alepha.inject(App);
    await alepha.start();
    await app.tick.trigger();
    await app.tick.trigger();

    const rows = await app.executions.findMany({
      where: { jobName: { eq: "App.tick" } },
      orderBy: { column: "createdAt", direction: "desc" },
    });
    const messages = rows[0].logs?.map((entry) => entry.message) ?? [];
    expect(messages).toContain("run 2");
    expect(messages).not.toContain("run 1");
  });
});

// ---------------------------------------------------------------------------

describe("$job — queue mode (outbox)", () => {
  it("push creates a pending row then deletes on success by default", async ({
    expect,
  }) => {
    const alepha = makeApp();
    let received: { n: number } | undefined;
    class App {
      executions = $repository(jobExecutionEntity);
      work = $job({
        schema: z.object({ n: z.integer() }),
        handler: async ({ payload }) => {
          received = payload;
        },
      });
    }
    const app = alepha.inject(App);
    await alepha.start();
    await app.work.push({ n: 42 });

    const rows = await waitFor(
      () => app.executions.findMany({ where: { jobName: { eq: "App.work" } } }),
      (r) => r.length === 0 && received !== undefined,
      { label: "row deleted on success" },
    );
    expect(received).toEqual({ n: 42 });
    expect(rows).toHaveLength(0);
  });

  it("push keeps the row as 'ok' when record: 'all'", async ({ expect }) => {
    const alepha = makeApp();
    class App {
      executions = $repository(jobExecutionEntity);
      work = $job({
        schema: z.object({ n: z.integer() }),
        record: "all",
        handler: async () => {},
      });
    }
    const app = alepha.inject(App);
    await alepha.start();
    await app.work.push({ n: 1 });
    const rows = await waitFor(
      () => app.executions.findMany({ where: { jobName: { eq: "App.work" } } }),
      (r) => r.length === 1 && r[0].status === "ok",
      { label: "row reaches status=ok" },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("ok");
  });

  it("key-based dedup: second push with same key returns the same id while in flight", async ({
    expect,
  }) => {
    const alepha = makeApp();
    class App {
      work = $job({
        schema: z.object({ v: z.integer() }),
        handler: async () => {},
      });
    }
    const app = alepha.inject(App);
    await alepha.start();
    // Delay the first push so it stays in 'scheduled' state.
    // While the row exists with a key, a second push should return the same id.
    const id1 = await app.work.push(
      { v: 1 },
      { key: "dedup-1", delay: [1, "hour"] },
    );
    const id2 = await app.work.push(
      { v: 2 },
      { key: "dedup-1", delay: [1, "hour"] },
    );
    expect(id2).toBe(id1);
  });

  it("delay: push with delay creates a scheduled row, not dispatched", async ({
    expect,
  }) => {
    const alepha = makeApp();
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
    const app = alepha.inject(App);
    await alepha.start();
    await app.work.push({ v: 1 }, { delay: [1, "hour"] });
    const rows = await waitFor(
      () => app.executions.findMany({ where: { jobName: { eq: "App.work" } } }),
      (r) => r.length === 1 && r[0].status === "scheduled",
      { label: "row reaches status=scheduled" },
    );
    expect(calls).toBe(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("scheduled");
    expect(rows[0].scheduledAt).toBeTruthy();
  });

  it("pushMany: bulk inserts and processes all", async ({ expect }) => {
    const alepha = makeApp();
    const seen: number[] = [];
    class App {
      work = $job({
        schema: z.object({ n: z.integer() }),
        handler: async ({ payload }) => {
          seen.push(payload.n);
        },
      });
    }
    const app = alepha.inject(App);
    await alepha.start();
    const ids = await app.work.pushMany([
      { payload: { n: 1 } },
      { payload: { n: 2 } },
      { payload: { n: 3 } },
    ]);
    expect(ids).toHaveLength(3);
    // Poll: outbox dispatch is async, 100ms can be tight under CI load.
    const deadline = Date.now() + 2000;
    while (seen.length < 3 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it("retry: failed queue job is rescheduled with a jittered backoff", async ({
    expect,
  }) => {
    const alepha = makeApp();
    let attempts = 0;
    class App {
      executions = $repository(jobExecutionEntity);
      work = $job({
        schema: z.object({ v: z.integer() }),
        retry: { retries: 2 },
        handler: async () => {
          attempts++;
          throw new Error("fail");
        },
      });
    }
    const app = alepha.inject(App);
    await alepha.start();
    await app.work.push({ v: 1 });
    const rows = await waitFor(
      () => app.executions.findMany({ where: { jobName: { eq: "App.work" } } }),
      (r) =>
        r.length === 1 && r[0].status === "scheduled" && r[0].attempt === 1,
      { label: "row rescheduled after first failure" },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("scheduled");
    expect(rows[0].attempt).toBe(1);
    expect(attempts).toBe(1);
    // `scheduledAt` is in the future, within the first attempt's backoff
    // ceiling (`retryBackoffBase`, 5 s). It used to be exactly "now", which
    // is what put every retry on the sweep grid: the code in a verification
    // email lives 300 s and the sweep runs every 900.
    expect(rows[0].scheduledAt).toBeTruthy();
    const sched = new Date(rows[0].scheduledAt!).getTime();
    expect(sched).toBeGreaterThanOrEqual(Date.now() - 2_000);
    expect(sched).toBeLessThanOrEqual(Date.now() + 5_000);
  });

  it("retry: terminal error after all retries exhausted", async ({
    expect,
  }) => {
    const alepha = makeApp();
    class App {
      executions = $repository(jobExecutionEntity);
      work = $job({
        schema: z.object({ v: z.integer() }),
        // no retry config → 1 attempt
        handler: async () => {
          throw new Error("dead");
        },
      });
    }
    const app = alepha.inject(App);
    await alepha.start();
    await app.work.push({ v: 1 });
    const rows = await waitFor(
      () => app.executions.findMany({ where: { jobName: { eq: "App.work" } } }),
      (r) => r.length === 1 && r[0].status === "error",
      { label: "row reaches terminal status=error" },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("error");
    expect(rows[0].error).toBe("dead");
  });
});

// ---------------------------------------------------------------------------

describe("$job — cancel", () => {
  it("cancel sets status to 'cancelled' and clears key", async ({ expect }) => {
    const alepha = makeApp();
    class App {
      executions = $repository(jobExecutionEntity);
      work = $job({
        schema: z.object({ v: z.integer() }),
        handler: async () => {},
      });
    }
    const app = alepha.inject(App);
    await alepha.start();
    const id = await app.work.push({ v: 1 }, { delay: [1, "hour"] });
    await app.work.cancel(id);
    const row = await app.executions.findById(id);
    expect(row?.status).toBe("cancelled");
    expect(row?.key).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------

describe("$job — admin service", () => {
  it("listJobs returns all registered jobs with recent counts", async ({
    expect,
  }) => {
    const alepha = makeApp();
    class App {
      cronA = $job({
        cron: "0 0 * * *",
        description: "Daily A",
        handler: async () => {},
      });
      queueB = $job({
        schema: z.object({ v: z.integer() }),
        handler: async () => {},
      });
    }
    alepha.inject(App);
    await alepha.start();

    const { JobService } = await import("../services/JobService.ts");
    const svc = alepha.inject(JobService);
    const list = await svc.listJobs();

    const byName = new Map(list.map((l) => [l.name, l]));
    expect(byName.get("App.cronA")?.type).toBe("cron");
    expect(byName.get("App.cronA")?.cron).toBe("0 0 * * *");
    expect(byName.get("App.queueB")?.type).toBe("queue");
    expect(byName.get("App.cronA")?.recent.ok).toBe(0);
  });

  /**
   * The aggregate query only validates its `count` column when at least one
   * execution row exists — with an empty table the whole `GROUP BY` returns
   * nothing and a wrong column type is never exercised. Pinning `count` to
   * `string` (the Postgres bigint shape) therefore passed every test while
   * 500ing on SQLite/D1, where COUNT(*) comes back as a number.
   */
  it("listJobs counts real executions whatever type the driver gives COUNT(*)", async ({
    expect,
  }) => {
    const alepha = makeApp();
    class App {
      executions = $repository(jobExecutionEntity);
      tick = $job({
        cron: "0 0 * * *",
        handler: async () => {},
      });
    }
    const app = alepha.inject(App);
    await alepha.start();
    await app.tick.trigger();

    const { JobService } = await import("../services/JobService.ts");
    const list = await alepha.inject(JobService).listJobs();
    const tick = list.find((l) => l.name === "App.tick");

    expect(tick?.recent.ok).toBe(1);
    expect(tick?.recent.error).toBe(0);
    expect(tick?.recent.lastRun).toBeTruthy();
  });

  it("listJobs reports 'direct' when AlephaApiJobsQueue is not loaded", async ({
    expect,
  }) => {
    const alepha = makeAppDirect();
    class App {
      worker = $job({
        schema: z.object({ v: z.integer() }),
        handler: async () => {},
      });
    }
    alepha.inject(App);
    await alepha.start();

    const { JobService } = await import("../services/JobService.ts");
    const svc = alepha.inject(JobService);
    const list = await svc.listJobs();

    expect(list.find((j) => j.name === "App.worker")?.type).toBe("direct");
  });
});

// ---------------------------------------------------------------------------

describe("$job — direct mode (no AlephaApiJobsQueue)", () => {
  it("push without a queue dispatcher processes the row in-process", async ({
    expect,
  }) => {
    const alepha = makeAppDirect();
    let received: { n: number } | undefined;
    class App {
      executions = $repository(jobExecutionEntity);
      work = $job({
        schema: z.object({ n: z.integer() }),
        handler: async ({ payload }) => {
          received = payload;
        },
      });
    }
    const app = alepha.inject(App);
    await alepha.start();

    expect(alepha.inject(JobProvider).effectiveMode("App.work")).toBe("direct");

    await app.work.push({ n: 7 });

    // Direct mode is fire-and-track; give the microtask queue a moment.
    const deadline = Date.now() + 1500;
    while (received === undefined && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }

    expect(received).toEqual({ n: 7 });

    // Default record: 'error' → success deletes the row. The delete happens
    // AFTER the handler returns, so waiting on `received` alone raced the
    // cleanup and read the row mid-flight on a loaded runner.
    let rows = await app.executions.findMany({
      where: { jobName: { eq: "App.work" } },
    });
    const rowDeadline = Date.now() + 1500;
    while (rows.length > 0 && Date.now() < rowDeadline) {
      await new Promise((r) => setTimeout(r, 25));
      rows = await app.executions.findMany({
        where: { jobName: { eq: "App.work" } },
      });
    }

    expect(rows).toHaveLength(0);
  });

  it("direct mode failure schedules the row with a backoff", async ({
    expect,
  }) => {
    const alepha = makeAppDirect();
    class App {
      executions = $repository(jobExecutionEntity);
      work = $job({
        schema: z.object({ n: z.integer() }),
        retry: { retries: 2 },
        handler: async () => {
          throw new Error("nope");
        },
      });
    }
    const app = alepha.inject(App);
    await alepha.start();

    await app.work.push({ n: 1 });

    // Wait for the in-process attempt to fail.
    const deadline = Date.now() + 2000;
    let row: any;
    while (Date.now() < deadline) {
      const rows = await app.executions.findMany({
        where: { jobName: { eq: "App.work" } },
      });
      if (rows[0]?.status === "scheduled") {
        row = rows[0];
        break;
      }
      await new Promise((r) => setTimeout(r, 25));
    }

    expect(row).toBeTruthy();
    expect(row.status).toBe("scheduled");
    expect(row.attempt).toBe(1);
    expect(row.error).toBe("nope");
    // `scheduledAt` is in the future, inside the first attempt's backoff
    // ceiling (`retryBackoffBase`, 5 s). It used to be exactly "now", which
    // is what put every retry on the 15-minute sweep grid.
    const sched = new Date(row.scheduledAt).getTime();
    expect(sched).toBeGreaterThanOrEqual(Date.now() - 2_000);
    expect(sched).toBeLessThanOrEqual(Date.now() + 5_000);
  });
});

// ---------------------------------------------------------------------------

/**
 * Shared in-process key/value to simulate a cross-instance lock store
 * (mirrors the pattern used in scheduler tests).
 */
const sharedLockStore: Record<string, string> = {};
class SharedMemoryLockProvider extends MemoryLockProvider {
  override store = sharedLockStore;
}

describe("$job — cron lock (multi-instance)", () => {
  it("only one instance fires the cron handler when sharing a LockProvider", async ({
    expect,
  }) => {
    // Reset store between tests.
    for (const k of Object.keys(sharedLockStore)) delete sharedLockStore[k];

    let fired = 0;
    class App {
      tick = $job({
        cron: "0 0 * * *",
        handler: async () => {
          fired++;
        },
      });
    }

    const make = () =>
      Alepha.create()
        // Substitute the LockProvider BEFORE AlephaApiJobs imports AlephaLock,
        // otherwise the module's default `optional` MemoryLockProvider wins.
        .with({ provide: LockProvider, use: SharedMemoryLockProvider })
        .with(AlephaOrmPostgres)
        .with(AlephaApiJobs);

    const a = make();
    const b = make();
    a.inject(App);
    b.inject(App);
    await a.start();
    await b.start();

    // Trigger the tick from both instances: only one should win the lock.
    await Promise.all([
      a.inject(App).tick.trigger(),
      b.inject(App).tick.trigger(),
    ]);

    expect(fired).toBe(1);
  });

  it("lock: false lets every instance fire (opt-out behavior)", async ({
    expect,
  }) => {
    for (const k of Object.keys(sharedLockStore)) delete sharedLockStore[k];

    let fired = 0;
    class App {
      tick = $job({
        cron: "0 0 * * *",
        lock: false,
        handler: async () => {
          fired++;
        },
      });
    }

    const make = () =>
      Alepha.create()
        // Substitute the LockProvider BEFORE AlephaApiJobs imports AlephaLock,
        // otherwise the module's default `optional` MemoryLockProvider wins.
        .with({ provide: LockProvider, use: SharedMemoryLockProvider })
        .with(AlephaOrmPostgres)
        .with(AlephaApiJobs);

    const a = make();
    const b = make();
    a.inject(App);
    b.inject(App);
    await a.start();
    await b.start();

    await Promise.all([
      a.inject(App).tick.trigger(),
      b.inject(App).tick.trigger(),
    ]);

    expect(fired).toBe(2);
  });

  it("two replicas ticking the same instant enqueue one execution, even with retry", async ({
    expect,
  }) => {
    for (const k of Object.keys(sharedLockStore)) delete sharedLockStore[k];

    class CronLeaseApp {
      executions = $repository(jobExecutionEntity);
      // `retry` is the case the run lock never covered: the tick writes an
      // outbox row and hands the lock straight back, so a replica arriving a
      // millisecond later used to find it free and enqueue the tick again.
      instantTick = $job({
        cron: "0 0 * * *",
        retry: { retries: 2 },
        handler: async () => {
          throw new Error("always fails");
        },
      });
    }

    const make = () =>
      Alepha.create()
        .with({ provide: LockProvider, use: SharedMemoryLockProvider })
        .with(AlephaOrmPostgres)
        .with(AlephaApiJobs);

    const a = make();
    const b = make();
    a.inject(CronLeaseApp);
    b.inject(CronLeaseApp);
    await a.start();
    await b.start();

    // The scheduled instant both replicas derive for the same tick. Every
    // replica parses the same cron expression, so this value is shared even
    // though their wall clocks are not.
    const instant = a.inject(DateTimeProvider).of("2026-01-01T00:00:00.000Z");
    const tickOf = (container: Alepha) =>
      container
        .inject(CronProvider)
        .getCronJobs()
        .find((job) => job.name === "CronLeaseApp.instantTick")!;

    // Sequential on purpose. Concurrent ticks were always serialised by the
    // run lock; the hole is the replica that arrives a moment LATER, once the
    // lock has been handed back, and finds it free.
    await tickOf(a).handler({ now: instant });
    await tickOf(b).handler({ now: instant });

    // Each test container owns a private postgres schema, so count both and
    // add them up: the claim is one execution across the cluster, not one
    // per database.
    const where = { jobName: { eq: "CronLeaseApp.instantTick" } };
    const rowsA = await a.inject(CronLeaseApp).executions.findMany({ where });
    const rowsB = await b.inject(CronLeaseApp).executions.findMany({ where });
    expect(rowsA.length + rowsB.length).toBe(1);

    // ...and the NEXT instant is not blocked by the lease left behind.
    const next = a.inject(DateTimeProvider).of("2026-01-02T00:00:00.000Z");
    await tickOf(a).handler({ now: next });
    const after = await a.inject(CronLeaseApp).executions.findMany({ where });
    expect(after.length).toBe(rowsA.length + 1);
  });
});

// ---------------------------------------------------------------------------

describe("$job — retry semantics", () => {
  it("retries: 2 runs the handler 3 times before the row is terminal", async ({
    expect,
  }) => {
    const alepha = makeApp();
    let attempts = 0;
    class App {
      executions = $repository(jobExecutionEntity);
      work = $job({
        schema: z.object({ v: z.integer() }),
        retry: { retries: 2 },
        handler: async () => {
          attempts++;
          throw new Error("boom");
        },
      });
    }
    const app = alepha.inject(App);
    await alepha.start();

    await app.work.push({ v: 1 });

    // First attempt runs immediately, then the row is rescheduled with attempt=1.
    // Wait for that stable state before sweeping (sweep needs status=scheduled).
    await waitFor(
      () => app.executions.findMany({ where: { jobName: { eq: "App.work" } } }),
      (r) => r[0]?.status === "scheduled" && r[0]?.attempt === 1,
      { label: "row rescheduled after attempt 1" },
    );
    expect(attempts).toBe(1);

    const provider = alepha.inject(JobProvider);
    // Each attempt is now scheduled with a real backoff, so the row is not
    // due yet and the sweep would correctly skip it. Age it first: what this
    // test is about is that the SWEEP claims and runs the next attempt, and
    // keeps doing so exactly `retries` times.
    await forceDue(app.executions, "App.work");
    await (provider as any).sweep();
    await waitFor(
      () => app.executions.findMany({ where: { jobName: { eq: "App.work" } } }),
      (r) => r[0]?.status === "scheduled" && r[0]?.attempt === 2,
      { label: "row rescheduled after attempt 2" },
    );
    expect(attempts).toBe(2);

    await forceDue(app.executions, "App.work");
    await (provider as any).sweep();
    await waitFor(
      () => app.executions.findMany({ where: { jobName: { eq: "App.work" } } }),
      (r) => r[0]?.status === "error" && r[0]?.attempt === 3,
      { label: "row terminal after attempt 3" },
    );
    expect(attempts).toBe(3);

    // After 3 attempts the row is terminal — no more retries.
    const finalRow = (
      await app.executions.findMany({ where: { jobName: { eq: "App.work" } } })
    )[0];
    expect(finalRow.status).toBe("error");
    expect(finalRow.attempt).toBe(3);
  });
});

// ---------------------------------------------------------------------------

describe("$job — cancel race", () => {
  it("cancel during a running handler keeps the row 'cancelled' (not 'error')", async ({
    expect,
  }) => {
    const alepha = makeApp();
    class App {
      executions = $repository(jobExecutionEntity);
      slow = $job({
        schema: z.object({ v: z.integer() }),
        retry: { retries: 0 },
        handler: async ({ signal }) => {
          // Wait for cancellation, then throw — without the guard this throw
          // would write `status: error` after `status: cancelled`.
          await new Promise<void>((_, reject) => {
            signal.addEventListener("abort", () => {
              reject(new Error("aborted"));
            });
          });
        },
      });
    }
    const app = alepha.inject(App);
    await alepha.start();

    const id = await app.slow.push({ v: 1 });

    // Wait for the handler to be `running`.
    const deadline = Date.now() + 1500;
    while (Date.now() < deadline) {
      const row = await app.executions.findById(id);
      if (row?.status === "running") break;
      await new Promise((r) => setTimeout(r, 20));
    }

    await app.slow.cancel(id);

    // Confirm the row is `cancelled` and stays that way — without the guard,
    // the handler's abort path would race to overwrite to `error`. Poll for a
    // stable window so the (buggy) overwrite would be caught.
    const settleDeadline = Date.now() + 300;
    let final: any;
    while (Date.now() < settleDeadline) {
      final = await app.executions.findById(id);
      if (final?.status !== "cancelled") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(final?.status).toBe("cancelled");
    expect(final?.error).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------

describe("$job — cron + retry (outbox path)", () => {
  it("a failing cron job with retry is rescheduled by the sweep, not next tick", async ({
    expect,
  }) => {
    const alepha = makeAppDirect();
    let attempts = 0;
    class App {
      executions = $repository(jobExecutionEntity);
      tick = $job({
        cron: "0 0 * * *",
        retry: { retries: 1 },
        handler: async () => {
          attempts++;
          throw new Error("transient");
        },
      });
    }
    const app = alepha.inject(App);
    await alepha.start();

    // Manually fire the cron tick (admin trigger path goes through the
    // same lock-aware runner as the scheduled tick).
    await app.tick.trigger();

    // Direct-mode dispatch is fire-and-track. Wait for the first attempt
    // to land in the DB.
    const deadline = Date.now() + 1500;
    while (attempts < 1 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(attempts).toBe(1);

    // The row exists in the outbox after the cron tick (unlike inline crons,
    // which only persist on error).
    const provider = alepha.inject(JobProvider);
    const rows1 = await app.executions.findMany({
      where: { jobName: { eq: "App.tick" } },
    });
    expect(rows1).toHaveLength(1);
    expect(rows1[0].status).toBe("scheduled");

    // Sweep picks it up and runs attempt 2 → terminal. Aged first, because
    // the retry now carries a real backoff and is not due yet.
    await forceDue(app.executions, "App.tick");
    await (provider as any).sweep();
    await waitFor(
      () => attempts,
      (n) => n === 2,
      { label: "second attempt runs after cron sweep" },
    );
    const rows2 = await waitFor(
      () => app.executions.findMany({ where: { jobName: { eq: "App.tick" } } }),
      (r) => r[0]?.status === "error",
      { label: "row reaches terminal error" },
    );
    expect(rows2[0].status).toBe("error");
  });
});

// ---------------------------------------------------------------------------

describe("$job — dispatchMany (queue mode)", () => {
  it("pushMany hands the dispatcher a single batch", async ({ expect }) => {
    const alepha = makeApp();
    class App {
      bulk = $job({
        schema: z.object({ n: z.integer() }),
        handler: async () => {},
      });
    }
    const app = alepha.inject(App);
    await alepha.start();

    const provider = alepha.inject(JobProvider);
    const dispatcher = (provider as any).dispatcher as {
      dispatchMany: (
        items: Array<{ jobName: string; executionId: string }>,
      ) => Promise<void>;
    };

    let batched: Array<{ jobName: string; executionId: string }> = [];
    const original = dispatcher.dispatchMany.bind(dispatcher);
    dispatcher.dispatchMany = async (items) => {
      batched = items;
      await original(items);
    };

    await app.bulk.pushMany([
      { payload: { n: 1 } },
      { payload: { n: 2 } },
      { payload: { n: 3 } },
    ]);

    expect(batched).toHaveLength(3);
    for (const it of batched) {
      expect(it.jobName).toBe("App.bulk");
      expect(it.executionId).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------

describe("$job — admin resource shape", () => {
  it("execution resource exposes priority as the enum string", async ({
    expect,
  }) => {
    const alepha = makeApp();
    class App {
      work = $job({
        schema: z.object({ v: z.integer() }),
        priority: "high",
        record: "all",
        handler: async () => {},
      });
    }
    const app = alepha.inject(App);
    await alepha.start();

    const id = await app.work.push({ v: 1 });
    const { JobService } = await import("../services/JobService.ts");
    const svc = alepha.inject(JobService);
    // Wait for the handler to finish so the row is `ok` (record: all keeps it).
    const resource = await waitFor(
      () => svc.getExecution(id),
      (r) => r?.status === "ok",
      { label: "execution reaches status=ok" },
    );
    expect(resource.priority).toBe("high");
    expect(typeof resource.priority).toBe("string");
  });
});
