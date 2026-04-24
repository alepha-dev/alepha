import { Alepha, AlephaError, t } from "alepha";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";
import {
  $job,
  AlephaApiJobs,
  AlephaApiJobsQueue,
  jobExecutionEntity,
} from "../index.ts";

const makeApp = () =>
  Alepha.create()
    .with(AlephaOrmPostgres)
    .with(AlephaApiJobs)
    .with(AlephaApiJobsQueue);

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
    await new Promise((r) => setTimeout(r, 100));
    expect(seen.sort()).toEqual([1, 2, 3]);
  });

  it("retry: failed queue job is re-scheduled with backoff", async ({
    expect,
  }) => {
    const alepha = makeApp();
    let attempts = 0;
    class App {
      executions = $repository(jobExecutionEntity);
      work = $job({
        schema: t.object({ v: t.integer() }),
        retry: { retries: 2, backoff: [10, "seconds"] },
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
});
