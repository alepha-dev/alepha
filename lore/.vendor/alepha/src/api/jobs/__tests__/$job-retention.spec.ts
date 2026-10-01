import { Alepha, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";

import {
  $job,
  AlephaApiJobs,
  JobProvider,
  JobService,
  jobConfig,
  jobExecutionEntity,
} from "../index.ts";

class TestJobProvider extends JobProvider {
  public testTrimRingBuffers = this.trimRingBuffers.bind(this);
}

const boot = () => {
  const alepha = Alepha.create()
    .with({ provide: JobProvider, use: TestJobProvider })
    .with(AlephaOrmPostgres)
    .with(AlephaApiJobs);

  // Pause before start so cron jobs never arm timers against the wall clock.
  alepha.inject(DateTimeProvider).pause();

  return alepha;
};

/**
 * Poll `fn` until `predicate` returns true, or throw on timeout.
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

/**
 * Insert `count` terminal rows, one hour apart, the newest `hoursAgo` hours
 * before now. Returns their ids newest first.
 */
const seed = async (
  alepha: Alepha,
  jobName: string,
  status: "ok" | "error" | "cancelled",
  count: number,
  hoursAgo = 0,
): Promise<string[]> => {
  const repo = alepha.inject(TestRepo).executions;
  const now = alepha.inject(DateTimeProvider).now();
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const at = now.subtract(hoursAgo + i, "hour").toISOString();
    const row = await repo.create({
      jobName,
      status,
      maxAttempts: 1,
      createdAt: at,
      updatedAt: at,
      completedAt: at,
    });
    ids.push(row.id);
  }
  return ids;
};

class TestRepo {
  executions = $repository(jobExecutionEntity);
}

const idsOf = async (
  alepha: Alepha,
  jobName: string,
  status: "ok" | "error" | "cancelled",
): Promise<string[]> =>
  (
    await alepha.inject(TestRepo).executions.findMany({
      where: { jobName: { eq: jobName }, status: { eq: status } },
      columns: ["id"],
    })
  )
    .map((r) => r.id)
    .sort();

describe("$job retention: registration", () => {
  const refused = [
    ["an empty rule", { ok: {} }, /neither 'last' nor 'days'/],
    ["last of 0", { ok: { last: 0 } }, /at least 1/],
    ["a fractional last", { error: { last: 1.5 } }, /at least 1/],
    ["days of 0", { error: { days: 0 } }, /positive/],
    ["negative days", { ok: { days: -3 } }, /positive/],
  ] as const;

  for (const [label, retention, message] of refused) {
    it(`refuses ${label}, naming the job`, async ({ expect }) => {
      const alepha = boot();
      class BadApp {
        work = $job({
          description: "A job under test.",
          name: "bad.work",
          schema: z.object({ v: z.integer() }),
          retention: retention as any,
          handler: async () => {},
        });
      }
      let error: unknown;
      try {
        alepha.inject(BadApp);
      } catch (e) {
        error = e;
      }
      expect(String((error as Error | undefined)?.message)).toMatch(message);
      expect(String((error as Error | undefined)?.message)).toMatch(
        /bad\.work/,
      );
    });
  }

  it("accepts false for either status", async ({ expect }) => {
    const alepha = boot();
    class QuietApp {
      work = $job({
        name: "quiet-app.work",
        description: "A job under test.",
        schema: z.object({ v: z.integer() }),
        retention: { ok: false, error: false },
        handler: async () => {},
      });
    }
    expect(() => alepha.inject(QuietApp)).not.toThrow();
  });
});

