import { $hook, Alepha, AlephaError, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";

import {
  $job,
  AlephaApiJobs,
  JobProvider,
  type JobRetryBackoff,
  jobExecutionEntity,
} from "../index.ts";

/**
 * Direct mode on purpose: the reschedule seam lives in the provider, and the
 * local promoting timer is what `travel()` fires.
 */
const makeApp = () =>
  Alepha.create().with(AlephaOrmPostgres).with(AlephaApiJobs);

/**
 * Poll `fn` until `predicate` holds, or throw on timeout. Fixed sleeps race
 * the in-process dispatcher under load; polling does not.
 */
async function waitFor<T>(
  fn: () => Promise<T> | T,
  predicate: (v: T) => boolean,
  { timeout = 3000, interval = 10, label = "condition" } = {},
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

/**
 * A latch a test opens by hand, to hold a handler in `running` while the
 * test acts on the row from outside.
 */
const latch = () => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  let entered!: () => void;
  const inside = new Promise<void>((resolve) => {
    entered = resolve;
  });
  return { opened, open, inside, entered };
};

const stageSchema = z.object({ id: z.text(), stage: z.integer().optional() });

// ---------------------------------------------------------------------------

describe("$job — reschedule", () => {
  it("re-parks the same execution on the next stage, keeping its key and id", async ({
    expect,
  }) => {
    const alepha = makeApp();
    const stages: number[] = [];
    let successes = 0;
    class App {
      executions = $repository(jobExecutionEntity);
      onSuccess = $hook({
        on: "job:success",
        handler: async () => {
          successes++;
        },
      });
      work = $job({
        name: "reschedule.repark",
        schema: stageSchema,
        handler: async ({ payload, reschedule }) => {
          const stage = payload.stage ?? 1;
          stages.push(stage);
          if (stage === 1) {
            reschedule({
              delay: [1, "minute"],
              payload: { ...payload, stage: 2 },
            });
          }
        },
      });
    }
    const app = alepha.inject(App);
    await alepha.start();

    const id = await app.work.push({ id: "a" }, { key: "repark-a" });
    const parked = await waitFor(
      () => app.executions.findById(id),
      (r) => r?.status === "scheduled" && r.payload?.stage === 2,
      { label: "parked on stage 2" },
    );
    expect(parked?.key).toBe("repark-a");
    expect(parked?.attempt).toBe(0);
    expect(new Date(parked!.scheduledAt!).getTime()).toBeGreaterThan(
      Date.now() + 50_000,
    );
    // The key stays live while the row is parked: a second keyed push lands
    // on the same execution instead of starting another sequence.
    expect(await app.work.push({ id: "a" }, { key: "repark-a" })).toBe(id);
    expect(stages).toEqual([1]);
    // A reschedule is not a success.
    expect(successes).toBe(0);

    await alepha.inject(DateTimeProvider).travel([2, "minute"]);
    await waitFor(
      () => stages.length,
      (n) => n === 2,
      { label: "stage 2 ran" },
    );
    // `record: "error"` by default, so the finished row is deleted.
    await waitFor(
      () => app.executions.findById(id),
      (r) => r == null,
      {
        label: "row gone after the last stage",
      },
    );
    expect(successes).toBe(1);
  });

  it("is a no-op after a cancel that landed during the handler", async ({
    expect,
  }) => {
    const alepha = makeApp();
    const l = latch();
    let calls = 0;
    let finished = false;
    class App {
      executions = $repository(jobExecutionEntity);
      work = $job({
        name: "reschedule.cancelled",
        schema: stageSchema,
        handler: async ({ reschedule }) => {
          calls++;
          l.entered();
          await l.opened;
          reschedule({ delay: [1, "minute"] });
          finished = true;
        },
      });
    }
    const app = alepha.inject(App);
    await alepha.start();

    const id = await app.work.push({ id: "b" }, { key: "cancelled-b" });
    await l.inside;
    await app.work.cancel(id);
    l.open();
    await waitFor(
      () => finished,
      (v) => v,
      { label: "handler finished" },
    );

    const row = await waitFor(
      () => app.executions.findById(id),
      (r) => r?.status === "cancelled",
      { label: "row stays cancelled" },
    );
    // The ORM reads a SQL NULL back as `undefined` on a nullable column.
    expect(row?.key ?? null).toBeNull();
    await alepha.inject(DateTimeProvider).travel([2, "minute"]);
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toBe(1);
  });

  it("loses to a throw: the retry path runs on the old payload", async ({
    expect,
  }) => {
    const alepha = makeApp();
    class App {
      executions = $repository(jobExecutionEntity);
      work = $job({
        name: "reschedule.throws",
        schema: stageSchema,
        retry: {
          retries: 2,
          backoff: { initial: [1, "minute"], jitter: false },
        },
        handler: async ({ payload, reschedule }) => {
          reschedule({ delay: [1, "hour"], payload: { ...payload, stage: 2 } });
          throw new AlephaError("boom");
        },
      });
    }
    const app = alepha.inject(App);
    await alepha.start();

    const id = await app.work.push({ id: "c" }, { key: "throws-c" });
    const row = await waitFor(
      () => app.executions.findById(id),
      (r) => r?.status === "scheduled",
      { label: "retry scheduled" },
    );
    expect(row?.attempt).toBe(1);
    expect(row?.payload?.stage).toBeUndefined();
    expect(row?.error).toBe("boom");
    // The retry's own curve, not the hour the discarded reschedule asked for.
    const inMs = new Date(row!.scheduledAt!).getTime() - Date.now();
    expect(inMs).toBeGreaterThan(55_000);
    expect(inMs).toBeLessThan(65_000);
  });

  it("refuses from a cron tick", async ({ expect }) => {
    const alepha = makeApp();
    let caught: unknown;
    class App {
      tick = $job({
        name: "reschedule.cron",
        cron: "0 0 * * *",
        handler: async ({ reschedule }) => {
          try {
            reschedule({ delay: [1, "minute"] });
          } catch (e) {
            caught = e;
          }
        },
      });
    }
    const app = alepha.inject(App);
    await alepha.start();
    await app.tick.trigger();
    expect(caught).toBeInstanceOf(AlephaError);
  });

  it("refuses from an inline push, which then fails terminally", async ({
    expect,
  }) => {
    const alepha = makeApp();
    class App {
      executions = $repository(jobExecutionEntity);
      work = $job({
        name: "reschedule.inline",
        schema: stageSchema,
        handler: async ({ reschedule }) => {
          reschedule({ delay: [1, "minute"] });
        },
      });
    }
    const app = alepha.inject(App);
    await alepha.start();
    await expect(app.work.push({ id: "d" }, { inline: true })).rejects.toThrow(
      AlephaError,
    );
    const rows = await app.executions.findMany({
      where: { jobName: { eq: "reschedule.inline" } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("error");
  });

  it("needs a delay or a scheduledAt, and a payload that fits the schema", async ({
    expect,
  }) => {
    const alepha = makeApp();
    const caught: unknown[] = [];
    let finished = false;
    class App {
      work = $job({
        name: "reschedule.invalid",
        schema: stageSchema,
        handler: async ({ reschedule }) => {
          try {
            reschedule({});
          } catch (e) {
            caught.push(e);
          }
          try {
            reschedule({ delay: [1, "minute"], payload: { id: 42 } as any });
          } catch (e) {
            caught.push(e);
          }
          finished = true;
        },
      });
    }
    const app = alepha.inject(App);
    await alepha.start();
    await app.work.push({ id: "e" });
    await waitFor(
      () => finished,
      (v) => v,
      { label: "handler finished" },
    );
    expect(caught).toHaveLength(2);
    expect(caught[0]).toBeInstanceOf(AlephaError);
    expect(caught[1]).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------

describe("$job — cancelByKey", () => {
  it("cancels a parked execution and returns its id; nothing to cancel is null", async ({
    expect,
  }) => {
    const alepha = makeApp();
    let calls = 0;
    class App {
      executions = $repository(jobExecutionEntity);
      work = $job({
        name: "cancelbykey.parked",
        schema: stageSchema,
        handler: async () => {
          calls++;
        },
      });
    }
    const app = alepha.inject(App);
    await alepha.start();

    const id = await app.work.push(
      { id: "f" },
      { key: "parked-f", delay: [1, "hour"] },
    );
    expect(
      await app.work.cancelByKey("parked-f", {
        cancelledBy: "system",
        cancelledByName: "test",
      }),
    ).toBe(id);
    const row = await app.executions.findById(id);
    expect(row?.status).toBe("cancelled");
    // The ORM reads a SQL NULL back as `undefined` on a nullable column.
    expect(row?.key ?? null).toBeNull();
    expect(row?.cancelledByName).toBe("test");

    expect(await app.work.cancelByKey("parked-f")).toBeNull();
    expect(await app.work.cancelByKey("never-pushed")).toBeNull();

    await alepha.inject(DateTimeProvider).travel([2, "hour"]);
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toBe(0);
  });

  it("leaves a running execution alone and returns null", async ({
    expect,
  }) => {
    const alepha = makeApp();
    const l = latch();
    class App {
      executions = $repository(jobExecutionEntity);
      work = $job({
        name: "cancelbykey.running",
        schema: stageSchema,
        handler: async () => {
          l.entered();
          await l.opened;
        },
      });
    }
    const app = alepha.inject(App);
    await alepha.start();

    const id = await app.work.push({ id: "g" }, { key: "running-g" });
    await l.inside;
    expect(await app.work.cancelByKey("running-g")).toBeNull();
    const running = await app.executions.findById(id);
    expect(running?.status).toBe("running");
    l.open();
    await waitFor(
      () => app.executions.findById(id),
      (r) => r == null,
      {
        label: "the run completed on its own",
      },
    );
  });

  it("cancel on the primitive passes the context through", async ({
    expect,
  }) => {
    const alepha = makeApp();
    class App {
      executions = $repository(jobExecutionEntity);
      work = $job({
        name: "cancelbykey.context",
        schema: stageSchema,
        handler: async () => {},
      });
    }
    const app = alepha.inject(App);
    await alepha.start();

    const id = await app.work.push({ id: "h" }, { delay: [1, "hour"] });
    await app.work.cancel(id, {
      cancelledBy: "system",
      cancelledByName: "ctx",
    });
    const row = await app.executions.findById(id);
    expect(row?.status).toBe("cancelled");
    expect(row?.cancelledByName).toBe("ctx");
  });
});

// ---------------------------------------------------------------------------

/**
 * `randomFraction` pinned to one half: with jitter the curve reads as half
 * its ceiling, without it as the ceiling itself.
 */
class HalfJitterJobProvider extends JobProvider {
  public testBackoff = (attempt: number, backoff?: JobRetryBackoff) =>
    this.retryBackoffMs(attempt, backoff);

  protected override randomFraction(): number {
    return 0.5;
  }
}

describe("$job — per-job retry backoff", () => {
  it("computes the job's own curve, capped by its max or the global one", async ({
    expect,
  }) => {
    // The substitution has to precede the module that registers the service.
    const alepha = Alepha.create()
      .with({ provide: JobProvider, use: HalfJitterJobProvider })
      .with(AlephaOrmPostgres)
      .with(AlephaApiJobs);
    await alepha.start();
    const provider = alepha.inject(JobProvider) as HalfJitterJobProvider;

    const minutes: JobRetryBackoff = {
      initial: [1, "minute"],
      factor: 4,
      jitter: false,
    };
    expect([1, 2, 3, 4].map((n) => provider.testBackoff(n, minutes))).toEqual([
      60_000, 240_000, 960_000,
      // The global 30-minute ceiling still applies when the job sets no max.
      1_800_000,
    ]);
    expect(provider.testBackoff(3, { ...minutes, max: [10, "minute"] })).toBe(
      600_000,
    );
    // Jitter is on by default, and it is the module's full jitter.
    expect(provider.testBackoff(1, { initial: [1, "minute"] })).toBe(30_000);
    // No per-job curve: the global one, base 5 s.
    expect(provider.testBackoff(1)).toBe(2_500);
  });

  it("a failing job retries on its own curve", async ({ expect }) => {
    const alepha = makeApp();
    class App {
      executions = $repository(jobExecutionEntity);
      work = $job({
        name: "backoff.own-curve",
        schema: stageSchema,
        retry: {
          retries: 1,
          backoff: { initial: [7, "minute"], jitter: false },
        },
        handler: async () => {
          throw new AlephaError("flaky");
        },
      });
    }
    const app = alepha.inject(App);
    await alepha.start();

    const id = await app.work.push({ id: "i" });
    const row = await waitFor(
      () => app.executions.findById(id),
      (r) => r?.status === "scheduled",
      { label: "retry scheduled" },
    );
    const inMs = new Date(row!.scheduledAt!).getTime() - Date.now();
    expect(inMs).toBeGreaterThan(7 * 60_000 - 5_000);
    expect(inMs).toBeLessThan(7 * 60_000 + 5_000);
  });

  it("rejects a factor below one at registration", async ({ expect }) => {
    const alepha = makeApp();
    class App {
      work = $job({
        name: "backoff.bad-factor",
        schema: stageSchema,
        retry: { retries: 1, backoff: { initial: [1, "second"], factor: 0.5 } },
        handler: async () => {},
      });
    }
    expect(() => alepha.inject(App)).toThrow(AlephaError);
  });
});
