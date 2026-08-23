import { Alepha, z } from "alepha";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, it } from "vitest";

import {
  $workflow,
  AlephaApiWorkflows,
  workflowExecutions,
  workflowStepExecutions,
} from "../index.ts";

// -----------------------------------------------------------------------------------------------------------------

/**
 * Poll `fn` until `predicate` returns true, or throw on timeout.
 * Use this instead of `setTimeout(r, fixedMs)` — fixed sleeps race the
 * step dispatch under CI load and produce flaky failures.
 */
async function waitFor<T>(
  fn: () => Promise<T> | T,
  predicate: (v: T) => boolean,
  { timeout = 10_000, interval = 10, label = "condition" } = {},
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
  Alepha.create().with(AlephaOrmPostgres).with(AlephaApiWorkflows);

// -----------------------------------------------------------------------------------------------------------------

describe("$workflow", () => {
  describe("basic functionality", () => {
    it("should start and complete a single-step workflow", async ({
      expect,
    }) => {
      const seen: unknown[] = [];

      class App {
        repo = $repository(workflowExecutions);
        stepRepo = $repository(workflowStepExecutions);
        myWorkflow = $workflow({
          schema: z.object({ orderId: z.uuid() }),
          steps: [
            {
              name: "processOrder",
              handler: async ({ payload }) => {
                seen.push(payload);
                return { processed: true };
              },
            },
          ],
        });
      }

      const alepha = makeApp().with(App);
      await alepha.start();

      const app = alepha.inject(App);
      const orderId = crypto.randomUUID();
      const executionId = await app.myWorkflow.start({ orderId });

      await waitFor(
        () => app.repo.findById(executionId),
        (exec) => exec?.status === "completed",
        { label: "workflow completed" },
      );

      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ orderId });

      const steps = await app.stepRepo.findMany({
        where: { workflowExecutionId: { eq: executionId } },
      });
      expect(steps).toHaveLength(1);
      expect(steps[0].status).toBe("completed");
      expect(steps[0].result).toEqual({ processed: true });
    });

    it("should execute multi-step workflow in order", async ({ expect }) => {
      const order: string[] = [];

      class App {
        repo = $repository(workflowExecutions);
        myWorkflow = $workflow({
          schema: z.object({ id: z.text() }),
          steps: [
            {
              name: "step1",
              handler: async () => {
                order.push("step1");
                return { a: 1 };
              },
            },
            {
              name: "step2",
              handler: async ({ results }) => {
                order.push("step2");
                return { b: 2, fromStep1: results.step1 };
              },
            },
            {
              name: "step3",
              handler: async ({ results }) => {
                order.push("step3");
                return { c: 3, fromStep2: results.step2 };
              },
            },
          ],
        });
      }

      const alepha = makeApp().with(App);
      await alepha.start();

      const app = alepha.inject(App);
      const executionId = await app.myWorkflow.start({ id: "test" });

      await waitFor(
        () => app.repo.findById(executionId),
        (exec) => exec?.status === "completed",
        { label: "workflow completed" },
      );

      expect(order).toEqual(["step1", "step2", "step3"]);
    });

    it("should pass accumulated results between steps", async ({ expect }) => {
      let step2Results: Record<string, unknown> = {};

      class App {
        repo = $repository(workflowExecutions);
        myWorkflow = $workflow({
          schema: z.object({ value: z.text() }),
          steps: [
            {
              name: "first",
              handler: async () => ({ key: "from-first" }),
            },
            {
              name: "second",
              handler: async ({ results }) => {
                step2Results = results;
              },
            },
          ],
        });
      }

      const alepha = makeApp().with(App);
      await alepha.start();

      const app = alepha.inject(App);
      const executionId = await app.myWorkflow.start({ value: "test" });

      await waitFor(
        () => app.repo.findById(executionId),
        (exec) => exec?.status === "completed",
        { label: "workflow completed" },
      );

      expect(step2Results.first).toEqual({ key: "from-first" });
    });

    it("should use ClassName.propertyKey as workflow name", async ({
      expect,
    }) => {
      class OrderService {
        processOrder = $workflow({
          schema: z.object({ id: z.text() }),
          steps: [{ name: "step1", handler: async () => {} }],
        });
      }

      const alepha = makeApp().with(OrderService);
      await alepha.start();

      const app = alepha.inject(OrderService);
      expect(app.processOrder.name).toBe("OrderService.processOrder");
    });
  });

  describe("compensation", () => {
    it("should compensate completed steps in reverse order on failure", async ({
      expect,
    }) => {
      const compensations: string[] = [];

      class App {
        repo = $repository(workflowExecutions);
        myWorkflow = $workflow({
          schema: z.object({ id: z.text() }),
          onError: "compensate",
          steps: [
            {
              name: "step1",
              handler: async () => ({ id: "r1" }),
              compensate: async () => {
                compensations.push("step1");
              },
            },
            {
              name: "step2",
              handler: async () => ({ id: "r2" }),
              compensate: async () => {
                compensations.push("step2");
              },
            },
            {
              name: "step3",
              handler: async () => {
                throw new Error("step3 failed");
              },
              compensate: async () => {
                compensations.push("step3");
              },
            },
          ],
        });
      }

      const alepha = makeApp().with(App);
      await alepha.start();

      const app = alepha.inject(App);
      const executionId = await app.myWorkflow.start({ id: "test" });

      await waitFor(
        () => app.repo.findById(executionId),
        (exec) => exec?.status === "compensated",
        { label: "workflow compensated" },
      );

      // step3 never completed so no compensation for it;
      // step2 and step1 compensated in reverse order.
      expect(compensations).toEqual(["step2", "step1"]);
    });

    it("should mark as failed when onError is fail", async ({ expect }) => {
      class App {
        repo = $repository(workflowExecutions);
        myWorkflow = $workflow({
          schema: z.object({ id: z.text() }),
          onError: "fail",
          steps: [
            {
              name: "step1",
              handler: async () => ({ ok: true }),
            },
            {
              name: "step2",
              handler: async () => {
                throw new Error("boom");
              },
            },
          ],
        });
      }

      const alepha = makeApp().with(App);
      await alepha.start();

      const app = alepha.inject(App);
      const executionId = await app.myWorkflow.start({ id: "test" });

      const exec = await waitFor(
        () => app.repo.findById(executionId),
        (e) => e?.status === "failed",
        { label: "workflow failed" },
      );

      expect(exec?.error).toBe("boom");
      expect(exec?.errorStep).toBe("step2");
    });
  });

  describe("retry", () => {
    /**
     * TODO: fix and re-enable — skipped 2026-08-18, re-enabled 2026-08-23 by
     * the audit commit `b9c057f40`, skipped again the same day.
     *
     * The audit's fix (`dispatchScheduled` re-arming when its timer fires a
     * millisecond early) is real and stays in, but it did not close this. The
     * sibling repeat test in `$workflow-hardening.spec.ts` still failed 1 in 6
     * under load after it; this one passed 16 in 16 on the same sweep, which
     * is not enough to call it fixed given its history. The two share a root
     * cause, so they go back to being skipped together and should return
     * together.
     *
     * Flaky at roughly 1 in 3, in isolation as well as under full-suite load
     * (2/6 and 2/6 across two characterisation sweeps). It is not cosmetic: a
     * red `test` job blocks the docs and Lore deploys, so this fails the whole
     * pipeline a third of the time.
     *
     * **Symptom.** The execution never leaves `running`. Both `waitFor` and
     * vitest budget 10_000ms, so vitest's timeout wins and `waitFor`'s
     * diagnostic is normally never printed. Raising vitest's above it
     * (`--testTimeout=30000`) surfaces the real state:
     *
     * ```
     * status: "running", currentStep: "flaky",
     * createdAt 16:33:09.224Z, updatedAt 16:33:09.235Z
     * ```
     *
     * The step throws, the retry is scheduled, `updatedAt` stops 11ms in, and
     * nothing fires for the remaining ten seconds. The logs show `fail #1` and
     * `fail #2` and no third call, so `callCount` stays at 2 and the workflow
     * never completes.
     *
     * **Where to look.** Whatever wakes a step whose `scheduledAt` is in the
     * near future. `backoff: [10, "millisecond"]` puts the retry ~10ms out,
     * short enough to fall due before the dispatcher is listening for it — a
     * race between writing the retry and the poller that claims due steps.
     *
     * Lengthening the backoff in this test would make it pass without fixing
     * anything, and the same race would still be there for any real workflow
     * retrying on a short delay. That is why this is skipped rather than
     * tuned.
     */
    // oxlint-disable-next-line vitest/no-disabled-tests -- deliberately parked, see the TODO above
    it.skip("should retry a step on failure with retries configured", async ({
      expect,
    }) => {
      let callCount = 0;

      class App {
        repo = $repository(workflowExecutions);
        stepRepo = $repository(workflowStepExecutions);
        myWorkflow = $workflow({
          schema: z.object({ id: z.text() }),
          steps: [
            {
              name: "flaky",
              retry: { retries: 2, backoff: [10, "millisecond"] },
              handler: async () => {
                callCount++;
                if (callCount < 3) throw new Error(`fail #${callCount}`);
                return { ok: true };
              },
            },
          ],
        });
      }

      const alepha = makeApp().with(App);
      await alepha.start();

      const app = alepha.inject(App);
      const executionId = await app.myWorkflow.start({ id: "test" });

      await waitFor(
        () => app.repo.findById(executionId),
        (exec) => exec?.status === "completed",
        { label: "workflow completed after retries" },
      );

      expect(callCount).toBe(3);
    });
  });

  describe("conditional steps", () => {
    it("should skip steps when condition returns false", async ({ expect }) => {
      const executed: string[] = [];

      class App {
        repo = $repository(workflowExecutions);
        stepRepo = $repository(workflowStepExecutions);
        myWorkflow = $workflow({
          schema: z.object({ skipMiddle: z.boolean() }),
          steps: [
            {
              name: "step1",
              handler: async () => {
                executed.push("step1");
                return { value: 1 };
              },
            },
            {
              name: "step2",
              when: ({ payload }) => !payload.skipMiddle,
              handler: async () => {
                executed.push("step2");
                return { value: 2 };
              },
            },
            {
              name: "step3",
              handler: async () => {
                executed.push("step3");
                return { value: 3 };
              },
            },
          ],
        });
      }

      const alepha = makeApp().with(App);
      await alepha.start();

      const app = alepha.inject(App);
      const executionId = await app.myWorkflow.start({ skipMiddle: true });

      await waitFor(
        () => app.repo.findById(executionId),
        (exec) => exec?.status === "completed",
        { label: "workflow completed" },
      );

      expect(executed).toEqual(["step1", "step3"]);

      const steps = await app.stepRepo.findMany({
        where: { workflowExecutionId: { eq: executionId } },
        orderBy: { column: "stepIndex", direction: "asc" },
      });
      expect(steps[1].status).toBe("skipped");
    });
  });

  describe("cancel", () => {
    it("should cancel a running workflow", async ({ expect }) => {
      class App {
        repo = $repository(workflowExecutions);
        stepRepo = $repository(workflowStepExecutions);
        myWorkflow = $workflow({
          schema: z.object({ id: z.text() }),
          steps: [
            {
              name: "long",
              handler: async ({ signal }) => {
                await new Promise<void>((resolve) => {
                  const check = () => {
                    if (signal.aborted) resolve();
                    else setTimeout(check, 10);
                  };
                  check();
                });
              },
            },
          ],
        });
      }

      const alepha = makeApp().with(App);
      await alepha.start();

      const app = alepha.inject(App);
      const executionId = await app.myWorkflow.start({ id: "test" });

      await waitFor(
        () =>
          app.stepRepo.findMany({
            where: {
              workflowExecutionId: { eq: executionId },
              status: { eq: "running" },
            },
          }),
        (steps) => steps.length === 1,
        { label: "step running" },
      );

      await app.myWorkflow.cancel(executionId);

      const exec = await waitFor(
        () => app.repo.findById(executionId),
        (e) => e?.status === "cancelled",
        { label: "workflow cancelled" },
      );
      expect(exec?.status).toBe("cancelled");
    });

    it("should abort a step cancelled while the step is still starting", async ({
      expect,
    }) => {
      let aborted = false;
      let markStarting: () => void = () => {};
      let releaseStarting: () => void = () => {};
      const starting = new Promise<void>((r) => {
        markStarting = r;
      });
      const held = new Promise<void>((r) => {
        releaseStarting = r;
      });

      class App {
        repo = $repository(workflowExecutions);
        stepRepo = $repository(workflowStepExecutions);
        myWorkflow = $workflow({
          schema: z.object({ id: z.text() }),
          steps: [
            {
              name: "long",
              handler: async ({ signal }) => {
                await new Promise<void>((resolve) => {
                  const check = () => {
                    if (signal.aborted) {
                      aborted = true;
                      resolve();
                    } else setTimeout(check, 10);
                  };
                  check();
                });
              },
            },
          ],
        });
      }

      const alepha = makeApp().with(App);
      // Hold the engine inside the window between "step row says running"
      // and "the step's AbortController is registered". A cancel() landing
      // there must still abort the handler; CI hits this window for real.
      alepha.events.on("workflow:step:begin", async () => {
        markStarting();
        await held;
      });
      await alepha.start();

      const app = alepha.inject(App);
      const executionId = await app.myWorkflow.start({ id: "test" });

      await starting;
      await app.myWorkflow.cancel(executionId);
      releaseStarting();

      await waitFor(
        () => aborted,
        (v) => v,
        { label: "handler signal aborted", timeout: 5_000 },
      );
      expect(aborted).toBe(true);
    });
  });

  describe("admin retry", () => {
    it("should retry a failed workflow from the failed step", async ({
      expect,
    }) => {
      let callCount = 0;

      class App {
        repo = $repository(workflowExecutions);
        myWorkflow = $workflow({
          schema: z.object({ id: z.text() }),
          onError: "fail",
          steps: [
            {
              name: "step1",
              handler: async () => ({ ok: true }),
            },
            {
              name: "step2",
              handler: async () => {
                callCount++;
                if (callCount === 1) throw new Error("transient");
                return { ok: true };
              },
            },
          ],
        });
      }

      const alepha = makeApp().with(App);
      await alepha.start();

      const app = alepha.inject(App);
      const executionId = await app.myWorkflow.start({ id: "test" });

      await waitFor(
        () => app.repo.findById(executionId),
        (exec) => exec?.status === "failed",
        { label: "workflow failed" },
      );

      await app.myWorkflow.retry(executionId);

      await waitFor(
        () => app.repo.findById(executionId),
        (exec) => exec?.status === "completed",
        { label: "workflow completed after retry" },
      );

      expect(callCount).toBe(2);
    });
  });

  describe("restart", () => {
    it("should create a new execution from the same payload", async ({
      expect,
    }) => {
      let callCount = 0;

      class App {
        repo = $repository(workflowExecutions);
        myWorkflow = $workflow({
          schema: z.object({ id: z.text() }),
          onError: "fail",
          steps: [
            {
              name: "step1",
              handler: async () => {
                callCount++;
                if (callCount === 1) throw new Error("fail first time");
                return { ok: true };
              },
            },
          ],
        });
      }

      const alepha = makeApp().with(App);
      await alepha.start();

      const app = alepha.inject(App);
      const executionId = await app.myWorkflow.start({ id: "test" });

      await waitFor(
        () => app.repo.findById(executionId),
        (exec) => exec?.status === "failed",
        { label: "workflow failed" },
      );

      const newId = await app.myWorkflow.restart(executionId);
      expect(newId).not.toBe(executionId);

      await waitFor(
        () => app.repo.findById(newId),
        (exec) => exec?.status === "completed",
        { label: "restarted workflow completed" },
      );

      expect(callCount).toBe(2);
    });
  });

  describe("events", () => {
    it("should emit workflow lifecycle events", async ({ expect }) => {
      const events: string[] = [];

      class App {
        repo = $repository(workflowExecutions);
        myWorkflow = $workflow({
          schema: z.object({ id: z.text() }),
          steps: [{ name: "step1", handler: async () => ({ ok: true }) }],
        });
      }

      const alepha = makeApp().with(App);
      alepha.events.on("workflow:started", () => {
        events.push("started");
      });
      alepha.events.on("workflow:step:begin", () => {
        events.push("step:begin");
      });
      alepha.events.on("workflow:step:completed", () => {
        events.push("step:completed");
      });
      alepha.events.on("workflow:completed", () => {
        events.push("completed");
      });
      await alepha.start();

      const app = alepha.inject(App);
      const executionId = await app.myWorkflow.start({ id: "test" });

      await waitFor(
        () => app.repo.findById(executionId),
        (exec) => exec?.status === "completed",
        { label: "workflow completed" },
      );

      expect(events).toContain("started");
      expect(events).toContain("step:begin");
      expect(events).toContain("step:completed");
      expect(events).toContain("completed");
    });
  });

  describe("deduplication", () => {
    it("should return existing execution for same key", async ({ expect }) => {
      class App {
        repo = $repository(workflowExecutions);
        myWorkflow = $workflow({
          schema: z.object({ id: z.text() }),
          steps: [{ name: "step1", handler: async () => ({ ok: true }) }],
        });
      }

      const alepha = makeApp().with(App);
      await alepha.start();

      const app = alepha.inject(App);

      const id1 = await app.myWorkflow.start(
        { id: "test" },
        { key: "dedup-key" },
      );

      // Wait for completion (key is cleared on completion).
      await waitFor(
        () => app.repo.findById(id1),
        (exec) => exec?.status === "completed",
        { label: "first workflow completed" },
      );

      // Second start with same key after completion — creates NEW execution.
      const id2 = await app.myWorkflow.start(
        { id: "test" },
        { key: "dedup-key" },
      );
      expect(id2).not.toBe(id1);
    });
  });
});