describe("$job retention: defaults by cadence", () => {
  const cases = [
    ["*/5 * * * *", "frequent", 12],
    ["*/15 * * * *", "frequent", 12],
    ["*/30 * * * *", "hourly", 24],
    ["0 * * * *", "hourly", 24],
    ["0 3 * * *", "daily", 7],
    // Its weekend gap is not its shortest: a weekday cron is daily.
    ["0 9 * * 1-5", "daily", 7],
    ["0 0 * * 0", "slower", 5],
    ["0 0 1 * *", "slower", 5],
  ] as const;

  for (const [cron, cadence, last] of cases) {
    it(`'${cron}' is ${cadence} and keeps its last ${last} successes`, async ({
      expect,
    }) => {
      const alepha = boot();
      class CronApp {
        tick = $job({
          name: "cron-app.tick",
          description: "A job under test.",
          cron,
          handler: async () => {},
        });
      }
      alepha.inject(CronApp);
      const retention = alepha
        .inject(JobProvider)
        .describeRetention("cron-app.tick");
      expect(retention).toEqual({
        ok: { last },
        error: { days: 30 },
        source: { ok: "default", error: "default" },
        cadence,
      });
    });
  }

  it("a queue job keeps no successes and 30 days of failures", async ({
    expect,
  }) => {
    const alepha = boot();
    class QueueApp {
      work = $job({
        name: "queue-app.work",
        description: "A job under test.",
        schema: z.object({ v: z.integer() }),
        handler: async () => {},
      });
    }
    alepha.inject(QueueApp);
    expect(
      alepha.inject(JobProvider).describeRetention("queue-app.work"),
    ).toEqual({
      ok: false,
      error: { days: 30 },
      source: { ok: "default", error: "default" },
    });
  });

  it("a declared status replaces its default and says so, the other keeps it", async ({
    expect,
  }) => {
    const alepha = boot();
    class MixedApp {
      tick = $job({
        name: "mixed-app.tick",
        description: "A job under test.",
        cron: "0 3 * * *",
        retention: { error: { last: 50, days: 90 } },
        handler: async () => {},
      });
    }
    alepha.inject(MixedApp);
    expect(
      alepha.inject(JobProvider).describeRetention("mixed-app.tick"),
    ).toEqual({
      ok: { last: 7 },
      error: { last: 50, days: 90 },
      source: { ok: "default", error: "job" },
      cadence: "daily",
    });
  });

  it("the registration payload carries the rule, with days evaluated", async ({
    expect,
  }) => {
    const alepha = boot();
    let window = 12;
    class LiveApp {
      work = $job({
        name: "live-app.work",
        description: "A job under test.",
        schema: z.object({ v: z.integer() }),
        retention: { ok: { days: () => window } },
        handler: async () => {},
      });
    }
    alepha.inject(LiveApp);
    await alepha.start();

    const service = alepha.inject(JobService);
    const first = (await service.listJobs()).find(
      (j) => j.name === "live-app.work",
    );
    expect(first?.retention.ok).toEqual({ days: 12 });

    window = 3;
    const second = (await service.listJobs()).find(
      (j) => j.name === "live-app.work",
    );
    expect(second?.retention).toEqual({
      ok: { days: 3 },
      error: { days: 30 },
      source: { ok: "job", error: "default" },
    });
  });
});

