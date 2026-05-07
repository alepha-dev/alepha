import { Alepha, AlephaError, t } from "alepha";
import { LockProvider, MemoryLockProvider } from "alepha/lock";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";
import {
  $job,
  AlephaApiJobs,
  AlephaApiJobsQueue,
  JobProvider,
  jobExecutionEntity,
} from "../index.ts";

const makeApp = () =>
  Alepha.create()
    .with(AlephaOrmPostgres)
    .with(AlephaApiJobs)
    .with(AlephaApiJobsQueue);

/** App without `AlephaApiJobsQueue` — exercises *direct* mode. */
const makeAppDirect = () =>
  Alepha.create().with(AlephaOrmPostgres).with(AlephaApiJobs);

describe("$job — registration validation", () => {
  it("rejects jobs declaring both cron and schema", async ({ expect }) => {
    const alepha = makeApp();
    class App {
      bad = $job({
        cron: "* * * * *",
        schema: t.object({ id: t.text() }),
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
  it("runs handler inline on trigger, no DB row on success by default", async ({
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

describe("$job — queue mode (outbox)", () => {
  it("push creates a pending row then deletes on success by default", async ({
    expect,
  }) => {
    const alepha = makeApp();
    let received: { n: number } | undefined;
    class App {
      executions = $repository(jobExecutionEntity);
      work = $job({
        schema: t.object({ n: t.integer() }),
        handler: async ({ payload }) => {
          received = payload;
        },
      });
    }
    const app = alepha.inject(App);
    await alepha.start();
    await app.work.push({ n: 42 });

    // Memory queue is synchronous-ish; processing completes promptly.
    await new Promise((r) => setTimeout(r, 50));

    expect(received).toEqual({ n: 42 });
    const rows = await app.executions.findMany({
      where: { jobName: { eq: "App.work" } },
    });
    expect(rows).toHaveLength(0);
  });

  it("push keeps the row as 'ok' when record: 'all'", async ({ expect }) => {
    const alepha = makeApp();
    class App {
      executions = $repository(jobExecutionEntity);
      work = $job({
        schema: t.object({ n: t.integer() }),
        record: "all",
        handler: async () => {},
      });
    }
    const app = alepha.inject(App);
    await alepha.start();
    await app.work.push({ n: 1 });
    await new Promise((r) => setTimeout(r, 50));
    const rows = await app.executions.findMany({
      where: { jobName: { eq: "App.work" } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("ok");
  });

  it("key-based dedup: second push with same key returns the same id while in flight", async ({
    expect,
  }) => {
    const alepha = makeApp();
    class App {
      work = $job({
        schema: t.object({ v: t.integer() }),
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
        schema: t.object({ v: t.integer() }),
        handler: async () => {
          calls++;
        },
      });
    }
    const app = alepha.inject(App);
    await alepha.start();
    await app.work.push({ v: 1 }, { delay: [1, "hour"] });
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toBe(0);
    const rows = await app.executions.findMany({
      where: { jobName: { eq: "App.work" } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("scheduled");
    expect(rows[0].scheduledAt).toBeTruthy();
  });

  it("pushMany: bulk inserts and processes all", async ({ expect }) => {
    const alepha = makeApp();
    const seen: number[] = [];
    class App {
      work = $job({
        schema: t.object({ n: t.integer() }),
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
    expect(seen.sort()).toEqual([1, 2, 3]);
  });

  it("retry: failed queue job is rescheduled for the next sweep tick", async ({
    expect,
  }) => {
    const alepha = makeApp();
    let attempts = 0;
    class App {
      executions = $repository(jobExecutionEntity);
      work = $job({
        schema: t.object({ v: t.integer() }),
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
    await new Promise((r) => setTimeout(r, 50));
    const rows = await app.executions.findMany({
      where: { jobName: { eq: "App.work" } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("scheduled");
    expect(rows[0].attempt).toBe(1);
    expect(attempts).toBe(1);
    // scheduledAt is "now" (no backoff), proving we no longer wait for an
    // exponential delay — the row is immediately eligible at the next sweep.
    expect(rows[0].scheduledAt).toBeTruthy();
    const sched = new Date(rows[0].scheduledAt!).getTime();
    expect(Math.abs(sched - Date.now())).toBeLessThan(2_000);
  });

  it("retry: terminal error after all retries exhausted", async ({
    expect,
  }) => {
    const alepha = makeApp();
    class App {
      executions = $repository(jobExecutionEntity);
      work = $job({
        schema: t.object({ v: t.integer() }),
        // no retry config → 1 attempt
        handler: async () => {
          throw new Error("dead");
        },
      });
    }
    const app = alepha.inject(App);
    await alepha.start();
    await app.work.push({ v: 1 });
    await new Promise((r) => setTimeout(r, 100));
    const rows = await app.executions.findMany({
      where: { jobName: { eq: "App.work" } },
    });
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
        schema: t.object({ v: t.integer() }),
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
        schema: t.object({ v: t.integer() }),
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

  it("listJobs reports 'direct' when AlephaApiJobsQueue is not loaded", async ({
    expect,
  }) => {
    const alepha = makeAppDirect();
    class App {
      worker = $job({
        schema: t.object({ v: t.integer() }),
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
        schema: t.object({ n: t.integer() }),
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
    // Default record: 'error' → success deletes the row.
    const rows = await app.executions.findMany({
      where: { jobName: { eq: "App.work" } },
    });
    expect(rows).toHaveLength(0);
  });

  it("direct mode failure schedules the row for the next sweep", async ({
    expect,
  }) => {
    const alepha = makeAppDirect();
    class App {
      executions = $repository(jobExecutionEntity);
      work = $job({
        schema: t.object({ n: t.integer() }),
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
    // scheduledAt should be "now" (no backoff).
    const sched = new Date(row.scheduledAt).getTime();
    expect(Math.abs(sched - Date.now())).toBeLessThan(2_000);
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
        schema: t.object({ v: t.integer() }),
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

    // First attempt runs immediately. Subsequent retries are sweep-driven.
    await new Promise((r) => setTimeout(r, 100));
    expect(attempts).toBe(1);

    const provider = alepha.inject(JobProvider);
    // Trigger sweeps manually — each one should claim and run the next attempt.
    await (provider as any).sweep();
    await new Promise((r) => setTimeout(r, 50));
    expect(attempts).toBe(2);

    await (provider as any).sweep();
    await new Promise((r) => setTimeout(r, 50));
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
        schema: t.object({ v: t.integer() }),
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

    // Give the handler's abort path a moment to execute and (without the
    // guard) try to overwrite the row.
    await new Promise((r) => setTimeout(r, 100));

    const final = await app.executions.findById(id);
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

    // Sweep picks it up and runs attempt 2 → terminal.
    await (provider as any).sweep();
    await new Promise((r) => setTimeout(r, 100));
    expect(attempts).toBe(2);
    const rows2 = await app.executions.findMany({
      where: { jobName: { eq: "App.tick" } },
    });
    expect(rows2[0].status).toBe("error");
  });
});

// ---------------------------------------------------------------------------

describe("$job — dispatchMany (queue mode)", () => {
  it("pushMany hands the dispatcher a single batch", async ({ expect }) => {
    const alepha = makeApp();
    class App {
      bulk = $job({
        schema: t.object({ n: t.integer() }),
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
        schema: t.object({ v: t.integer() }),
        priority: "high",
        record: "all",
        handler: async () => {},
      });
    }
    const app = alepha.inject(App);
    await alepha.start();

    const id = await app.work.push({ v: 1 });
    // Wait for the handler to finish so the row is `ok` (record: all keeps it).
    await new Promise((r) => setTimeout(r, 100));

    const { JobService } = await import("../services/JobService.ts");
    const svc = alepha.inject(JobService);
    const resource = await svc.getExecution(id);
    expect(resource.priority).toBe("high");
    expect(typeof resource.priority).toBe("string");
  });
});
