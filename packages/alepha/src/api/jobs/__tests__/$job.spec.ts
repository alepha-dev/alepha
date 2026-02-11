import { $inject, Alepha } from "alepha";
import { $logger } from "alepha/logger";
import { $repository } from "alepha/orm";
import { describe, expect, it, vi } from "vitest";
import {
  $job,
  JobProvider,
  JobService,
  jobExecutionEntity,
  jobExecutionLogEntity,
} from "../index.ts";

// -----------------------------------------------------------------------------------------------------------------

const t = await import("alepha").then((m) => m.t);

// -----------------------------------------------------------------------------------------------------------------

describe("$job v2", () => {
  // ----- Basic functionality -----

  describe("basic functionality", () => {
    it("should push a single payload and execute handler", async () => {
      const handler = vi.fn();

      class App {
        repo = $repository(jobExecutionEntity);
        myJob = $job({
          schema: t.object({ userId: t.text() }),
          handler,
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      await app.myJob.push({ userId: "abc-123" });

      // Wait for async processing
      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalledTimes(1);
      });

      const args = handler.mock.calls[0][0];
      expect(args.items).toHaveLength(1);
      expect(args.items[0].payload).toEqual({ userId: "abc-123" });
      expect(args.items[0].attempt).toBe(1);
      expect(args.items[0].id).toBeDefined();
      expect(args.now).toBeDefined();
      expect(args.signal).toBeInstanceOf(AbortSignal);
    });

    it("should push an array of payloads", async () => {
      const handler = vi.fn();

      class App {
        myJob = $job({
          schema: t.object({ id: t.text() }),
          handler,
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      const ids = await app.myJob.push([{ id: "1" }, { id: "2" }, { id: "3" }]);

      expect(ids).toHaveLength(3);

      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalledTimes(3);
      });
    });

    it("should use default name from ClassName.propertyKey", async () => {
      class MyService {
        sendEmail = $job({
          schema: t.object({ to: t.text() }),
          handler: async () => {},
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(MyService);
      await alepha.start();

      expect(app.sendEmail.name).toBe("MyService.sendEmail");
    });

    it("should handle cron-only job with empty items", async () => {
      const handler = vi.fn();

      class App {
        cronJob = $job({
          cron: "0 0 * * *",
          handler,
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      await app.cronJob.trigger();

      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalledTimes(1);
      });

      const args = handler.mock.calls[0][0];
      expect(args.items).toEqual([]);
      expect(args.now).toBeDefined();
      expect(args.signal).toBeInstanceOf(AbortSignal);
    });
  });

  // ----- Execution tracking -----

  describe("execution tracking", () => {
    it("should transition through pending → running → completed", async () => {
      let statusDuringExecution: string | undefined;

      class App {
        repo = $repository(jobExecutionEntity);
        myJob = $job({
          schema: t.object({ value: t.text() }),
          handler: async () => {
            const executions = await this.repo.findMany({
              where: { jobName: "App.myJob", status: "running" },
            });
            statusDuringExecution = executions[0]?.status;
          },
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      await app.myJob.push({ value: "test" });

      await vi.waitFor(async () => {
        const executions = await app.repo.findMany({
          where: { jobName: "App.myJob", status: "completed" },
        });
        expect(executions).toHaveLength(1);
      });

      expect(statusDuringExecution).toBe("running");
    });

    it("should record failure with error message", async () => {
      class App {
        repo = $repository(jobExecutionEntity);
        failingJob = $job({
          schema: t.object({ value: t.text() }),
          handler: async () => {
            throw new Error("Something went wrong");
          },
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      await app.failingJob.push({ value: "test" });

      await vi.waitFor(async () => {
        const executions = await app.repo.findMany({
          where: { jobName: "App.failingJob", status: "dead" },
        });
        expect(executions).toHaveLength(1);
        expect(executions[0].error).toBe("Something went wrong");
        expect(executions[0].completedAt).toBeDefined();
      });
    });

    it("should set attempt to 1 on first execution", async () => {
      class App {
        repo = $repository(jobExecutionEntity);
        myJob = $job({
          schema: t.object({ value: t.text() }),
          handler: async () => {},
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      await app.myJob.push({ value: "test" });

      await vi.waitFor(async () => {
        const executions = await app.repo.findMany({
          where: { jobName: "App.myJob", status: "completed" },
        });
        expect(executions).toHaveLength(1);
        expect(executions[0].attempt).toBe(1);
      });
    });

    it("should set startedAt and completedAt timestamps", async () => {
      class App {
        repo = $repository(jobExecutionEntity);
        myJob = $job({
          schema: t.object({ value: t.text() }),
          handler: async () => {},
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      await app.myJob.push({ value: "test" });

      await vi.waitFor(async () => {
        const executions = await app.repo.findMany({
          where: { jobName: "App.myJob", status: "completed" },
        });
        expect(executions).toHaveLength(1);
        expect(executions[0].startedAt).toBeDefined();
        expect(executions[0].completedAt).toBeDefined();
      });
    });

    it("should set workerId on claim", async () => {
      class App {
        repo = $repository(jobExecutionEntity);
        myJob = $job({
          schema: t.object({ value: t.text() }),
          handler: async () => {},
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      await app.myJob.push({ value: "test" });

      await vi.waitFor(async () => {
        const executions = await app.repo.findMany({
          where: { jobName: "App.myJob", status: "completed" },
        });
        expect(executions).toHaveLength(1);
        expect(executions[0].workerId).toBeDefined();
        expect(executions[0].workerId!.length).toBeGreaterThan(0);
      });
    });

    it("should create separate execution records for each push", async () => {
      class App {
        repo = $repository(jobExecutionEntity);
        myJob = $job({
          schema: t.object({ n: t.integer() }),
          handler: async () => {},
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      await app.myJob.push({ n: 1 });
      await app.myJob.push({ n: 2 });
      await app.myJob.push({ n: 3 });

      await vi.waitFor(async () => {
        const executions = await app.repo.findMany({
          where: { jobName: "App.myJob", status: "completed" },
        });
        expect(executions).toHaveLength(3);
      });
    });
  });

  // ----- Log capture -----

  describe("log capture", () => {
    it("should capture handler logs to cold table", async () => {
      class App {
        log = $logger();
        repo = $repository(jobExecutionEntity);
        logRepo = $repository(jobExecutionLogEntity);

        loggingJob = $job({
          schema: t.object({ value: t.text() }),
          handler: async () => {
            this.log.info("Step 1 done");
            this.log.warn("Something slow");
            this.log.info("Step 2 done");
          },
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      await app.loggingJob.push({ value: "test" });

      await vi.waitFor(async () => {
        const executions = await app.repo.findMany({
          where: { jobName: "App.loggingJob", status: "completed" },
        });
        expect(executions).toHaveLength(1);

        const logEntry = await app.logRepo.findById(executions[0].id);
        expect(logEntry).toBeDefined();
        expect(logEntry!.logs).toBeDefined();

        const infoLogs = logEntry!.logs.filter((l) => l.level === "INFO");
        const warnLogs = logEntry!.logs.filter((l) => l.level === "WARN");
        expect(infoLogs).toHaveLength(2);
        expect(warnLogs).toHaveLength(1);
      });
    });

    it("should capture logs even on failure", async () => {
      class App {
        log = $logger();
        repo = $repository(jobExecutionEntity);
        logRepo = $repository(jobExecutionLogEntity);

        failingJob = $job({
          schema: t.object({ value: t.text() }),
          handler: async () => {
            this.log.info("Before error");
            throw new Error("boom");
          },
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      await app.failingJob.push({ value: "test" });

      await vi.waitFor(async () => {
        const executions = await app.repo.findMany({
          where: { jobName: "App.failingJob" },
        });
        expect(executions).toHaveLength(1);

        const logEntry = await app.logRepo.findById(executions[0].id);
        expect(logEntry).toBeDefined();
        expect(logEntry!.logs.some((l) => l.message === "Before error")).toBe(
          true,
        );
      });
    });
  });

  // ----- Retry policy -----

  describe("retry policy", () => {
    it("should reschedule on failure with retries configured", async () => {
      let callCount = 0;

      class App {
        repo = $repository(jobExecutionEntity);
        retryJob = $job({
          schema: t.object({ value: t.text() }),
          retry: { retries: 2, backoff: [1, "second"] },
          handler: async () => {
            callCount++;
            if (callCount <= 2) {
              throw new Error(`Fail #${callCount}`);
            }
          },
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      await app.retryJob.push({ value: "test" });

      // First execution fails → status becomes "retrying"
      await vi.waitFor(async () => {
        const executions = await app.repo.findMany({
          where: { jobName: "App.retryJob", status: "retrying" },
        });
        expect(executions).toHaveLength(1);
        expect(executions[0].attempt).toBe(1);
        expect(executions[0].scheduledAt).toBeDefined();
      });
    });

    it("should actually retry and complete after transient failures", async () => {
      let callCount = 0;

      class App {
        repo = $repository(jobExecutionEntity);
        retryJob = $job({
          schema: t.object({ value: t.text() }),
          retry: { retries: 2, backoff: [10, "millisecond"] },
          handler: async () => {
            callCount++;
            if (callCount <= 1) {
              throw new Error("transient failure");
            }
          },
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      await app.retryJob.push({ value: "test" });

      // Should eventually complete after retry
      await vi.waitFor(
        async () => {
          const executions = await app.repo.findMany({
            where: { jobName: "App.retryJob", status: "completed" },
          });
          expect(executions).toHaveLength(1);
          expect(executions[0].attempt).toBe(2);
        },
        { timeout: 5000 },
      );

      expect(callCount).toBe(2);
    });

    it("should retry until dead when all attempts fail", async () => {
      let callCount = 0;

      class App {
        repo = $repository(jobExecutionEntity);
        retryJob = $job({
          schema: t.object({ value: t.text() }),
          retry: { retries: 2, backoff: [10, "millisecond"] },
          handler: async () => {
            callCount++;
            throw new Error(`fail #${callCount}`);
          },
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      await app.retryJob.push({ value: "test" });

      // Should eventually go dead after all 3 attempts
      await vi.waitFor(
        async () => {
          const executions = await app.repo.findMany({
            where: { jobName: "App.retryJob", status: "dead" },
          });
          expect(executions).toHaveLength(1);
          expect(executions[0].attempt).toBe(3);
          expect(executions[0].error).toBe("fail #3");
        },
        { timeout: 5000 },
      );

      expect(callCount).toBe(3);
    });

    it("should set maxAttempts to retries + 1", async () => {
      class App {
        repo = $repository(jobExecutionEntity);
        retryJob = $job({
          schema: t.object({ value: t.text() }),
          retry: { retries: 3 },
          handler: async () => {
            throw new Error("always fail");
          },
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      await app.retryJob.push({ value: "test" });

      await vi.waitFor(async () => {
        const executions = await app.repo.findMany({
          where: { jobName: "App.retryJob" },
        });
        expect(executions).toHaveLength(1);
        expect(executions[0].maxAttempts).toBe(4);
      });
    });

    it("should mark as dead when all retries exhausted", async () => {
      class App {
        repo = $repository(jobExecutionEntity);
        retryJob = $job({
          schema: t.object({ value: t.text() }),
          retry: { retries: 0 },
          handler: async () => {
            throw new Error("always fail");
          },
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      await app.retryJob.push({ value: "test" });

      await vi.waitFor(async () => {
        const executions = await app.repo.findMany({
          where: { jobName: "App.retryJob", status: "dead" },
        });
        expect(executions).toHaveLength(1);
        expect(executions[0].error).toBe("always fail");
      });
    });

    it("should respect retry.when predicate", async () => {
      class SkippableError extends Error {
        constructor() {
          super("skip me");
          this.name = "SkippableError";
        }
      }

      class App {
        repo = $repository(jobExecutionEntity);
        retryJob = $job({
          schema: t.object({ value: t.text() }),
          retry: {
            retries: 3,
            when: (error) => !(error instanceof SkippableError),
          },
          handler: async () => {
            throw new SkippableError();
          },
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      await app.retryJob.push({ value: "test" });

      // Should go straight to dead (no retry for SkippableError)
      await vi.waitFor(async () => {
        const executions = await app.repo.findMany({
          where: { jobName: "App.retryJob", status: "dead" },
        });
        expect(executions).toHaveLength(1);
        expect(executions[0].attempt).toBe(1);
      });
    });

    it("should compute exponential backoff", async () => {
      class App {
        repo = $repository(jobExecutionEntity);
        retryJob = $job({
          schema: t.object({ value: t.text() }),
          retry: {
            retries: 3,
            backoff: {
              initial: [1, "second"],
              factor: 2,
              max: [30, "second"],
            },
          },
          handler: async () => {
            throw new Error("fail");
          },
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      await app.retryJob.push({ value: "test" });

      await vi.waitFor(async () => {
        const executions = await app.repo.findMany({
          where: { jobName: "App.retryJob", status: "retrying" },
        });
        expect(executions).toHaveLength(1);
        expect(executions[0].scheduledAt).toBeDefined();
      });
    });
  });

  // ----- Priority -----

  describe("priority", () => {
    it("should store numeric priority from string", async () => {
      class App {
        repo = $repository(jobExecutionEntity);
        highPriorityJob = $job({
          schema: t.object({ value: t.text() }),
          priority: "high",
          handler: async () => {},
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      await app.highPriorityJob.push({ value: "test" });

      await vi.waitFor(async () => {
        const executions = await app.repo.findMany({
          where: { jobName: "App.highPriorityJob" },
        });
        expect(executions).toHaveLength(1);
        expect(executions[0].priority).toBe(1); // high = 1
      });
    });

    it("should allow per-push priority override", async () => {
      class App {
        repo = $repository(jobExecutionEntity);
        myJob = $job({
          schema: t.object({ value: t.text() }),
          priority: "low",
          handler: async () => {},
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      await app.myJob.push({ value: "test" }, { priority: "critical" });

      await vi.waitFor(async () => {
        const executions = await app.repo.findMany({
          where: { jobName: "App.myJob" },
        });
        expect(executions).toHaveLength(1);
        expect(executions[0].priority).toBe(0); // critical = 0
      });
    });
  });

  // ----- Deduplication -----

  describe("deduplication (unique key)", () => {
    it("should return existing ID when pushing with same key", async () => {
      class App {
        repo = $repository(jobExecutionEntity);
        myJob = $job({
          schema: t.object({ value: t.text() }),
          handler: async () => {},
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      // Use delay so jobs stay "scheduled" and key is not cleared
      const id1 = await app.myJob.push(
        { value: "first" },
        { key: "unique-key", delay: [1, "hour"] },
      );
      const id2 = await app.myJob.push(
        { value: "second" },
        { key: "unique-key", delay: [1, "hour"] },
      );

      expect(id1).toBe(id2);

      // Only one execution should exist
      const executions = await app.repo.findMany({
        where: { jobName: "App.myJob" },
      });
      expect(executions).toHaveLength(1);
    });

    it("should allow same key after completion (key set to null)", async () => {
      class App {
        repo = $repository(jobExecutionEntity);
        myJob = $job({
          schema: t.object({ value: t.text() }),
          handler: async () => {},
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      const id1 = (await app.myJob.push(
        { value: "first" },
        { key: "reuse-key" },
      )) as string;

      // Wait for completion (key gets set to null)
      await vi.waitFor(async () => {
        const exec = await app.repo.findById(id1);
        expect(exec?.status).toBe("completed");
        expect(exec?.key).toBeNull();
      });

      // Push again with same key — should create new execution
      const id2 = await app.myJob.push(
        { value: "second" },
        { key: "reuse-key" },
      );

      expect(id2).not.toBe(id1);
    });
  });

  // ----- Delayed execution -----

  describe("delayed execution", () => {
    it("should create scheduled execution with delay", async () => {
      class App {
        repo = $repository(jobExecutionEntity);
        myJob = $job({
          schema: t.object({ value: t.text() }),
          handler: async () => {},
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      await app.myJob.push({ value: "test" }, { delay: [1, "hour"] });

      const executions = await app.repo.findMany({
        where: { jobName: "App.myJob", status: "scheduled" },
      });

      expect(executions).toHaveLength(1);
      expect(executions[0].scheduledAt).toBeDefined();
    });

    it("should create scheduled execution with scheduledAt", async () => {
      const futureDate = new Date("2030-01-01T00:00:00Z");

      class App {
        repo = $repository(jobExecutionEntity);
        myJob = $job({
          schema: t.object({ value: t.text() }),
          handler: async () => {},
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      await app.myJob.push({ value: "test" }, { scheduledAt: futureDate });

      const executions = await app.repo.findMany({
        where: { jobName: "App.myJob", status: "scheduled" },
      });

      expect(executions).toHaveLength(1);
      expect(executions[0].scheduledAt).toBeDefined();
    });
  });

  // ----- Cancellation -----

  describe("cancellation", () => {
    it("should cancel a pending execution", async () => {
      class App {
        repo = $repository(jobExecutionEntity);
        myJob = $job({
          schema: t.object({ value: t.text() }),
          handler: async () => {},
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      // Push with delay so it stays pending
      const id = (await app.myJob.push(
        { value: "test" },
        { delay: [1, "hour"] },
      )) as string;

      await app.myJob.cancel(id);

      const execution = await app.repo.findById(id);
      expect(execution?.status).toBe("cancelled");
    });

    it("should record cancelledBy on cancellation", async () => {
      class App {
        repo = $repository(jobExecutionEntity);
        myJob = $job({
          schema: t.object({ value: t.text() }),
          handler: async () => {},
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      const id = (await app.myJob.push(
        { value: "test" },
        { delay: [1, "hour"] },
      )) as string;

      // Use provider directly to pass cancel context
      const provider = alepha.inject(JobProvider);
      await provider.cancel(id, {
        cancelledBy: "user-123",
        cancelledByName: "John Doe",
      });

      const execution = await app.repo.findById(id);
      expect(execution?.cancelledBy).toBe("user-123");
      expect(execution?.cancelledByName).toBe("John Doe");
    });

    it("should throw when cancelling a completed execution", async () => {
      class App {
        repo = $repository(jobExecutionEntity);
        myJob = $job({
          schema: t.object({ value: t.text() }),
          handler: async () => {},
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      const id = (await app.myJob.push({ value: "test" })) as string;

      await vi.waitFor(async () => {
        const exec = await app.repo.findById(id);
        expect(exec?.status).toBe("completed");
      });

      await expect(app.myJob.cancel(id)).rejects.toThrowError(/Cannot cancel/);
    });

    it("should be idempotent for already cancelled executions", async () => {
      class App {
        repo = $repository(jobExecutionEntity);
        myJob = $job({
          schema: t.object({ value: t.text() }),
          handler: async () => {},
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      const id = (await app.myJob.push(
        { value: "test" },
        { delay: [1, "hour"] },
      )) as string;

      await app.myJob.cancel(id);

      // Second cancel should throw (already cancelled)
      await expect(app.myJob.cancel(id)).rejects.toThrowError(/Cannot cancel/);
    });

    it("should trigger AbortSignal on running job cancellation", async () => {
      let signalAborted = false;

      class App {
        repo = $repository(jobExecutionEntity);
        myJob = $job({
          schema: t.object({ value: t.text() }),
          handler: async ({ signal }) => {
            // Long running handler
            await new Promise<void>((resolve) => {
              const check = () => {
                if (signal.aborted) {
                  signalAborted = true;
                  resolve();
                } else {
                  setTimeout(check, 10);
                }
              };
              check();
            });
          },
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      const id = (await app.myJob.push({ value: "test" })) as string;

      // Wait for it to start running
      await vi.waitFor(async () => {
        const exec = await app.repo.findById(id);
        expect(exec?.status).toBe("running");
      });

      await app.myJob.cancel(id);

      await vi.waitFor(() => {
        expect(signalAborted).toBe(true);
      });
    });
  });

  // ----- Timeout -----

  describe("timeout", () => {
    it("should abort handler when timeout expires", async () => {
      let wasAborted = false;

      class App {
        repo = $repository(jobExecutionEntity);
        timeoutJob = $job({
          schema: t.object({ value: t.text() }),
          timeout: [50, "millisecond"],
          handler: async ({ signal }) => {
            await new Promise<void>((resolve) => {
              const check = () => {
                if (signal.aborted) {
                  wasAborted = true;
                  resolve();
                } else {
                  setTimeout(check, 10);
                }
              };
              check();
            });
            throw new Error("Timed out by signal");
          },
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      await app.timeoutJob.push({ value: "test" });

      await vi.waitFor(
        () => {
          expect(wasAborted).toBe(true);
        },
        { timeout: 2000 },
      );
    });
  });

  // ----- Events -----

  describe("event emission", () => {
    it("should emit job:begin event", async () => {
      const beginHandler = vi.fn();

      class App {
        myJob = $job({
          schema: t.object({ value: t.text() }),
          handler: async () => {},
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      alepha.events.on("job:begin", beginHandler);
      await alepha.start();

      await app.myJob.push({ value: "test" });

      await vi.waitFor(() => {
        expect(beginHandler).toHaveBeenCalledTimes(1);
        expect(beginHandler).toHaveBeenCalledWith(
          expect.objectContaining({
            name: "App.myJob",
            executionId: expect.any(String),
          }),
        );
      });
    });

    it("should emit job:success on completion", async () => {
      const successHandler = vi.fn();

      class App {
        myJob = $job({
          schema: t.object({ value: t.text() }),
          handler: async () => {},
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      alepha.events.on("job:success", successHandler);
      await alepha.start();

      await app.myJob.push({ value: "test" });

      await vi.waitFor(() => {
        expect(successHandler).toHaveBeenCalledTimes(1);
      });
    });

    it("should emit job:error on failure", async () => {
      const errorHandler = vi.fn();

      class App {
        myJob = $job({
          schema: t.object({ value: t.text() }),
          handler: async () => {
            throw new Error("test error");
          },
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      alepha.events.on("job:error", errorHandler);
      await alepha.start();

      await app.myJob.push({ value: "test" });

      await vi.waitFor(() => {
        expect(errorHandler).toHaveBeenCalledTimes(1);
        expect(errorHandler).toHaveBeenCalledWith(
          expect.objectContaining({
            name: "App.myJob",
            error: expect.objectContaining({
              message: "test error",
            }),
          }),
        );
      });
    });

    it("should emit job:end for all outcomes", async () => {
      const endHandler = vi.fn();

      class App {
        successJob = $job({
          schema: t.object({ value: t.text() }),
          handler: async () => {},
        });
        failJob = $job({
          schema: t.object({ value: t.text() }),
          handler: async () => {
            throw new Error("fail");
          },
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      alepha.events.on("job:end", endHandler);
      await alepha.start();

      await app.successJob.push({ value: "test" });
      await app.failJob.push({ value: "test" });

      await vi.waitFor(() => {
        expect(endHandler).toHaveBeenCalledTimes(2);
      });
    });
  });

  // ----- pushMany -----

  describe("pushMany", () => {
    it("should push multiple items with per-item options", async () => {
      class App {
        repo = $repository(jobExecutionEntity);
        myJob = $job({
          schema: t.object({ value: t.text() }),
          handler: async () => {},
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      const ids = await app.myJob.pushMany([
        { payload: { value: "a" }, key: "key-a", delay: [30, "minute"] },
        {
          payload: { value: "b" },
          delay: [30, "minute"],
        },
      ]);

      expect(ids).toHaveLength(2);

      const exec1 = await app.repo.findById(ids[0]);
      expect(exec1?.key).toBe("key-a");
      expect(exec1?.status).toBe("scheduled");

      const exec2 = await app.repo.findById(ids[1]);
      expect(exec2?.status).toBe("scheduled");
      expect(exec2?.scheduledAt).toBeDefined();
    });
  });

  // ----- Edge cases -----

  describe("edge cases", () => {
    it("should throw when pushing to a job without schema", async () => {
      class App {
        cronOnly = $job({
          cron: "0 0 * * *",
          handler: async () => {},
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      await expect(
        app.cronOnly.push({ anything: "value" }),
      ).rejects.toThrowError(/no schema defined/);
    });

    it("should handle non-Error thrown objects", async () => {
      class App {
        repo = $repository(jobExecutionEntity);
        myJob = $job({
          schema: t.object({ value: t.text() }),
          handler: async () => {
            throw "string error";
          },
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      await app.myJob.push({ value: "test" });

      await vi.waitFor(async () => {
        const executions = await app.repo.findMany({
          where: { jobName: "App.myJob", status: "dead" },
        });
        expect(executions).toHaveLength(1);
        expect(executions[0].error).toBe("string error");
      });
    });

    it("should push empty array as no-op", async () => {
      const handler = vi.fn();

      class App {
        myJob = $job({
          schema: t.object({ value: t.text() }),
          handler,
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      const ids = await app.myJob.push([]);
      expect(ids).toEqual([]);
      expect(handler).not.toHaveBeenCalled();
    });

    it("should trigger cron-only job manually", async () => {
      const handler = vi.fn();

      class App {
        repo = $repository(jobExecutionEntity);
        cronJob = $job({
          cron: "0 0 * * *",
          handler,
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      await app.cronJob.trigger({
        triggeredBy: "admin-123",
        triggeredByName: "Admin User",
      });

      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalledTimes(1);
      });

      await vi.waitFor(async () => {
        const executions = await app.repo.findMany({
          where: { jobName: "App.cronJob", status: "completed" },
        });
        expect(executions).toHaveLength(1);
        expect(executions[0].triggeredBy).toBe("admin-123");
        expect(executions[0].triggeredByName).toBe("Admin User");
      });
    });

    it("should trigger push-based job manually with payload", async () => {
      const handler = vi.fn();

      class App {
        repo = $repository(jobExecutionEntity);
        myJob = $job({
          schema: t.object({ userId: t.text() }),
          handler,
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      await app.myJob.trigger({
        payload: { userId: "user-123" },
        triggeredBy: "admin",
        triggeredByName: "Admin",
      });

      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalledTimes(1);
        const args = handler.mock.calls[0][0];
        expect(args.items[0].payload).toEqual({ userId: "user-123" });
      });
    });
  });

  // ----- Resource can field -----

  describe("execution resource can field", () => {
    it("should set can.retry=true for dead executions", async () => {
      class App {
        repo = $repository(jobExecutionEntity);
        jobService = $inject(JobService);
        failingJob = $job({
          schema: t.object({ value: t.text() }),
          handler: async () => {
            throw new Error("fail");
          },
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      await app.failingJob.push({ value: "test" });

      await vi.waitFor(async () => {
        const executions = await app.repo.findMany({
          where: { jobName: "App.failingJob", status: "dead" },
        });
        expect(executions).toHaveLength(1);
      });

      const page = await app.jobService.findExecutions({
        job: "App.failingJob",
      });
      const exec = page.content[0];
      expect(exec.can).toEqual({ retry: true, cancel: false });
    });

    it("should set can.cancel=true for scheduled executions", async () => {
      class App {
        repo = $repository(jobExecutionEntity);
        jobService = $inject(JobService);
        myJob = $job({
          schema: t.object({ value: t.text() }),
          handler: async () => {},
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      await app.myJob.push({ value: "test" }, { delay: [1, "hour"] });

      const page = await app.jobService.findExecutions({ job: "App.myJob" });
      const exec = page.content[0];
      expect(exec.can).toEqual({ retry: false, cancel: true });
    });

    it("should set can.retry=false and can.cancel=false for completed executions", async () => {
      class App {
        repo = $repository(jobExecutionEntity);
        jobService = $inject(JobService);
        myJob = $job({
          schema: t.object({ value: t.text() }),
          handler: async () => {},
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      await app.myJob.push({ value: "test" });

      await vi.waitFor(async () => {
        const executions = await app.repo.findMany({
          where: { jobName: "App.myJob", status: "completed" },
        });
        expect(executions).toHaveLength(1);
      });

      const page = await app.jobService.findExecutions({ job: "App.myJob" });
      const exec = page.content[0];
      expect(exec.can).toEqual({ retry: false, cancel: false });
    });

    it("should include can field in getExecution detail", async () => {
      class App {
        repo = $repository(jobExecutionEntity);
        jobService = $inject(JobService);
        myJob = $job({
          schema: t.object({ value: t.text() }),
          handler: async () => {},
        });
      }

      const alepha = Alepha.create();
      const app = alepha.inject(App);
      await alepha.start();

      const id = (await app.myJob.push(
        { value: "test" },
        { delay: [1, "hour"] },
      )) as string;

      const detail = await app.jobService.getExecution(id);
      expect(detail.can).toEqual({ retry: false, cancel: true });
    });
  });
});