describe("$job retention: the trim", () => {
  it("a daily cron keeps its last 7 successes", async ({ expect }) => {
    const alepha = boot().with(TestRepo);
    class DailyApp {
      tick = $job({
        name: "daily-app.tick",
        description: "A job under test.",
        cron: "0 3 * * *",
        handler: async () => {},
      });
    }
    alepha.inject(DailyApp);
    await alepha.start();

    const ids = await seed(alepha, "daily-app.tick", "ok", 10);
    await (alepha.inject(JobProvider) as TestJobProvider).testTrimRingBuffers();

    expect(await idsOf(alepha, "daily-app.tick", "ok")).toEqual(
      ids.slice(0, 7).sort(),
    );
  });

  it("a */5 cron keeps its last 12 successes", async ({ expect }) => {
    const alepha = boot().with(TestRepo);
    class FastApp {
      tick = $job({
        name: "fast-app.tick",
        description: "A job under test.",
        cron: "*/5 * * * *",
        handler: async () => {},
      });
    }
    alepha.inject(FastApp);
    await alepha.start();

    const ids = await seed(alepha, "fast-app.tick", "ok", 20);
    await (alepha.inject(JobProvider) as TestJobProvider).testTrimRingBuffers();

    expect(await idsOf(alepha, "fast-app.tick", "ok")).toEqual(
      ids.slice(0, 12).sort(),
    );
  });

  it("failures older than their window go at the trim tick, under travel()", async ({
    expect,
  }) => {
    const alepha = boot().with(TestRepo);
    class FailingApp {
      work = $job({
        name: "failing-app.work",
        description: "A job under test.",
        schema: z.object({ v: z.integer() }),
        handler: async () => {},
      });
    }
    alepha.inject(FailingApp);
    await alepha.start();
    const dt = alepha.inject(DateTimeProvider);
    dt.pause();

    // Three failures now, then a month passes and two more arrive.
    const old = await seed(alepha, "failing-app.work", "error", 3);
    await dt.travel(31, "day");
    const recent = await seed(alepha, "failing-app.work", "error", 2);

    // The travel fired the hourly trim once already; run it again now that
    // the recent rows exist, and assert the end state only.
    await (alepha.inject(JobProvider) as TestJobProvider).testTrimRingBuffers();

    const left = await waitFor(
      () => idsOf(alepha, "failing-app.work", "error"),
      (ids) => ids.length === 2,
      { label: "old failures trimmed" },
    );
    expect(left).toEqual([...recent].sort());
    expect(left.some((id) => old.includes(id))).toBe(false);
  });

  it("the newest row of a cron survives its window, a queue job's does not", async ({
    expect,
  }) => {
    const alepha = boot().with(TestRepo);
    class MonthlyApp {
      tick = $job({
        name: "monthly-app.tick",
        description: "A job under test.",
        cron: "0 0 1 * *",
        handler: async () => {},
      });
    }
    class QueueApp {
      work = $job({
        name: "queue-app.work",
        description: "A job under test.",
        schema: z.object({ v: z.integer() }),
        handler: async () => {},
      });
    }
    alepha.inject(MonthlyApp);
    alepha.inject(QueueApp);
    await alepha.start();

    const cronIds = await seed(alepha, "monthly-app.tick", "error", 3, 24 * 40);
    await seed(alepha, "queue-app.work", "error", 3, 24 * 40);

    await (alepha.inject(JobProvider) as TestJobProvider).testTrimRingBuffers();

    expect(await idsOf(alepha, "monthly-app.tick", "error")).toEqual([
      cronIds[0],
    ]);
    expect(await idsOf(alepha, "queue-app.work", "error")).toEqual([]);
  });

  it("cancelled rows are trimmed by the failure rule", async ({ expect }) => {
    const alepha = boot().with(TestRepo);
    class CancelApp {
      work = $job({
        name: "cancel-app.work",
        description: "A job under test.",
        schema: z.object({ v: z.integer() }),
        retention: { error: { last: 2 } },
        handler: async () => {},
      });
    }
    alepha.inject(CancelApp);
    await alepha.start();

    const ids = await seed(alepha, "cancel-app.work", "cancelled", 5);
    await (alepha.inject(JobProvider) as TestJobProvider).testTrimRingBuffers();

    expect(await idsOf(alepha, "cancel-app.work", "cancelled")).toEqual(
      ids.slice(0, 2).sort(),
    );
  });

  it("maxRows caps a default rule, never a declared one", async ({
    expect,
  }) => {
    const alepha = boot().with(TestRepo);
    alepha.store.mut(jobConfig, (c) => ({
      ...c,
      retention: { ...c.retention, maxRows: 3 },
    }));
    class DefaultApp {
      work = $job({
        name: "default-app.work",
        description: "A job under test.",
        schema: z.object({ v: z.integer() }),
        handler: async () => {},
      });
    }
    class DeclaredApp {
      work = $job({
        name: "declared-app.work",
        description: "A job under test.",
        schema: z.object({ v: z.integer() }),
        retention: { error: { days: 30 } },
        handler: async () => {},
      });
    }
    alepha.inject(DefaultApp);
    alepha.inject(DeclaredApp);
    await alepha.start();

    const defaults = await seed(alepha, "default-app.work", "error", 6);
    await seed(alepha, "declared-app.work", "error", 6);
    await (alepha.inject(JobProvider) as TestJobProvider).testTrimRingBuffers();

    expect(await idsOf(alepha, "default-app.work", "error")).toEqual(
      defaults.slice(0, 3).sort(),
    );
    expect(await idsOf(alepha, "declared-app.work", "error")).toHaveLength(6);
  });

  it("a status that is not recorded loses whatever rows it had", async ({
    expect,
  }) => {
    const alepha = boot().with(TestRepo);
    class SilentApp {
      tick = $job({
        name: "silent-app.tick",
        description: "A job under test.",
        cron: "0 3 * * *",
        retention: { ok: false },
        handler: async () => {},
      });
    }
    alepha.inject(SilentApp);
    await alepha.start();

    await seed(alepha, "silent-app.tick", "ok", 4);
    const errors = await seed(alepha, "silent-app.tick", "error", 2);
    await (alepha.inject(JobProvider) as TestJobProvider).testTrimRingBuffers();

    expect(await idsOf(alepha, "silent-app.tick", "ok")).toEqual([]);
    expect(await idsOf(alepha, "silent-app.tick", "error")).toEqual(
      [...errors].sort(),
    );
  });
});

