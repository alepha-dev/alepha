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
  jobConfig,
  jobExecutionEntity,
} from "../index.ts";

/**
 * Steps where they meet what `$job` already does: the kinds of run that
 * refuse them, names, results, reschedule, timeout, cancel, terminal writes,
 * dedup and logs. One rule per case, on Postgres: the dialect matrix is
 * `$job-steps.spec.ts`.
 */

async function waitFor<T>(
  fn: () => Promise<T> | T,
  predicate: (v: T) => boolean,
  { timeout = 5000, interval = 10, label = "condition" } = {},
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

const makeApp = () =>
  Alepha.create().with(AlephaOrmPostgres).with(AlephaApiJobs);

const fast: JobRetryBackoff = { initial: [5, "millisecond"], jitter: false };
const idSchema = z.object({ id: z.text() });

/**
 * A provider whose executions repository counts the calls made on it, to
 * prove what a run with no steps costs.
 */
class CountingProvider extends JobProvider {
  calls: string[] = [];
  constructor() {
    super();
    const repository = this.executions;
    (this as unknown as { executions: unknown }).executions = new Proxy(
      repository,
      {
        get: (target, prop, receiver) => {
          const value = Reflect.get(target, prop, receiver);
          if (typeof value !== "function") return value;
          return (...args: unknown[]) => {
            this.calls.push(String(prop));
            return value.apply(target, args);
          };
        },
      },
    );
  }
}

describe("job steps at the edges", () => {
  describe("where steps do not exist", () => {
    it("a cron job without retry refuses step.run", async ({ expect }) => {
      const alepha = makeApp();
      class App {
        executions = $repository(jobExecutionEntity);
        tick = $job({
          name: "edges.cron-plain",
          description: "A cron that tries a step.",
          cron: "0 0 1 1 *",
          handler: async ({ step }) => {
            await step.run("a", async () => 1);
          },
        });
      }
      const app = alepha.inject(App);
      await alepha.start();

      await app.tick.trigger();
      const [row] = await app.executions.findMany({
        where: { jobName: { eq: "edges.cron-plain" } },
      });
      expect(row?.status).toBe("error");
      expect(row?.error).toMatch(
        /a cron job has no steps, with or without 'retry'\. Push a queue job/,
      );
      await alepha.stop();
    });

    it("a cron job WITH retry refuses steps too, on its outbox row", async ({
      expect,
    }) => {
      const alepha = makeApp();
      let sleeps = 0;
      class App {
        executions = $repository(jobExecutionEntity);
        tick = $job({
          name: "edges.cron-retry",
          description: "A retried cron that tries a sleep.",
          cron: "0 0 1 1 *",
          retry: { retries: 0 },
          handler: async ({ step }) => {
            sleeps++;
            await step.sleep("wait", [1, "minute"]);
          },
        });
      }
      const app = alepha.inject(App);
      await alepha.start();

      await app.tick.trigger();
      const row = await waitFor(
        () =>
          app.executions
            .findMany({ where: { jobName: { eq: "edges.cron-retry" } } })
            .then((rows) => rows[0]),
        (r) => r?.status === "error",
        { label: "synthetic row failed" },
      );
      expect(sleeps).toBe(1);
      expect(row?.error).toMatch(/a cron job has no steps/);
      expect(row?.steps ?? null).toBe(null);
      await alepha.stop();
    });

    it("an inline push refuses steps and tells the caller", async ({
      expect,
    }) => {
      const alepha = makeApp();
      class App {
        work = $job({
          name: "edges.inline",
          description: "Tries a step inline.",
          schema: idSchema,
          handler: async ({ step }) => {
            await step.run("a", async () => 1);
          },
        });
      }
      const app = alepha.inject(App);
      await alepha.start();

      await expect(
        app.work.push({ id: "x" }, { inline: true }),
      ).rejects.toThrow(/an inline push runs once for a waiting caller/);
      await alepha.stop();
    });

    it("a job that calls no step makes no extra read or write", async ({
      expect,
    }) => {
      const alepha = Alepha.create()
        .with(AlephaOrmPostgres)
        .with({ provide: JobProvider, use: CountingProvider })
        .with(AlephaApiJobs);
      let ran = 0;
      class App {
        executions = $repository(jobExecutionEntity);
        plain = $job({
          name: "edges.no-steps",
          description: "Calls no step.",
          schema: idSchema,
          retention: { ok: { last: 10 } },
          handler: async () => {
            ran++;
          },
        });
        stepped = $job({
          name: "edges.one-step",
          description: "Calls one step.",
          schema: idSchema,
          retention: { ok: { last: 10 } },
          handler: async ({ step }) => {
            await step.run("a", async () => ran++);
          },
        });
      }
      const app = alepha.inject(App);
      const provider = alepha.inject(CountingProvider);
      await alepha.start();

      provider.calls = [];
      const id = await app.plain.push({ id: "x" });
      await waitFor(
        () => app.executions.findById(id),
        (r) => r?.status === "ok",
        { label: "plain ok" },
      );
      const plainCalls = provider.calls.filter((c) => c !== "findMany");
      // create (push), findById + updateOne (claim), updateOne (ok).
      expect(plainCalls).toEqual([
        "create",
        "findById",
        "updateOne",
        "updateOne",
      ]);

      provider.calls = [];
      const id2 = await app.stepped.push({ id: "x" });
      await waitFor(
        () => app.executions.findById(id2),
        (r) => r?.status === "ok",
        { label: "stepped ok" },
      );
      // The same, plus one write for the step: no read.
      expect(provider.calls.filter((c) => c !== "findMany")).toEqual([
        "create",
        "findById",
        "updateOne",
        "updateOne",
        "updateOne",
      ]);
      expect(ran).toBe(2);
      await alepha.stop();
    });
  });

  describe("names", () => {
    const run = async (handler: Parameters<typeof $job>[0]["handler"]) => {
      const alepha = makeApp();
      class App {
        executions = $repository(jobExecutionEntity);
        work = $job({
          name: "edges.names",
          description: "Names steps.",
          schema: idSchema,
          handler,
        });
      }
      const app = alepha.inject(App);
      await alepha.start();
      const id = await app.work.push({ id: "x" });
      const row = await waitFor(
        () => app.executions.findById(id),
        (r) => r?.status === "error",
        { label: "failed" },
      );
      await alepha.stop();
      return row;
    };

    it("refuses a name outside the pattern, and one over 64 characters", async ({
      expect,
    }) => {
      const bad = await run(async ({ step }) => {
        await step.run("Capture Payment", async () => 1);
      });
      expect(bad?.error).toMatch(/named a step 'Capture Payment'/);
      const long = await run(async ({ step }) => {
        await step.run("a".repeat(65), async () => 1);
      });
      expect(long?.error).toMatch(/1 to 64 characters/);
    });

    it("refuses a name used twice in one run, with the loop hint", async ({
      expect,
    }) => {
      let charges = 0;
      const row = await run(async ({ step }) => {
        for (let i = 0; i < 2; i++) {
          await step.run("charge", async () => {
            charges++;
          });
        }
      });
      expect(row?.error).toMatch(/used the step name 'charge' twice/);
      expect(row?.error).toContain("step.run(`charge.${i}`, ...)");
      expect(charges).toBe(1);
    });

    it("accepts dotted names for loop iterations", async ({ expect }) => {
      const alepha = makeApp();
      const seen: number[] = [];
      class App {
        executions = $repository(jobExecutionEntity);
        work = $job({
          name: "edges.loop",
          description: "Loops over named steps.",
          schema: idSchema,
          retention: { ok: { last: 10 } },
          handler: async ({ step }) => {
            for (let i = 0; i < 3; i++) {
              seen.push(await step.run(`charge.${i}`, async () => i * 10));
            }
          },
        });
      }
      const app = alepha.inject(App);
      await alepha.start();
      const id = await app.work.push({ id: "x" });
      const row = await waitFor(
        () => app.executions.findById(id),
        (r) => r?.status === "ok",
        { label: "ok" },
      );
      expect(seen).toEqual([0, 10, 20]);
      expect(Object.keys(row?.steps ?? {})).toEqual([
        "charge.0",
        "charge.1",
        "charge.2",
      ]);
      await alepha.stop();
    });
  });

  describe("results", () => {
    const refused = async (value: unknown) => {
      const alepha = makeApp();
      class App {
        executions = $repository(jobExecutionEntity);
        work = $job({
          name: "edges.results",
          description: "Returns a value a step cannot store.",
          schema: idSchema,
          handler: async ({ step }) => {
            await step.run("value", async () => value);
          },
        });
      }
      const app = alepha.inject(App);
      await alepha.start();
      const id = await app.work.push({ id: "x" });
      const row = await waitFor(
        () => app.executions.findById(id),
        (r) => r?.status === "error",
        { label: "failed" },
      );
      await alepha.stop();
      return row;
    };

    it("refuses a Date, naming the step and the type", async ({ expect }) => {
      const row = await refused({ at: new Date() });
      expect(row?.error).toMatch(
        /step 'value': result\.at is a Date.*date\.toISOString\(\)/,
      );
      expect(row?.steps ?? null).toBe(null);
    });

    it("refuses a Map, a class instance, a bigint, NaN and undefined in an array", async ({
      expect,
    }) => {
      class Money {
        amount = 1;
      }
      expect((await refused(new Map()))?.error).toMatch(/result is a Map/);
      expect((await refused({ m: new Money() }))?.error).toMatch(
        /result\.m is a Money/,
      );
      expect((await refused(10n))?.error).toMatch(/result is a bigint/);
      expect((await refused([Number.NaN]))?.error).toMatch(
        /result\[0\] is NaN/,
      );
      expect((await refused([1, undefined]))?.error).toMatch(
        /result\[1\] is undefined/,
      );
    });

    it("holds a result to stepResultMaxBytes and the run to stepsMaxBytes, failing into the retry path", async ({
      expect,
    }) => {
      const alepha = makeApp();
      alepha.store.mut(jobConfig, (c) => ({
        ...c,
        stepResultMaxBytes: 100,
        stepsMaxBytes: 250,
      }));
      let tries = 0;
      class App {
        executions = $repository(jobExecutionEntity);
        big = $job({
          name: "edges.big-result",
          description: "Returns too much.",
          schema: idSchema,
          retry: { retries: 1, backoff: fast },
          handler: async ({ step }) => {
            await step.run("big", async () => {
              tries++;
              return "x".repeat(200);
            });
          },
        });
        many = $job({
          name: "edges.many-results",
          description: "Accumulates too much.",
          schema: idSchema,
          handler: async ({ step }) => {
            for (let i = 0; i < 5; i++) {
              await step.run(`part.${i}`, async () => "y".repeat(50));
            }
          },
        });
      }
      const app = alepha.inject(App);
      await alepha.start();

      const id = await app.big.push({ id: "x" });
      const big = await waitFor(
        () => app.executions.findById(id),
        (r) => r?.status === "error",
        { label: "big failed" },
      );
      expect(tries).toBe(2);
      expect(big?.error).toMatch(/over jobConfig\.stepResultMaxBytes \(100\)/);

      const id2 = await app.many.push({ id: "x" });
      const many = await waitFor(
        () => app.executions.findById(id2),
        (r) => r?.status === "error",
        { label: "many failed" },
      );
      expect(many?.error).toMatch(/over jobConfig\.stepsMaxBytes \(250\)/);
      expect(Object.keys(many?.steps ?? {}).length).toBeGreaterThan(0);
      await alepha.stop();
    });
  });

  describe("with what exists", () => {
    it("every reschedule clears steps, so the next iteration runs them again", async ({
      expect,
    }) => {
      const alepha = makeApp();
      const runs: number[] = [];
      class App {
        executions = $repository(jobExecutionEntity);
        work = $job({
          name: "edges.reschedule",
          description: "Reschedules itself once, without a new payload.",
          schema: idSchema,
          retention: { ok: { last: 10 } },
          handler: async ({ step, reschedule }) => {
            const n = await step.run("count", async () => runs.length + 1);
            runs.push(n);
            if (runs.length === 1) reschedule({ delay: [1, "minute"] });
          },
        });
      }
      const app = alepha.inject(App);
      await alepha.start();

      const id = await app.work.push({ id: "x" });
      const parked = await waitFor(
        () => app.executions.findById(id),
        (r) => r?.status === "scheduled",
        { label: "rescheduled" },
      );
      expect(parked?.steps ?? null).toBe(null);
      await alepha.inject(DateTimeProvider).travel([2, "minute"]);
      await waitFor(
        () => app.executions.findById(id),
        (r) => r?.status === "ok",
        { label: "second iteration done" },
      );
      expect(runs).toEqual([1, 2]);
      await alepha.stop();
    });

    it("refuses step.sleep after reschedule() in one run", async ({
      expect,
    }) => {
      const alepha = makeApp();
      class App {
        executions = $repository(jobExecutionEntity);
        work = $job({
          name: "edges.reschedule-then-sleep",
          description: "Reschedules, then sleeps.",
          schema: idSchema,
          handler: async ({ step, reschedule }) => {
            reschedule({ delay: [1, "minute"] });
            await step.sleep("wait", [1, "minute"]);
          },
        });
      }
      const app = alepha.inject(App);
      await alepha.start();
      const id = await app.work.push({ id: "x" });
      const row = await waitFor(
        () => app.executions.findById(id),
        (r) => r?.status === "error",
        { label: "failed" },
      );
      expect(row?.error).toMatch(/after reschedule\(\) in the same run/);
      await alepha.stop();
    });

    it("a step cut by the timeout writes nothing and runs again", async ({
      expect,
    }) => {
      const alepha = makeApp();
      let slowTries = 0;
      class App {
        executions = $repository(jobExecutionEntity);
        work = $job({
          name: "edges.timeout",
          description: "A step slower than the timeout.",
          schema: idSchema,
          timeout: [100, "millisecond"],
          retry: { retries: 1, backoff: fast },
          handler: async ({ step }) => {
            await step.run("quick", async () => "done");
            await step.run("slow", async () => {
              slowTries++;
              await new Promise((r) => setTimeout(r, 400));
            });
          },
        });
      }
      const app = alepha.inject(App);
      await alepha.start();
      const id = await app.work.push({ id: "x" });
      const row = await waitFor(
        () => app.executions.findById(id),
        (r) => r?.status === "error",
        { label: "timed out twice" },
      );
      // Let the abandoned step functions finish: nothing may land.
      await new Promise((r) => setTimeout(r, 500));
      const after = await app.executions.findById(id);
      expect(slowTries).toBe(2);
      expect(row?.steps?.quick?.result).toBe("done");
      expect(after?.steps?.slow).toBeUndefined();
      await alepha.stop();
    });

    it("a cancel during a step wins: the step writes nothing", async ({
      expect,
    }) => {
      const alepha = makeApp();
      let release!: () => void;
      const released = new Promise<void>((r) => {
        release = r;
      });
      let entered!: () => void;
      const inside = new Promise<void>((r) => {
        entered = r;
      });
      let cancels = 0;
      let afterRan = false;
      class App {
        executions = $repository(jobExecutionEntity);
        onCancel = $hook({
          on: "job:cancel",
          handler: () => {
            cancels++;
          },
        });
        work = $job({
          name: "edges.cancel",
          description: "Cancelled inside a step.",
          schema: idSchema,
          handler: async ({ step }) => {
            await step.run("held", async () => {
              entered();
              // Ignores its signal on purpose: its write must still miss.
              await released;
              return "late";
            });
            afterRan = true;
          },
        });
      }
      const app = alepha.inject(App);
      await alepha.start();
      const id = await app.work.push({ id: "x" });
      await inside;
      await app.work.cancel(id);
      release();
      await waitFor(
        () => cancels,
        (n) => n === 1,
        { label: "job:cancel" },
      );
      const row = await app.executions.findById(id);
      expect(row?.status).toBe("cancelled");
      expect(row?.steps?.held).toBeUndefined();
      expect(afterRan).toBe(false);
      await alepha.stop();
    });

    it("the retry write keeps the steps, and retry.when sees the step's error", async ({
      expect,
    }) => {
      const alepha = makeApp();
      const seen: string[] = [];
      class App {
        executions = $repository(jobExecutionEntity);
        work = $job({
          name: "edges.retry-keeps",
          description: "Fails after a step, retried an hour later.",
          schema: idSchema,
          retry: {
            retries: 1,
            backoff: { initial: [1, "hour"], jitter: false },
            when: (error) => {
              seen.push(error.message);
              return true;
            },
          },
          handler: async ({ step }) => {
            await step.run("a", async () => ({ kept: true }));
            await step.run("b", async () => {
              throw new AlephaError("b failed");
            });
          },
        });
      }
      const app = alepha.inject(App);
      await alepha.start();
      const id = await app.work.push({ id: "x" });
      const row = await waitFor(
        () => app.executions.findById(id),
        (r) => r?.status === "scheduled",
        { label: "retry scheduled" },
      );
      expect(row?.steps?.a?.result).toEqual({ kept: true });
      expect(seen).toEqual(["b failed"]);
      await alepha.stop();
    });

    it("keyed dedup still holds while a run with steps is running", async ({
      expect,
    }) => {
      const alepha = makeApp();
      let release!: () => void;
      const released = new Promise<void>((r) => {
        release = r;
      });
      let entered!: () => void;
      const inside = new Promise<void>((r) => {
        entered = r;
      });
      class App {
        executions = $repository(jobExecutionEntity);
        work = $job({
          name: "edges.dedup",
          description: "Keyed, held inside a step.",
          schema: idSchema,
          retention: { ok: { last: 10 } },
          handler: async ({ step }) => {
            await step.run("held", async () => {
              entered();
              await released;
            });
          },
        });
      }
      const app = alepha.inject(App);
      await alepha.start();
      const id = await app.work.push({ id: "x" }, { key: "k" });
      await inside;
      expect(await app.work.push({ id: "x" }, { key: "k" })).toBe(id);
      release();
      await waitFor(
        () => app.executions.findById(id),
        (r) => r?.status === "ok",
        { label: "ok" },
      );
      await alepha.stop();
    });

    it("each completed step leaves a DEBUG breadcrumb in the run's logs", async ({
      expect,
    }) => {
      const alepha = makeApp();
      class App {
        executions = $repository(jobExecutionEntity);
        work = $job({
          name: "edges.breadcrumbs",
          description: "Two steps, then a failure.",
          schema: idSchema,
          handler: async ({ step }) => {
            await step.run("first", async () => 1);
            await step.run("second", async () => 2);
            throw new AlephaError("after both");
          },
        });
      }
      const app = alepha.inject(App);
      await alepha.start();
      const id = await app.work.push({ id: "x" });
      const row = await waitFor(
        () => app.executions.findById(id),
        (r) => r?.status === "error",
        { label: "failed" },
      );
      const crumbs = (row?.logs ?? [])
        .map((entry) => entry.message)
        .filter((message) => /^step \S+ ok in \d+ms$/.test(message));
      expect(crumbs).toHaveLength(2);
      expect(crumbs[0]).toMatch(/^step first ok in/);
      expect(
        row?.logs?.find((e) => e.message.startsWith("step first"))?.level,
      ).toBe("DEBUG");
      await alepha.stop();
    });
  });
});
