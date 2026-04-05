import { Alepha, t } from "alepha";
import { $repository } from "alepha/orm";
import { AlephaOrmPostgres } from "alepha/orm/postgres";
import { describe, expect, it, vi } from "vitest";
import {
  $workflow,
  AlephaApiWorkflows,
  workflowExecutions,
  workflowStepExecutions,
} from "../index.ts";

// -----------------------------------------------------------------------------------------------------------------

describe("$workflow", () => {
  // ----- Basic functionality -----

  describe("basic functionality", () => {
    it("should start and complete a single-step workflow", async () => {
      const handler = vi.fn();

      class App {
        repo = $repository(workflowExecutions);
        stepRepo = $repository(workflowStepExecutions);
        myWorkflow = $workflow({
          schema: t.object({ orderId: t.uuid() }),
          steps: [
            {
              name: "processOrder",
              handler: async ({ payload }) => {
                handler(payload);
                return { processed: true };
              },
            },
          ],
        });
      }

      const alepha = Alepha.create().with(AlephaOrmPostgres);
      alepha.with(AlephaApiWorkflows);
      alepha.with(App);
      await alepha.start();

      const app = alepha.inject(App);
      const orderId = crypto.randomUUID();
      const executionId = await app.myWorkflow.start({ orderId });

      await vi.waitFor(async () => {
        const exec = await app.repo.findById(executionId);
        expect(exec?.status).toBe("completed");
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ orderId }),
      );

      // Verify step is completed with result
      const steps = await app.stepRepo.findMany({
        where: { workflowExecutionId: { eq: executionId } },
      });
      expect(steps).toHaveLength(1);
      expect(steps[0].status).toBe("completed");
      expect(steps[0].result).toEqual({ processed: true });
    });

    it("should execute multi-step workflow in order", async () => {
      const order: string[] = [];

      class App {
        repo = $repository(workflowExecutions);
        myWorkflow = $workflow({
          schema: t.object({ id: t.text() }),
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

      const alepha = Alepha.create().with(AlephaOrmPostgres);
      alepha.with(AlephaApiWorkflows);
      alepha.with(App);
      await alepha.start();

      const app = alepha.inject(App);
      const executionId = await app.myWorkflow.start({ id: "test" });

      await vi.waitFor(async () => {
        const exec = await app.repo.findById(executionId);
        expect(exec?.status).toBe("completed");
      });

      expect(order).toEqual(["step1", "step2", "step3"]);
    });

    it("should pass accumulated results between steps", async () => {
      let step2Results: Record<string, unknown> = {};

      class App {
        repo = $repository(workflowExecutions);
        myWorkflow = $workflow({
          schema: t.object({ value: t.text() }),
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

      const alepha = Alepha.create().with(AlephaOrmPostgres);
      alepha.with(AlephaApiWorkflows);
      alepha.with(App);
      await alepha.start();

      const app = alepha.inject(App);
      const executionId = await app.myWorkflow.start({ value: "test" });

      await vi.waitFor(async () => {
        const exec = await app.repo.findById(executionId);
        expect(exec?.status).toBe("completed");
      });

      expect(step2Results.first).toEqual({ key: "from-first" });
    });

    it("should use ClassName.propertyKey as workflow name", async () => {
      class OrderService {
        processOrder = $workflow({
          schema: t.object({ id: t.text() }),
          steps: [{ name: "step1", handler: async () => {} }],
        });
      }

      const alepha = Alepha.create().with(AlephaOrmPostgres);
      alepha.with(AlephaApiWorkflows);
      alepha.with(OrderService);
      await alepha.start();

      const app = alepha.inject(OrderService);
      expect(app.processOrder.name).toBe("OrderService.processOrder");
    });
  });

  // ----- Compensation (saga pattern) -----

  describe("compensation", () => {
    it("should compensate completed steps in reverse order on failure", async () => {
      const compensations: string[] = [];

      class App {
        repo = $repository(workflowExecutions);
        myWorkflow = $workflow({
          schema: t.object({ id: t.text() }),
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

      const alepha = Alepha.create().with(AlephaOrmPostgres);
      alepha.with(AlephaApiWorkflows);
      alepha.with(App);
      await alepha.start();

      const app = alepha.inject(App);
      const executionId = await app.myWorkflow.start({ id: "test" });

      await vi.waitFor(async () => {
        const exec = await app.repo.findById(executionId);
        expect(exec?.status).toBe("compensated");
      });

      // step3 never completed so no compensation for it
      // step2 and step1 compensated in reverse order
      expect(compensations).toEqual(["step2", "step1"]);
    });

    it("should mark as failed when onError is fail", async () => {
      class App {
        repo = $repository(workflowExecutions);
        myWorkflow = $workflow({
          schema: t.object({ id: t.text() }),
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

      const alepha = Alepha.create().with(AlephaOrmPostgres);
      alepha.with(AlephaApiWorkflows);
      alepha.with(App);
      await alepha.start();

      const app = alepha.inject(App);
      const executionId = await app.myWorkflow.start({ id: "test" });

      await vi.waitFor(async () => {
        const exec = await app.repo.findById(executionId);
        expect(exec?.status).toBe("failed");
      });

      const exec = await app.repo.findById(executionId);
      expect(exec?.error).toBe("boom");
      expect(exec?.errorStep).toBe("step2");
    });
  });

  // ----- Retry -----

  describe("retry", () => {
    it("should retry a step on failure with retries configured", async () => {
      let callCount = 0;

      class App {
        repo = $repository(workflowExecutions);
        stepRepo = $repository(workflowStepExecutions);
        myWorkflow = $workflow({
          schema: t.object({ id: t.text() }),
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

      const alepha = Alepha.create().with(AlephaOrmPostgres);
      alepha.with(AlephaApiWorkflows);
      alepha.with(App);
      await alepha.start();

      const app = alepha.inject(App);
      const executionId = await app.myWorkflow.start({ id: "test" });

      await vi.waitFor(
        async () => {
          const exec = await app.repo.findById(executionId);
          expect(exec?.status).toBe("completed");
        },
        { timeout: 10_000 },
      );

      expect(callCount).toBe(3);
    });
  });

  // ----- Conditional steps -----

  describe("conditional steps", () => {
    it("should skip steps when condition returns false", async () => {
      const executed: string[] = [];

      class App {
        repo = $repository(workflowExecutions);
        stepRepo = $repository(workflowStepExecutions);
        myWorkflow = $workflow({
          schema: t.object({ skipMiddle: t.boolean() }),
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

      const alepha = Alepha.create().with(AlephaOrmPostgres);
      alepha.with(AlephaApiWorkflows);
      alepha.with(App);
      await alepha.start();

      const app = alepha.inject(App);
      const executionId = await app.myWorkflow.start({ skipMiddle: true });

      await vi.waitFor(async () => {
        const exec = await app.repo.findById(executionId);
        expect(exec?.status).toBe("completed");
      });

      expect(executed).toEqual(["step1", "step3"]);

      // Verify step2 was skipped
      const steps = await app.stepRepo.findMany({
        where: { workflowExecutionId: { eq: executionId } },
        orderBy: { column: "stepIndex", direction: "asc" },
      });
      expect(steps[1].status).toBe("skipped");
    });
  });

  // ----- Cancel -----

  describe("cancel", () => {
    it("should cancel a pending workflow", async () => {
      class App {
        repo = $repository(workflowExecutions);
        stepRepo = $repository(workflowStepExecutions);
        myWorkflow = $workflow({
          schema: t.object({ id: t.text() }),
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

      const alepha = Alepha.create().with(AlephaOrmPostgres);
      alepha.with(AlephaApiWorkflows);
      alepha.with(App);
      await alepha.start();

      const app = alepha.inject(App);
      const executionId = await app.myWorkflow.start({ id: "test" });

      // Wait for it to be running
      await vi.waitFor(async () => {
        const steps = await app.stepRepo.findMany({
          where: {
            workflowExecutionId: { eq: executionId },
            status: { eq: "running" },
          },
        });
        expect(steps).toHaveLength(1);
      });

      await app.myWorkflow.cancel(executionId);

      await vi.waitFor(async () => {
        const exec = await app.repo.findById(executionId);
        expect(exec?.status).toBe("cancelled");
      });
    });
  });

  // ----- Retry (admin action) -----

  describe("admin retry", () => {
    it("should retry a failed workflow from the failed step", async () => {
      let callCount = 0;

      class App {
        repo = $repository(workflowExecutions);
        myWorkflow = $workflow({
          schema: t.object({ id: t.text() }),
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

      const alepha = Alepha.create().with(AlephaOrmPostgres);
      alepha.with(AlephaApiWorkflows);
      alepha.with(App);
      await alepha.start();

      const app = alepha.inject(App);
      const executionId = await app.myWorkflow.start({ id: "test" });

      await vi.waitFor(async () => {
        const exec = await app.repo.findById(executionId);
        expect(exec?.status).toBe("failed");
      });

      // Retry from the failed step
      await app.myWorkflow.retry(executionId);

      await vi.waitFor(async () => {
        const exec = await app.repo.findById(executionId);
        expect(exec?.status).toBe("completed");
      });

      expect(callCount).toBe(2);
    });
  });

  // ----- Restart -----

  describe("restart", () => {
    it("should create a new execution from the same payload", async () => {
      let callCount = 0;

      class App {
        repo = $repository(workflowExecutions);
        myWorkflow = $workflow({
          schema: t.object({ id: t.text() }),
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

      const alepha = Alepha.create().with(AlephaOrmPostgres);
      alepha.with(AlephaApiWorkflows);
      alepha.with(App);
      await alepha.start();

      const app = alepha.inject(App);
      const executionId = await app.myWorkflow.start({ id: "test" });

      await vi.waitFor(async () => {
        const exec = await app.repo.findById(executionId);
        expect(exec?.status).toBe("failed");
      });

      const newId = await app.myWorkflow.restart(executionId);
      expect(newId).not.toBe(executionId);

      await vi.waitFor(async () => {
        const exec = await app.repo.findById(newId);
        expect(exec?.status).toBe("completed");
      });

      expect(callCount).toBe(2);
    });
  });

  // ----- Events -----

  describe("events", () => {
    it("should emit workflow lifecycle events", async () => {
      const events: string[] = [];

      class App {
        repo = $repository(workflowExecutions);
        myWorkflow = $workflow({
          schema: t.object({ id: t.text() }),
          steps: [{ name: "step1", handler: async () => ({ ok: true }) }],
        });
      }

      const alepha = Alepha.create().with(AlephaOrmPostgres);
      alepha.with(AlephaApiWorkflows);
      alepha.with(App);
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

      await vi.waitFor(async () => {
        const exec = await app.repo.findById(executionId);
        expect(exec?.status).toBe("completed");
      });

      expect(events).toContain("started");
      expect(events).toContain("step:begin");
      expect(events).toContain("step:completed");
      expect(events).toContain("completed");
    });
  });

  // ----- Deduplication -----

  describe("deduplication", () => {
    it("should return existing execution for same key", async () => {
      class App {
        repo = $repository(workflowExecutions);
        myWorkflow = $workflow({
          schema: t.object({ id: t.text() }),
          steps: [{ name: "step1", handler: async () => ({ ok: true }) }],
        });
      }

      const alepha = Alepha.create().with(AlephaOrmPostgres);
      alepha.with(AlephaApiWorkflows);
      alepha.with(App);
      await alepha.start();

      const app = alepha.inject(App);

      // First start with key — creates a new execution
      const id1 = await app.myWorkflow.start(
        { id: "test" },
        { key: "dedup-key" },
      );

      // Wait for completion (key is cleared on completion)
      await vi.waitFor(async () => {
        const exec = await app.repo.findById(id1);
        expect(exec?.status).toBe("completed");
      });

      // Second start with same key after completion — creates NEW execution
      const id2 = await app.myWorkflow.start(
        { id: "test" },
        { key: "dedup-key" },
      );
      expect(id2).not.toBe(id1);
    });
  });
});