describe("$job retention: the run paths honour false", () => {
  it("a queue failure writes nothing when failures are not recorded", async ({
    expect,
  }) => {
    const alepha = boot().with(TestRepo);
    class DropApp {
      work = $job({
        name: "drop-app.work",
        description: "A job under test.",
        schema: z.object({ v: z.integer() }),
        retention: { error: false },
        handler: async () => {
          throw new Error("nope");
        },
      });
    }
    const app = alepha.inject(DropApp);
    await alepha.start();

    const id = await app.work.push({ v: 1 });
    const rows = await waitFor(
      () =>
        alepha
          .inject(TestRepo)
          .executions.findMany({ where: { id: { eq: id } } }),
      (found) => found.length === 0,
      { label: "outbox row deleted on failure" },
    );
    expect(rows).toHaveLength(0);
  });

  it("an inline failure writes nothing when failures are not recorded, and still throws", async ({
    expect,
  }) => {
    const alepha = boot().with(TestRepo);
    class InlineDropApp {
      work = $job({
        name: "inline-drop-app.work",
        description: "A job under test.",
        schema: z.object({ v: z.integer() }),
        retention: { error: false },
        handler: async () => {
          throw new Error("refused");
        },
      });
    }
    const app = alepha.inject(InlineDropApp);
    await alepha.start();

    await expect(app.work.push({ v: 1 }, { inline: true })).rejects.toThrow(
      "refused",
    );
    const rows = await alepha.inject(TestRepo).executions.findMany({
      where: { jobName: { eq: "inline-drop-app.work" } },
    });
    expect(rows).toHaveLength(0);
  });

  it("a cron failure writes nothing when failures are not recorded", async ({
    expect,
  }) => {
    const alepha = boot().with(TestRepo);
    class CronDropApp {
      tick = $job({
        name: "cron-drop-app.tick",
        description: "A job under test.",
        cron: "0 3 * * *",
        retention: { error: false },
        handler: async () => {
          throw new Error("boom");
        },
      });
    }
    const app = alepha.inject(CronDropApp);
    await alepha.start();

    await app.tick.trigger();
    const rows = await alepha.inject(TestRepo).executions.findMany({
      where: { jobName: { eq: "cron-drop-app.tick" } },
    });
    expect(rows).toHaveLength(0);
  });

  it("a cancelled pending row goes when failures are not recorded", async ({
    expect,
  }) => {
    const alepha = boot().with(TestRepo);
    class CancelDropApp {
      work = $job({
        name: "cancel-drop-app.work",
        description: "A job under test.",
        schema: z.object({ v: z.integer() }),
        retention: { error: false },
        handler: async () => {},
      });
    }
    const app = alepha.inject(CancelDropApp);
    await alepha.start();

    const id = await app.work.push({ v: 1 }, { delay: [1, "hour"] });
    await app.work.cancel(id);

    const rows = await alepha.inject(TestRepo).executions.findMany({
      where: { id: { eq: id } },
    });
    expect(rows).toHaveLength(0);
  });

  it("a cron that declares retry keeps its successes by its cadence, not the queue default", async ({
    expect,
  }) => {
    const alepha = boot().with(TestRepo);
    let runs = 0;
    class RetryCronApp {
      tick = $job({
        name: "retry-cron-app.tick",
        description: "A job under test.",
        cron: "0 3 * * *",
        retry: { retries: 2 },
        handler: async () => {
          runs++;
        },
      });
    }
    const app = alepha.inject(RetryCronApp);
    await alepha.start();

    await app.tick.trigger();
    // The tick went through the outbox, which deletes a queue job's success.
    const rows = await waitFor(
      () => idsOf(alepha, "retry-cron-app.tick", "ok"),
      (ids) => ids.length === 1,
      { label: "cron+retry success kept" },
    );
    expect(runs).toBe(1);
    expect(rows).toHaveLength(1);
    expect(
      alepha.inject(JobProvider).describeRetention("retry-cron-app.tick").ok,
    ).toEqual({ last: 7 });
  });
});
