import { $hook, Alepha, z } from "alepha";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";

import {
  $job,
  AlephaApiJobs,
  AlephaApiJobsQueue,
  jobConfig,
  jobExecutionEntity,
} from "../index.ts";

/**
 * An aborted run is an outcome, not a failure (#E85): a run the framework
 * aborts (the drain deadline at stop, `cancel()`) is recorded `cancelled`,
 * never `error`, and never retried. A timeout stays a failure until #E87.
 */
describe("$job aborted runs", () => {
  const makeApp = () => {
    const alepha = Alepha.create()
      .with(AlephaOrmPostgres)
      .with(AlephaApiJobs)
      .with(AlephaApiJobsQueue);
    alepha.store.mut(jobConfig, (c) => ({ ...c, drainTimeout: 50 }));
    return alepha;
  };

  const waitFor = async (predicate: () => Promise<boolean> | boolean) => {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("waitFor: condition not met");
  };

  /**
   * A handler that waits for its signal, then rethrows the abort, as any
   * consumer of the signal (`fetch`, a query) does.
   */
  const untilAborted = (signal: AbortSignal) =>
    new Promise<void>((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
    });

  it("records a queue run aborted at the drain deadline as cancelled, and does not retry it", async ({
    expect,
  }) => {
    const alepha = makeApp();
    const events: string[] = [];
    let attempts = 0;
    let statusAtCancel: string | undefined;

    class App {
      executions = $repository(jobExecutionEntity);
      slow = $job({
        name: "abort.slow",
        description: "A job under test.",
        schema: z.object({ v: z.integer() }),
        retry: { retries: 2 },
        handler: async ({ signal }) => {
          attempts++;
          await untilAborted(signal);
        },
      });
      onCancel = $hook({
        on: "job:cancel",
        handler: async ({ executionId }) => {
          events.push("cancel");
          statusAtCancel = (await this.executions.findById(executionId))
            ?.status;
        },
      });
      onError = $hook({
        on: "job:error",
        handler: () => {
          events.push("error");
        },
      });
    }
    const app = alepha.inject(App);
    await alepha.start();

    const id = await app.slow.push({ v: 1 });
    await waitFor(
      async () => (await app.executions.findById(id))?.status === "running",
    );

    await alepha.stop();

    expect(events).toEqual(["cancel"]);
    expect(statusAtCancel).toBe("cancelled");
    expect(attempts).toBe(1);
  });

  it("records a cron tick aborted at the drain deadline as cancelled", async ({
    expect,
  }) => {
    const alepha = makeApp();
    const events: string[] = [];
    let row: { status: string } | undefined;
    let started = false;

    class App {
      executions = $repository(jobExecutionEntity);
      tick = $job({
        name: "abort.tick",
        description: "A job under test.",
        cron: "0 0 * * *",
        handler: async ({ signal }) => {
          started = true;
          await untilAborted(signal);
        },
      });
      onCancel = $hook({
        on: "job:cancel",
        handler: async () => {
          events.push("cancel");
          const rows = await this.executions.findMany({
            where: { jobName: { eq: "abort.tick" } },
          });
          row = rows[0];
        },
      });
      onError = $hook({
        on: "job:error",
        handler: () => {
          events.push("error");
        },
      });
    }
    const app = alepha.inject(App);
    await alepha.start();

    const run = app.tick.trigger();
    await waitFor(() => started);
    await alepha.stop();
    await run;

    expect(events).toEqual(["cancel"]);
    expect(row?.status).toBe("cancelled");
  });

  it("aborts a cancelled run with an AbortedError naming the cancellation", async ({
    expect,
  }) => {
    const alepha = makeApp();
    let reason: unknown;

    class App {
      executions = $repository(jobExecutionEntity);
      slow = $job({
        name: "abort.cancel",
        description: "A job under test.",
        schema: z.object({ v: z.integer() }),
        handler: async ({ signal }) => {
          try {
            await untilAborted(signal);
          } catch (error) {
            reason = error;
            throw error;
          }
        },
      });
    }
    const app = alepha.inject(App);
    await alepha.start();

    const id = await app.slow.push({ v: 1 });
    await waitFor(
      async () => (await app.executions.findById(id))?.status === "running",
    );
    await app.slow.cancel(id);
    await waitFor(() => reason !== undefined);

    expect(alepha.context.isAbortError(reason)).toBe(true);
    expect((reason as Error).message).toContain(`${id} cancelled`);
  });

  it("keeps a timed-out run a failure, with a reason naming the timeout", async ({
    expect,
  }) => {
    const alepha = makeApp();
    class App {
      executions = $repository(jobExecutionEntity);
      slow = $job({
        name: "abort.timeout",
        description: "A job under test.",
        cron: "0 0 * * *",
        timeout: [20, "milliseconds"],
        handler: async ({ signal }) => {
          await untilAborted(signal);
        },
      });
    }
    const app = alepha.inject(App);
    await alepha.start();

    await app.slow.trigger();

    const rows = await app.executions.findMany({
      where: { jobName: { eq: "abort.timeout" } },
    });
    expect(rows[0]?.status).toBe("error");
    expect(rows[0]?.error).toContain("timed out");
  });
});
