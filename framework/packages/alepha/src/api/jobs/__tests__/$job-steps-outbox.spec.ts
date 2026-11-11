import { $inject, Alepha, AlephaError, z } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { $repository, $transactional, DatabaseProvider } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";

import {
  $job,
  AlephaApiJobs,
  JobProvider,
  JobService,
  jobExecutionEntity,
} from "../index.ts";

/**
 * Steps and the rest of the outbox: the sweep's read, transactions, and
 * the admin's Retry.
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

const idSchema = z.object({ id: z.text() });

/**
 * Records the arguments of every `findMany` made on the executions
 * repository.
 */
class RecordingProvider extends JobProvider {
  reads: Array<Record<string, any>> = [];
  constructor() {
    super();
    const repository = this.executions;
    (this as unknown as { executions: unknown }).executions = new Proxy(
      repository,
      {
        get: (target, prop, receiver) => {
          const value = Reflect.get(target, prop, receiver);
          if (prop !== "findMany" || typeof value !== "function") return value;
          return (query: Record<string, any>) => {
            this.reads.push(query);
            return value.call(target, query);
          };
        },
      },
    );
  }
}

describe("job steps and the outbox", () => {
  it("the sweep reads named columns, never steps, payload or logs, and still promotes a sleeping row", async ({
    expect,
  }) => {
    const alepha = Alepha.create()
      .with(AlephaOrmPostgres)
      .with({ provide: JobProvider, use: RecordingProvider })
      .with(AlephaApiJobs);
    let after = 0;
    class App {
      executions = $repository(jobExecutionEntity);
      work = $job({
        name: "outbox.sweep-sleep",
        description: "Sleeps past the timer ceiling.",
        schema: idSchema,
        retention: { ok: { last: 10 } },
        handler: async ({ step }) => {
          await step.run("big", async () => "x".repeat(10_000));
          await step.sleep("long", [2, "day"]);
          after++;
        },
      });
    }
    const app = alepha.inject(App);
    const provider = alepha.inject(RecordingProvider);
    await alepha.start();

    const id = await app.work.push({ id: "x" });
    await waitFor(
      () => app.executions.findById(id),
      (r) => r?.status === "scheduled" && !!r.steps?.long,
      { label: "sleeping" },
    );
    provider.reads = [];
    await alepha.inject(DateTimeProvider).travel([49, "hour"]);
    await waitFor(
      () => app.executions.findById(id),
      (r) => r?.status === "ok",
      { label: "promoted and finished" },
    );
    expect(after).toBe(1);

    const sweepReads = provider.reads.filter(
      (q) => q.where?.status?.eq && q.limit !== undefined && !q.where.jobName,
    );
    expect(sweepReads.length).toBeGreaterThan(0);
    for (const read of sweepReads) {
      expect(new Set(read.columns)).toEqual(
        new Set([
          "attempt",
          "id",
          "jobName",
          "redispatchCount",
          "startedAt",
          "status",
          "updatedAt",
        ]),
      );
    }
    await alepha.stop();
  });

  describe("inside a transaction", () => {
    it("refuses step.run under $transactional(), naming the fix", async ({
      expect,
    }) => {
      const alepha = makeApp();
      let ran = 0;
      class App {
        executions = $repository(jobExecutionEntity);
        work = $job({
          name: "outbox.tx-refused",
          description: "Calls a step inside a transaction.",
          schema: idSchema,
          use: [$transactional()],
          handler: async ({ step }) => {
            await step.run("charge", async () => {
              ran++;
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
        { label: "failed" },
      );
      expect(ran).toBe(0);
      expect(row?.error).toMatch(
        /inside a transaction.*Open the transaction inside the step's function/,
      );
      await alepha.stop();
    });

    it("refuses step.sleep and step.sleepUntil there too", async ({
      expect,
    }) => {
      const alepha = makeApp();
      const errors: string[] = [];
      class App {
        db = $inject(DatabaseProvider);
        work = $job({
          name: "outbox.tx-sleep",
          description: "Sleeps inside a transaction.",
          schema: idSchema,
          handler: async ({ step }) => {
            await this.db.transactional(async () => {
              for (const call of [
                () => step.sleep("a", [1, "minute"]),
                () => step.sleepUntil("b", new Date(0)),
              ]) {
                try {
                  await call();
                } catch (error) {
                  errors.push((error as Error).message);
                }
              }
            });
          },
        });
      }
      const app = alepha.inject(App);
      await alepha.start();
      await app.work.push({ id: "x" });
      await waitFor(
        () => errors.length,
        (n) => n === 2,
        { label: "both refused" },
      );
      for (const message of errors) {
        expect(message).toMatch(/inside a transaction/);
      }
      await alepha.stop();
    });

    it("keeps a step's result when its transaction is opened inside the step and the handler throws later", async ({
      expect,
    }) => {
      const alepha = makeApp();
      let charges = 0;
      let failOnce = true;
      class App {
        db = $inject(DatabaseProvider);
        executions = $repository(jobExecutionEntity);
        work = $job({
          name: "outbox.tx-inside",
          description: "Opens its transaction inside the step.",
          schema: idSchema,
          retry: {
            retries: 1,
            backoff: { initial: [5, "millisecond"], jitter: false },
          },
          retention: { ok: { last: 10 } },
          handler: async ({ step }) => {
            await step.run("charge", () =>
              this.db.transactional(async () => {
                charges++;
                return { charged: true };
              }),
            );
            if (failOnce) {
              failOnce = false;
              throw new AlephaError("after the charge");
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
        { label: "ok after one retry" },
      );
      expect(charges).toBe(1);
      expect(row?.steps?.charge?.result).toEqual({ charged: true });
      await alepha.stop();
    });
  });

  describe("admin Retry resumes", () => {
    it("a run dead on its third step, retried, runs only the third", async ({
      expect,
    }) => {
      const alepha = makeApp();
      const calls = { a: 0, b: 0, c: 0 };
      let thirdFails = true;
      class App {
        executions = $repository(jobExecutionEntity);
        work = $job({
          name: "outbox.retry-resume",
          description: "Dies on its third step once.",
          schema: idSchema,
          retention: { ok: { last: 10 } },
          handler: async ({ step }) => {
            await step.run("a", async () => {
              calls.a++;
              return "A";
            });
            await step.run("b", async () => {
              calls.b++;
              return "B";
            });
            await step.run("c", async () => {
              calls.c++;
              if (thirdFails) throw new AlephaError("c is down");
              return "C";
            });
          },
        });
      }
      const app = alepha.inject(App);
      await alepha.start();

      const id = await app.work.push({ id: "x" }, { triggeredBy: "test" });
      const dead = await waitFor(
        () => app.executions.findById(id),
        (r) => r?.status === "error",
        { label: "dead" },
      );
      expect(Object.keys(dead?.steps ?? {}).sort()).toEqual(["a", "b"]);

      thirdFails = false;
      await alepha
        .inject(JobService)
        .retryExecution(id, { triggeredBy: "admin" });
      const fresh = await waitFor(
        () =>
          app.executions
            .findMany({ where: { jobName: { eq: "outbox.retry-resume" } } })
            .then((rows) => rows.find((r) => r.id !== id)),
        (r) => r?.status === "ok",
        { label: "retried row ok" },
      );
      expect(calls).toEqual({ a: 1, b: 1, c: 2 });
      expect(fresh?.steps?.a?.result).toBe("A");
      expect(fresh?.steps?.a?.at).toBe(dead?.steps?.a?.at);
      expect(fresh?.steps?.b?.result).toBe("B");
      expect(fresh?.steps?.c?.result).toBe("C");
      expect(fresh?.triggeredBy).toBe("admin");
      expect(fresh?.key ?? null).toBe(null);

      const old = await app.executions.findById(id);
      expect(old?.status).toBe("error");
      expect(old?.steps).toEqual(dead?.steps);
      await alepha.stop();
    });

    it("a run cancelled while it slept, retried before its wake instant, sleeps until the same instant", async ({
      expect,
    }) => {
      const alepha = makeApp();
      let after = 0;
      class App {
        executions = $repository(jobExecutionEntity);
        work = $job({
          name: "outbox.retry-sleep",
          description: "Sleeps, is cancelled, is retried.",
          schema: idSchema,
          handler: async ({ step }) => {
            await step.sleep("wait", [1, "hour"]);
            after++;
          },
        });
      }
      const app = alepha.inject(App);
      await alepha.start();

      const id = await app.work.push({ id: "x" });
      const parked = await waitFor(
        () => app.executions.findById(id),
        (r) => r?.status === "scheduled" && !!r.steps?.wait,
        { label: "sleeping" },
      );
      const until = parked!.steps!.wait.until!;
      await app.work.cancel(id);
      await alepha.inject(JobService).retryExecution(id);
      const fresh = await waitFor(
        () =>
          app.executions
            .findMany({ where: { jobName: { eq: "outbox.retry-sleep" } } })
            .then((rows) => rows.find((r) => r.id !== id)),
        (r) => r?.status === "scheduled" && r.scheduledAt === until,
        { label: "retried row sleeping until the stored instant" },
      );
      expect(fresh?.steps?.wait?.until).toBe(until);
      expect(after).toBe(0);
      await alepha.stop();
    });
  });
});
