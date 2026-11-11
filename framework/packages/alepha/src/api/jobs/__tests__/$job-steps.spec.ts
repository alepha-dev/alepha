import { $hook, AlephaError, z } from "alepha";
import { $repository } from "alepha/orm";
import { describe, it } from "vitest";

import {
  $job,
  type JobClaimFence,
  JobProvider,
  type JobRetryBackoff,
  jobExecutionEntity,
} from "../index.ts";
import { jobStepsDialects } from "./jobStepsDialects.ts";

/**
 * `$job` steps, on Postgres, SQLite and D1. Direct mode throughout: the
 * provider is where steps live, and the local promoting timer is what
 * `travel()` fires.
 */

/**
 * Poll `fn` until `predicate` holds, or throw on timeout.
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

const fast: JobRetryBackoff = { initial: [5, "millisecond"], jitter: false };

const idSchema = z.object({ id: z.text() });

describe.each(jobStepsDialects)("job steps, step.run on $name", (dialect) => {
  it("a run failing on its third step calls the first two exactly once across every attempt", async ({
    expect,
  }) => {
    const alepha = dialect.create();
    const calls = { a: 0, b: 0, c: 0 };
    const events = { success: 0, error: 0, end: 0 };
    class App {
      executions = $repository(jobExecutionEntity);
      onSuccess = $hook({
        on: "job:success",
        handler: () => {
          events.success++;
        },
      });
      onError = $hook({
        on: "job:error",
        handler: () => {
          events.error++;
        },
      });
      onEnd = $hook({
        on: "job:end",
        handler: () => {
          events.end++;
        },
      });
      work = $job({
        name: "steps.third-fails",
        description: "Three steps, the third always fails.",
        schema: idSchema,
        retry: { retries: 2, backoff: fast },
        handler: async ({ step }) => {
          const a = await step.run("a", async () => {
            calls.a++;
            return { n: 1 };
          });
          const b = await step.run("b", async () => {
            calls.b++;
            return a.n + 1;
          });
          await step.run("c", async () => {
            calls.c++;
            throw new AlephaError(`c failed after b=${b}`);
          });
        },
      });
    }
    const app = alepha.inject(App);
    await dialect.start(alepha);

    const id = await app.work.push({ id: "x" });
    const dead = await waitFor(
      () => app.executions.findById(id),
      (r) => r?.status === "error",
      { label: "row dead" },
    );

    expect(calls).toEqual({ a: 1, b: 1, c: 3 });
    expect(dead?.error).toBe("c failed after b=2");
    // The terminal write keeps the steps, results included.
    expect(dead?.steps?.a?.result).toEqual({ n: 1 });
    expect(dead?.steps?.b?.result).toBe(2);
    expect(dead?.steps?.c).toBeUndefined();
    await waitFor(
      () => events.error,
      (n) => n === 3,
      { label: "three job:error" },
    );
    expect(events.success).toBe(0);
    await waitFor(
      () => events.end,
      (n) => n === 3,
      { label: "three job:end" },
    );
    await alepha.stop();
  });

  it("returns a stored result, undefined included, without calling the function", async ({
    expect,
  }) => {
    const alepha = dialect.create();
    const calls: string[] = [];
    let seen: unknown[] = [];
    let failOnce = true;
    class App {
      executions = $repository(jobExecutionEntity);
      work = $job({
        name: "steps.replay",
        description: "Replays its steps after one failure.",
        schema: idSchema,
        retry: { retries: 1, backoff: fast },
        retention: { ok: { last: 10 } },
        handler: async ({ step }) => {
          const nothing = await step.run("void", async () => {
            calls.push("void");
          });
          const value = await step.run("value", async () => {
            calls.push("value");
            return { list: [1, "two", null], nested: { ok: true } };
          });
          seen = [nothing, value];
          if (failOnce) {
            failOnce = false;
            throw new AlephaError("after the steps");
          }
        },
      });
    }
    const app = alepha.inject(App);
    await dialect.start(alepha);

    const id = await app.work.push({ id: "x" });
    const ok = await waitFor(
      () => app.executions.findById(id),
      (r) => r?.status === "ok",
      { label: "row ok" },
    );

    expect(calls).toEqual(["void", "value"]);
    expect(seen).toEqual([
      undefined,
      { list: [1, "two", null], nested: { ok: true } },
    ]);
    expect(ok?.steps?.void).toBeDefined();
    expect("result" in (ok?.steps?.void ?? {})).toBe(false);
    expect(typeof ok?.steps?.value?.ms).toBe("number");
    await alepha.stop();
  });

  it("gives every step the job's full retry budget: a completed step writes attempt 1", async ({
    expect,
  }) => {
    const alepha = dialect.create();
    const tries = { a: 0, b: 0 };
    let successes = 0;
    class App {
      executions = $repository(jobExecutionEntity);
      onSuccess = $hook({
        on: "job:success",
        handler: () => {
          successes++;
        },
      });
      work = $job({
        name: "steps.budget",
        description: "Two steps that each fail once.",
        schema: idSchema,
        // Two tries in all. Counted across the run, b's retry would be the
        // third try and the run would die.
        retry: { retries: 1, backoff: fast },
        retention: { ok: { last: 10 } },
        handler: async ({ step }) => {
          await step.run("a", async () => {
            tries.a++;
            if (tries.a === 1) throw new AlephaError("a, first try");
          });
          await step.run("b", async () => {
            tries.b++;
            if (tries.b === 1) throw new AlephaError("b, first try");
          });
        },
      });
    }
    const app = alepha.inject(App);
    await dialect.start(alepha);

    const id = await app.work.push({ id: "x" });
    const ok = await waitFor(
      () => app.executions.findById(id),
      (r) => r?.status === "ok" || r?.status === "error",
      { label: "row terminal" },
    );

    expect(ok?.status).toBe("ok");
    expect(tries).toEqual({ a: 2, b: 2 });
    // b completed on the run's second claim, and wrote attempt 1.
    expect(ok?.attempt).toBe(1);
    await waitFor(
      () => successes,
      (n) => n === 1,
      { label: "one job:success" },
    );
    await alepha.stop();
  });

  it("runs a step again when its write was lost: at-least-once, per step", async ({
    expect,
  }) => {
    class LosesOneStepWrite extends JobProvider {
      lost = false;
      protected override async guardedUpdate(
        executionId: string,
        expectedStatuses: Parameters<JobProvider["guardedUpdate"]>[1],
        patch: Parameters<JobProvider["guardedUpdate"]>[2],
        label: string,
        fence?: JobClaimFence,
      ): Promise<boolean> {
        if (label === "step" && !this.lost) {
          this.lost = true;
          throw new AlephaError("connection reset while writing the step");
        }
        return super.guardedUpdate(
          executionId,
          expectedStatuses,
          patch,
          label,
          fence,
        );
      }
    }
    const alepha = dialect.create((a) =>
      a.with({ provide: JobProvider, use: LosesOneStepWrite }),
    );
    let charges = 0;
    let receipts = 0;
    class App {
      executions = $repository(jobExecutionEntity);
      work = $job({
        name: "steps.lost-write",
        description: "A step whose first write is lost.",
        schema: idSchema,
        retry: { retries: 2, backoff: fast },
        retention: { ok: { last: 10 } },
        handler: async ({ step }) => {
          await step.run("charge", async () => {
            charges++;
            return { charge: "ch_1" };
          });
          await step.run("receipt", async () => {
            receipts++;
          });
        },
      });
    }
    const app = alepha.inject(App);
    await dialect.start(alepha);

    const id = await app.work.push({ id: "x" });
    const ok = await waitFor(
      () => app.executions.findById(id),
      (r) => r?.status === "ok",
      { label: "row ok" },
    );

    expect(alepha.inject(LosesOneStepWrite).lost).toBe(true);
    expect(charges).toBe(2);
    expect(receipts).toBe(1);
    expect(ok?.steps?.charge?.result).toEqual({ charge: "ch_1" });
    await alepha.stop();
  });

  it("keeps the lease heartbeat alive across a step write that changes attempt", async ({
    expect,
  }) => {
    /**
     * A renewal snapshots the fence when it starts and reaches the database
     * late: exactly the renewal that, landing after a step write that moved
     * `attempt` from 2 to 1, would find no row and stop the heartbeat.
     */
    class SlowRenewals extends JobProvider {
      renewals = 0;
      stops = 0;
      started!: () => void;
      renewalStarted = new Promise<void>((resolve) => {
        this.started = resolve;
      });
      protected override crashThresholdMs(): number {
        return 750; // a 250 ms heartbeat
      }
      protected override async renewLease(
        executionId: string,
        fence?: JobClaimFence,
      ): Promise<void> {
        const snapshot = fence ? { ...fence } : undefined;
        this.started();
        await new Promise((r) => setTimeout(r, 150));
        await super.renewLease(executionId, snapshot);
        this.renewals++;
      }
      protected override shouldStopHeartbeat(error: unknown): boolean {
        const stop = super.shouldStopHeartbeat(error);
        if (stop) this.stops++;
        return stop;
      }
    }
    const alepha = dialect.create((a) =>
      a.with({ provide: JobProvider, use: SlowRenewals }),
    );
    let tries = 0;
    let renewalsAfterWrite = 0;
    class App {
      provider = $repository(jobExecutionEntity);
      work = $job({
        name: "steps.heartbeat",
        description: "Holds a lease across a step write.",
        schema: idSchema,
        retry: { retries: 1, backoff: fast },
        retention: { ok: { last: 10 } },
        handler: async ({ step }) => {
          await step.run("a", async () => {
            tries++;
            if (tries === 1) throw new AlephaError("first try");
            // Return only once a renewal (fenced on attempt 2) is in flight.
            await provider.renewalStarted;
          });
          const before = provider.renewals;
          await new Promise((r) => setTimeout(r, 800));
          renewalsAfterWrite = provider.renewals - before;
        },
      });
    }
    const app = alepha.inject(App);
    const provider = alepha.inject(SlowRenewals);
    await dialect.start(alepha);

    const id = await app.work.push({ id: "x" });
    const ok = await waitFor(
      () => app.provider.findById(id),
      (r) => r?.status === "ok",
      { label: "row ok", timeout: 8000 },
    );

    expect(ok?.attempt).toBe(1);
    expect(provider.stops).toBe(0);
    expect(renewalsAfterWrite).toBeGreaterThanOrEqual(2);
    await alepha.stop();
  });
});
