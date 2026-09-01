import { Alepha, z } from "alepha";
import { jobConfig } from "alepha/api/jobs";
import { DateTimeProvider } from "alepha/datetime";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";

import {
  $workflow,
  AlephaApiWorkflows,
  WorkflowProvider,
  workflowConfig,
  workflowExecutions,
  workflowStepExecutions,
} from "../index.ts";

// -----------------------------------------------------------------------------------------------------------------

async function waitFor<T>(
  fn: () => Promise<T> | T,
  predicate: (v: T) => boolean,
  { timeout = 4_000, interval = 10, label = "condition" } = {},
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
 * Holds every DEFERRED dispatch at the seam between "the step row carries
 * its `scheduledAt` stamp" and "the delivery is arranged", then releases it.
 *
 * That seam is where a test's `travel()` lands whenever its poll sees the
 * stamp before the engine has pushed the outbox row. The window is one
 * database round trip wide, invisible on an idle machine and hit at roughly
 * one CI run in five, and this gate is the only way to put a single-process
 * test there deterministically. Every deferred dispatch in the engine (a
 * step-level `delay`, a retry backoff, a `repeat` re-park) goes through
 * `dispatchStep`, so one gate covers all three.
 */
class GatedDispatchProvider extends WorkflowProvider {
  public gate?: Promise<void>;
  public arrived?: () => void;

  protected override async dispatchStep(
    workflowId: string,
    stepName: string,
    priority: number,
    scheduledAt?: string,
  ): Promise<void> {
    if (scheduledAt && this.gate) {
      const gate = this.gate;
      // One-shot: the release must not hold a later dispatch of the same
      // execution (the retry's second attempt, the repeat's next round).
      this.gate = undefined;
      this.arrived?.();
      await gate;
    }
    return super.dispatchStep(workflowId, stepName, priority, scheduledAt);
  }

  /**
   * Arm the gate. Resolves once a deferred dispatch has arrived at it;
   * `release()` then lets that dispatch through.
   */
  public arm(): Promise<void> {
    this.gate = new Promise<void>((resolve) => {
      this.release = resolve;
    });
    return new Promise<void>((resolve) => {
      this.arrived = resolve;
    });
  }

  public release: () => void = () => {};
}

/**
 * A tick that no travel() in this file can reach.
 */
const NEVER = "0 0 1 1 *";

const makeApp = (App: new () => object) => {
  const alepha = Alepha.create().with({
    provide: WorkflowProvider,
    use: GatedDispatchProvider,
  });

  // Every sweep pinned a year out, BEFORE the modules are wired (a `$job`
  // reads its cron once, at field-init). A travel() of a few minutes has
  // roughly a one-in-five chance of crossing a quarter-hour tick, and the recovery
  // sweep's tick rescues a parked step by re-deriving its wake-up from the
  // row. That rescue is why CI was red only some of the time, and this
  // regression must not be allowed to pass by it.
  alepha.store.mut(workflowConfig, (c) => ({
    ...c,
    timeoutCron: NEVER,
    recoveryCron: NEVER,
    purgeCron: NEVER,
  }));
  alepha.store.mut(jobConfig, (c) => ({
    ...c,
    sweepCron: NEVER,
    trimCron: NEVER,
  }));

  return alepha.with(AlephaOrmPostgres).with(AlephaApiWorkflows).with(App);
};

// -----------------------------------------------------------------------------------------------------------------

/**
 * The stamp is written to the step row first and the dispatch pushed
 * second. When a `travel()` lands in between, the dispatch used to be
 * scheduled from the clock it found at push time, so the outbox row fell
 * due minutes AFTER the clock the test had just moved, and nothing ever
 * delivered it: the execution parked in `running` on the delayed step
 * with the stamp long past. These three tests put a `travel()` in that
 * window on purpose, one per place the engine stamps-then-dispatches.
 */
describe("$workflow: the clock moves between a step's stamp and its dispatch", () => {
  it("still delivers a step-level delay stamped by advance()", async ({
    expect,
  }) => {
    const order: string[] = [];

    class App {
      repo = $repository(workflowExecutions);
      stepRepo = $repository(workflowStepExecutions);
      reminder = $workflow({
        schema: z.object({ id: z.text() }),
        steps: [
          {
            name: "immediate",
            handler: async () => {
              order.push("immediate");
              return { ok: true };
            },
          },
          {
            name: "afterDelay",
            delay: [2, "minute"],
            handler: async () => {
              order.push("afterDelay");
              return { ok: true };
            },
          },
        ],
      });
    }

    const alepha = makeApp(App);
    await alepha.start();
    const app = alepha.inject(App);
    const provider = alepha.inject(GatedDispatchProvider);
    const dt = alepha.inject(DateTimeProvider);

    const arrived = provider.arm();
    const executionId = await app.reminder.start({ id: "seq" });

    // The engine has written the stamp and is parked right before the push.
    await arrived;
    const parked = await app.stepRepo.findOne({
      where: {
        workflowExecutionId: { eq: executionId },
        stepName: { eq: "afterDelay" },
      },
    });
    expect(parked?.status).toBe("pending");
    expect(parked?.scheduledAt).toBeDefined();
    expect(order).toEqual(["immediate"]);

    // The test's travel lands in that window, and only then does the
    // engine get to push the dispatch.
    await dt.travel([3, "minute"]);
    provider.release();

    await waitFor(
      () => app.repo.findById(executionId),
      (e) => e?.status === "completed",
      { label: "workflow completed after step delay" },
    );
    expect(order).toEqual(["immediate", "afterDelay"]);
  });

  it("still delivers a retry stamped by its backoff", async ({ expect }) => {
    let calls = 0;

    class App {
      repo = $repository(workflowExecutions);
      stepRepo = $repository(workflowStepExecutions);
      flaky = $workflow({
        schema: z.object({ id: z.text() }),
        steps: [
          {
            name: "flaky",
            retry: { retries: 1, backoff: [1, "minute"] },
            handler: async () => {
              calls++;
              if (calls === 1) throw new Error("first attempt fails");
              return { ok: true };
            },
          },
        ],
      });
    }

    const alepha = makeApp(App);
    await alepha.start();
    const app = alepha.inject(App);
    const provider = alepha.inject(GatedDispatchProvider);
    const dt = alepha.inject(DateTimeProvider);

    const arrived = provider.arm();
    const executionId = await app.flaky.start({ id: "retry" });

    await arrived;
    const parked = await app.stepRepo.findOne({
      where: {
        workflowExecutionId: { eq: executionId },
        stepName: { eq: "flaky" },
      },
    });
    expect(parked?.status).toBe("pending");
    expect(parked?.scheduledAt).toBeDefined();
    expect(calls).toBe(1);

    await dt.travel([2, "minute"]);
    provider.release();

    await waitFor(
      () => app.repo.findById(executionId),
      (e) => e?.status === "completed",
      { label: "workflow completed after retry" },
    );
    expect(calls).toBe(2);
  });

  it("still delivers a repeat iteration stamped by its re-park", async ({
    expect,
  }) => {
    const runs: number[] = [];

    class App {
      repo = $repository(workflowExecutions);
      stepRepo = $repository(workflowStepExecutions);
      loop = $workflow({
        schema: z.object({ id: z.text() }),
        steps: [
          {
            name: "offer",
            repeat: { delay: [10, "minute"] },
            handler: async ({ context }) => {
              runs.push(context.iteration);
              if (runs.length < 2) {
                return { repeat: true };
              }
              return { done: true };
            },
          },
        ],
      });
    }

    const alepha = makeApp(App);
    await alepha.start();
    const app = alepha.inject(App);
    const provider = alepha.inject(GatedDispatchProvider);
    const dt = alepha.inject(DateTimeProvider);

    const arrived = provider.arm();
    const executionId = await app.loop.start({ id: "loop" });

    await arrived;
    const parked = await app.stepRepo.findOne({
      where: {
        workflowExecutionId: { eq: executionId },
        stepName: { eq: "offer" },
      },
    });
    expect(parked?.status).toBe("pending");
    expect(parked?.iteration).toBe(1);
    expect(parked?.scheduledAt).toBeDefined();
    expect(runs).toEqual([0]);

    await dt.travel([11, "minute"]);
    provider.release();

    await waitFor(
      () => app.repo.findById(executionId),
      (e) => e?.status === "completed",
      { label: "workflow completed after repeat" },
    );
    expect(runs).toEqual([0, 1]);
  });
});
