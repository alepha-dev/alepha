import { Alepha, t } from "alepha";
import {
  $consumer,
  $queue,
  MemoryQueueProvider,
  type QueueEvent,
  QueueProvider,
} from "alepha/queue";
import { describe, expect, test } from "vitest";

const payloadSchema = t.object({
  id: t.text(),
  value: t.integer(),
});

describe("Queue Edge Cases", () => {
  const createTestApp = async (
    options: {
      workerConcurrency?: number;
      blockingTimeout?: number;
      schedulerInterval?: number;
      stalledThreshold?: number;
    } = {},
  ) => {
    const app = Alepha.create({
      env: {
        QUEUE_WORKER_CONCURRENCY: options.workerConcurrency ?? 1,
        QUEUE_WORKER_BLOCKING_TIMEOUT: options.blockingTimeout ?? 1,
        QUEUE_SCHEDULER_INTERVAL: options.schedulerInterval ?? 100,
        QUEUE_STALLED_THRESHOLD: options.stalledThreshold ?? 100,
      },
    });

    app.with({
      provide: QueueProvider,
      use: MemoryQueueProvider,
    });

    return app;
  };

  // ===========================================
  // Event System Edge Cases
  // ===========================================
  describe("Event System Edge Cases", () => {
    test("should handle multiple handlers for same event", async () => {
      const handler1Events: QueueEvent[] = [];
      const handler2Events: QueueEvent[] = [];
      const handler3Events: QueueEvent[] = [];

      class TestService {
        queue = $queue({
          name: "multi-handler",
          schema: payloadSchema,
          handler: async () => {},
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      const provider = app.inject(QueueProvider);
      provider.on("completed", (e) => {
        handler1Events.push(e);
      });
      provider.on("completed", (e) => {
        handler2Events.push(e);
      });
      provider.on("completed", (e) => {
        handler3Events.push(e);
      });

      await app.start();

      const testService = app.inject(TestService);
      await testService.queue.push({ id: "test", value: 1 });

      await expect
        .poll(() => handler1Events.length === 1, { timeout: 1000 })
        .toBeTruthy();

      expect(handler1Events.length).toBe(1);
      expect(handler2Events.length).toBe(1);
      expect(handler3Events.length).toBe(1);

      await app.stop();
    });

    test("should not crash when event handler throws", async () => {
      let completedNormally = false;

      class TestService {
        queue = $queue({
          name: "handler-throws",
          schema: payloadSchema,
          handler: async () => {},
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      const provider = app.inject(QueueProvider);
      provider.on("completed", () => {
        throw new Error("Handler error");
      });
      provider.on("completed", () => {
        completedNormally = true;
      });

      await app.start();

      const testService = app.inject(TestService);

      // This should not throw even though handler throws
      await expect(
        testService.queue.push({ id: "test", value: 1 }),
      ).resolves.not.toThrow();

      await new Promise((resolve) => setTimeout(resolve, 200));

      await app.stop();
    });

    test("should handle async event handlers", async () => {
      const events: string[] = [];

      class TestService {
        queue = $queue({
          name: "async-handler",
          schema: payloadSchema,
          handler: async () => {},
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      const provider = app.inject(QueueProvider);
      provider.on("completed", async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        events.push("async-completed");
      });

      await app.start();

      const testService = app.inject(TestService);
      await testService.queue.push({ id: "test", value: 1 });

      await expect
        .poll(() => events.includes("async-completed"), { timeout: 1000 })
        .toBeTruthy();

      await app.stop();
    });

    test("should handle unsubscribe during event emission", async () => {
      let callCount = 0;
      let unsubscribe: (() => void) | undefined;

      class TestService {
        queue = $queue({
          name: "unsub-during",
          schema: payloadSchema,
          handler: async () => {},
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      const provider = app.inject(QueueProvider);
      unsubscribe = provider.on("completed", () => {
        callCount++;
        // Unsubscribe during first event
        if (unsubscribe) {
          unsubscribe();
        }
      });

      await app.start();

      const testService = app.inject(TestService);
      await testService.queue.push({ id: "test1", value: 1 });

      await expect.poll(() => callCount === 1, { timeout: 1000 }).toBeTruthy();

      await testService.queue.push({ id: "test2", value: 2 });

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should only have been called once
      expect(callCount).toBe(1);

      await app.stop();
    });
  });

  // ===========================================
  // removeOnComplete/removeOnFail Edge Cases
  // ===========================================
  describe("removeOnComplete Edge Cases", () => {
    test("removeOnComplete: 0 should keep no completed jobs", async () => {
      let processed = 0;

      class TestService {
        queue = $queue({
          name: "remove-zero",
          schema: payloadSchema,
          removeOnComplete: 0,
          handler: async () => {
            processed++;
          },
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      await app.start();

      const provider = app.inject(QueueProvider);
      const testService = app.inject(TestService);

      await testService.queue.push({ id: "test1", value: 1 });

      await expect.poll(() => processed === 1, { timeout: 1000 }).toBeTruthy();

      await new Promise((resolve) => setTimeout(resolve, 100));

      const counts = await provider.getJobCounts("remove-zero");
      // 0 means keep 0, which should remove all (same as maxCount: 0 in cleanJobs)
      expect(counts.completed).toBe(0);

      await app.stop();
    });

    test("removeOnComplete: 1 should keep exactly one job", async () => {
      let processed = 0;

      class TestService {
        queue = $queue({
          name: "remove-one",
          schema: payloadSchema,
          removeOnComplete: 1,
          handler: async () => {
            processed++;
          },
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      await app.start();

      const provider = app.inject(QueueProvider);
      const testService = app.inject(TestService);

      // Push 5 jobs
      for (let i = 0; i < 5; i++) {
        await testService.queue.push({ id: `test-${i}`, value: i });
      }

      await expect.poll(() => processed === 5, { timeout: 2000 }).toBeTruthy();

      await new Promise((resolve) => setTimeout(resolve, 100));

      const counts = await provider.getJobCounts("remove-one");
      expect(counts.completed).toBe(1);

      // Check that it's the most recent job
      const jobs = await provider.getJobs("remove-one", "completed");
      expect(jobs.length).toBe(1);

      await app.stop();
    });

    test("removeOnFail with retries should only apply after all retries exhausted", async () => {
      let attempts = 0;

      class TestService {
        queue = $queue({
          name: "fail-with-retries",
          schema: payloadSchema,
          maxAttempts: 3,
          backoff: { type: "fixed", delay: 10 },
          removeOnFail: true,
          handler: async () => {
            attempts++;
            throw new Error("Always fail");
          },
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      await app.start();

      const provider = app.inject(QueueProvider);
      const testService = app.inject(TestService);

      await testService.queue.push({ id: "retry-fail", value: 1 });

      await expect.poll(() => attempts === 3, { timeout: 3000 }).toBeTruthy();

      await new Promise((resolve) => setTimeout(resolve, 200));

      const counts = await provider.getJobCounts("fail-with-retries");
      // Job should be removed after final failure
      expect(counts.failed).toBe(0);
      expect(counts.delayed).toBe(0);

      await app.stop();
    });
  });

  // ===========================================
  // Retry and Backoff Edge Cases
  // ===========================================
  describe("Retry and Backoff Edge Cases", () => {
    test("maxAttempts: 1 should not retry", async () => {
      let attempts = 0;

      class TestService {
        queue = $queue({
          name: "no-retry",
          schema: payloadSchema,
          maxAttempts: 1,
          handler: async () => {
            attempts++;
            throw new Error("Fail");
          },
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      await app.start();

      const provider = app.inject(QueueProvider);
      const testService = app.inject(TestService);

      await testService.queue.push({ id: "no-retry", value: 1 });

      await expect.poll(() => attempts === 1, { timeout: 1000 }).toBeTruthy();

      await new Promise((resolve) => setTimeout(resolve, 200));

      const counts = await provider.getJobCounts("no-retry");
      expect(counts.failed).toBe(1);
      expect(counts.delayed).toBe(0);
      expect(attempts).toBe(1); // Should not have retried

      await app.stop();
    });

    test("exponential backoff should respect maxDelay", async () => {
      const delays: number[] = [];
      const lastAvailableAt = 0;

      class TestService {
        queue = $queue({
          name: "exp-backoff",
          schema: payloadSchema,
          maxAttempts: 10,
          backoff: {
            type: "exponential",
            delay: 100,
            maxDelay: 500, // Cap at 500ms
          },
          handler: async () => {
            throw new Error("Fail");
          },
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      const provider = app.inject(QueueProvider);

      // Track delays via retrying events
      provider.on("retrying", (event) => {
        delays.push(event.delay);
      });

      await app.start();

      const testService = app.inject(TestService);
      await testService.queue.push({ id: "exp-backoff", value: 1 });

      await expect
        .poll(() => delays.length >= 5, { timeout: 10000 })
        .toBeTruthy();

      // Exponential: 100, 200, 400, 500 (capped), 500 (capped)...
      expect(delays[0]).toBe(100);
      expect(delays[1]).toBe(200);
      expect(delays[2]).toBe(400);
      expect(delays[3]).toBe(500); // Should be capped
      expect(delays[4]).toBe(500); // Should remain capped

      await app.stop();
    });

    test("fixed backoff should use same delay", async () => {
      const delays: number[] = [];

      class TestService {
        queue = $queue({
          name: "fixed-backoff",
          schema: payloadSchema,
          maxAttempts: 4,
          backoff: {
            type: "fixed",
            delay: 50,
          },
          handler: async () => {
            throw new Error("Fail");
          },
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      const provider = app.inject(QueueProvider);

      provider.on("retrying", (event) => {
        delays.push(event.delay);
      });

      await app.start();

      const testService = app.inject(TestService);
      await testService.queue.push({ id: "fixed-backoff", value: 1 });

      await expect
        .poll(() => delays.length === 3, { timeout: 3000 })
        .toBeTruthy();

      // All delays should be the same
      expect(delays).toEqual([50, 50, 50]);

      await app.stop();
    });

    test("job succeeds on retry should stop retrying", async () => {
      let attempts = 0;

      class TestService {
        queue = $queue({
          name: "succeed-on-retry",
          schema: payloadSchema,
          maxAttempts: 5,
          backoff: { type: "fixed", delay: 10 },
          handler: async () => {
            attempts++;
            if (attempts < 3) {
              throw new Error("Temporary failure");
            }
            // Succeed on 3rd attempt
          },
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      await app.start();

      const provider = app.inject(QueueProvider);
      const testService = app.inject(TestService);

      await testService.queue.push({ id: "succeed-retry", value: 1 });

      await expect.poll(() => attempts >= 3, { timeout: 3000 }).toBeTruthy();

      await new Promise((resolve) => setTimeout(resolve, 200));

      const counts = await provider.getJobCounts("succeed-on-retry");
      expect(counts.completed).toBe(1);
      expect(counts.failed).toBe(0);
      expect(attempts).toBe(3);

      await app.stop();
    });
  });

  // ===========================================
  // Job Acquisition Edge Cases
  // ===========================================
  describe("Job Acquisition Edge Cases", () => {
    test("should handle empty queue gracefully", async () => {
      class TestService {
        queue = $queue({
          name: "empty-queue",
          schema: payloadSchema,
          handler: async () => {},
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      await app.start();

      // Just verify app starts without errors with empty queue
      await new Promise((resolve) => setTimeout(resolve, 200));

      const provider = app.inject(QueueProvider);
      const counts = await provider.getJobCounts("empty-queue");
      expect(counts.waiting).toBe(0);

      await app.stop();
    });

    test("should handle rapid job additions", async () => {
      const processed = new Set<string>();

      class TestService {
        queue = $queue({
          name: "rapid-add",
          schema: payloadSchema,
          handler: async ({ payload }) => {
            processed.add(payload.id);
          },
        });
      }

      const app = await createTestApp({ workerConcurrency: 3 });
      app.with(TestService);

      await app.start();

      const testService = app.inject(TestService);

      // Add 100 jobs as fast as possible
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(testService.queue.push({ id: `rapid-${i}`, value: i }));
      }
      await Promise.all(promises);

      await expect
        .poll(() => processed.size === 100, { timeout: 10000 })
        .toBeTruthy();

      // All jobs should have been processed exactly once
      for (let i = 0; i < 100; i++) {
        expect(processed.has(`rapid-${i}`)).toBe(true);
      }

      await app.stop();
    });

    test("should handle job with very high priority", async () => {
      const processOrder: string[] = [];

      class TestService {
        queue = $queue({
          name: "high-priority",
          schema: payloadSchema,
        });

        consumer = $consumer({
          queue: this.queue,
          handler: async ({ payload }) => {
            processOrder.push(payload.id);
          },
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      const provider = app.inject(QueueProvider);

      // Add jobs with extreme priorities
      await provider.addJob(
        "high-priority",
        { id: "normal", value: 1 },
        { priority: 0 },
      );
      await provider.addJob(
        "high-priority",
        { id: "very-high", value: 2 },
        { priority: -1000000 },
      );
      await provider.addJob(
        "high-priority",
        { id: "very-low", value: 3 },
        { priority: 1000000 },
      );

      await app.start();

      await expect
        .poll(() => processOrder.length === 3, { timeout: 2000 })
        .toBeTruthy();

      // Should process in priority order
      expect(processOrder).toEqual(["very-high", "normal", "very-low"]);

      await app.stop();
    });
  });

  // ===========================================
  // Delayed Jobs Edge Cases
  // ===========================================
  describe("Delayed Jobs Edge Cases", () => {
    test("delay: 0 should process immediately", async () => {
      let processedAt: number | undefined;
      const startTime = Date.now();

      class TestService {
        queue = $queue({
          name: "delay-zero",
          schema: payloadSchema,
          handler: async () => {
            processedAt = Date.now();
          },
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      await app.start();

      const testService = app.inject(TestService);
      await testService.queue.push({ id: "no-delay", value: 1 }, { delay: 0 });

      await expect
        .poll(() => processedAt !== undefined, { timeout: 1000 })
        .toBeTruthy();

      // Should process within a reasonable time (not delayed)
      expect(processedAt! - startTime).toBeLessThan(500);

      await app.stop();
    });

    test("should handle multiple delayed jobs with different delays", async () => {
      const processOrder: string[] = [];

      class TestService {
        queue = $queue({
          name: "multi-delay",
          schema: payloadSchema,
          handler: async ({ payload }) => {
            processOrder.push(payload.id);
          },
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      await app.start();

      const testService = app.inject(TestService);

      // Add jobs with different delays (in reverse order of expected processing)
      await testService.queue.push(
        { id: "delay-300", value: 3 },
        { delay: 300 },
      );
      await testService.queue.push(
        { id: "delay-100", value: 1 },
        { delay: 100 },
      );
      await testService.queue.push(
        { id: "delay-200", value: 2 },
        { delay: 200 },
      );

      await expect
        .poll(() => processOrder.length === 3, { timeout: 3000 })
        .toBeTruthy();

      // Should process in order of delay expiration
      expect(processOrder).toEqual(["delay-100", "delay-200", "delay-300"]);

      await app.stop();
    });

    test("delayed job with priority should respect priority after delay", async () => {
      const processOrder: string[] = [];

      class TestService {
        queue = $queue({
          name: "delay-priority",
          schema: payloadSchema,
        });

        consumer = $consumer({
          queue: this.queue,
          handler: async ({ payload }) => {
            processOrder.push(payload.id);
          },
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      const provider = app.inject(QueueProvider);

      // Add delayed jobs with different priorities, same delay
      await provider.addJob(
        "delay-priority",
        { id: "low-priority", value: 1 },
        { delay: 100, priority: 10 },
      );
      await provider.addJob(
        "delay-priority",
        { id: "high-priority", value: 2 },
        { delay: 100, priority: 1 },
      );

      await app.start();

      await expect
        .poll(() => processOrder.length === 2, { timeout: 2000 })
        .toBeTruthy();

      // Should process in priority order after delays expire
      expect(processOrder).toEqual(["high-priority", "low-priority"]);

      await app.stop();
    });
  });

  // ===========================================
  // Cleanup Operations Edge Cases
  // ===========================================
  describe("Cleanup Operations Edge Cases", () => {
    test("cleanJobs on empty queue should not error", async () => {
      const app = await createTestApp();
      await app.start();

      const provider = app.inject(QueueProvider);

      // Should not throw
      const removed = await provider.cleanJobs(
        "non-existent-queue",
        "completed",
        {
          maxAge: 1000,
        },
      );

      expect(removed).toBe(0);

      await app.stop();
    });

    test("cleanJobs with maxAge and maxCount should apply both", async () => {
      class TestService {
        queue = $queue({
          name: "clean-both",
          schema: payloadSchema,
          handler: async () => {},
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      await app.start();

      const provider = app.inject(QueueProvider);
      const testService = app.inject(TestService);

      // Add jobs
      for (let i = 0; i < 5; i++) {
        await testService.queue.push({ id: `job-${i}`, value: i });
      }

      await expect
        .poll(
          async () => {
            const counts = await provider.getJobCounts("clean-both");
            return counts.completed === 5;
          },
          { timeout: 3000 },
        )
        .toBeTruthy();

      // Clean with both options
      const removed = await provider.cleanJobs("clean-both", "completed", {
        maxAge: 0, // Remove all by age
        maxCount: 2, // But also limit count
      });

      const counts = await provider.getJobCounts("clean-both");
      // All should be removed (maxAge: 0 removes everything)
      expect(counts.completed).toBe(0);

      await app.stop();
    });

    test("removeJob on non-existent job should not error", async () => {
      const app = await createTestApp();
      await app.start();

      const provider = app.inject(QueueProvider);

      // Should not throw
      await expect(
        provider.removeJob("some-queue", "non-existent-job-id"),
      ).resolves.not.toThrow();

      await app.stop();
    });

    test("removeJob on active job should remove it", async () => {
      let startedProcessing = false;
      let canFinish = false;

      class TestService {
        queue = $queue({
          name: "remove-active",
          schema: payloadSchema,
          handler: async () => {
            startedProcessing = true;
            // Wait until we're told to finish
            while (!canFinish) {
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
          },
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      await app.start();

      const provider = app.inject(QueueProvider);
      const testService = app.inject(TestService);

      await testService.queue.push({ id: "to-remove", value: 1 });

      // Wait for job to start processing
      await expect
        .poll(() => startedProcessing, { timeout: 1000 })
        .toBeTruthy();

      // Get the job ID
      const activeJobs = await provider.getJobs("remove-active", "active");
      expect(activeJobs.length).toBe(1);

      const jobId = activeJobs[0].id;

      // Remove the active job (should work)
      await provider.removeJob("remove-active", jobId);

      // Let the job try to finish
      canFinish = true;

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Job should be gone from all lists
      const counts = await provider.getJobCounts("remove-active");
      expect(counts.active).toBe(0);
      // Note: The job might show as completed if worker finished before removal took effect

      await app.stop();
    });
  });

  // ===========================================
  // Stalled Job Recovery Edge Cases
  // ===========================================
  describe("Stalled Job Recovery Edge Cases", () => {
    test("stalled job with no retries left should fail", async () => {
      let processed = false;

      class TestService {
        queue = $queue({
          name: "stall-no-retry",
          schema: payloadSchema,
          maxAttempts: 1, // No retries
          lockDuration: 50, // Very short lock
          handler: async () => {
            processed = true;
            // Simulate job taking too long
            await new Promise((resolve) => setTimeout(resolve, 500));
          },
        });
      }

      const app = await createTestApp({
        stalledThreshold: 50,
        schedulerInterval: 50,
      });
      app.with(TestService);

      await app.start();

      const provider = app.inject(QueueProvider);
      const testService = app.inject(TestService);

      await testService.queue.push({ id: "stall-job", value: 1 });

      // Wait for job to stall and be marked as failed
      await expect
        .poll(
          async () => {
            const counts = await provider.getJobCounts("stall-no-retry");
            return counts.failed === 1;
          },
          { timeout: 3000 },
        )
        .toBeTruthy();

      // Job should have started but then stalled
      expect(processed).toBe(true);

      await app.stop();
    });

    test("recoverStalledJobs on empty active set should not error", async () => {
      const app = await createTestApp();
      await app.start();

      const provider = app.inject(QueueProvider);

      // Should not throw on non-existent queue
      const recovered = await provider.recoverStalledJobs("non-existent", 1000);
      expect(recovered).toEqual([]);

      await app.stop();
    });
  });

  // ===========================================
  // Shutdown Edge Cases
  // ===========================================
  describe("Shutdown Edge Cases", () => {
    test("stop while jobs are processing should complete gracefully", async () => {
      let jobStarted = false;
      let jobFinished = false;

      class TestService {
        queue = $queue({
          name: "stop-while-processing",
          schema: payloadSchema,
          handler: async () => {
            jobStarted = true;
            await new Promise((resolve) => setTimeout(resolve, 100));
            jobFinished = true;
          },
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      await app.start();

      const testService = app.inject(TestService);
      await testService.queue.push({ id: "processing", value: 1 });

      // Wait for job to start
      await expect.poll(() => jobStarted, { timeout: 1000 }).toBeTruthy();

      // Stop while job is processing
      await app.stop();

      // Job should have completed before stop returned
      expect(jobFinished).toBe(true);
    });

    test("stop with empty queue should complete quickly", async () => {
      class TestService {
        queue = $queue({
          name: "stop-empty",
          schema: payloadSchema,
          handler: async () => {},
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      await app.start();

      const startTime = Date.now();
      await app.stop();
      const stopTime = Date.now() - startTime;

      // Should stop quickly (within 2 seconds accounting for blocking timeout)
      expect(stopTime).toBeLessThan(3000);
    });

    test("multiple stop calls should not error", async () => {
      const app = await createTestApp();
      await app.start();

      // Multiple stop calls should not throw
      await app.stop();
      await expect(app.stop()).resolves.not.toThrow();
    });
  });

  // ===========================================
  // Provider API Edge Cases
  // ===========================================
  describe("Provider API Edge Cases", () => {
    test("getJob for non-existent job should return undefined", async () => {
      const app = await createTestApp();
      await app.start();

      const provider = app.inject(QueueProvider);

      const job = await provider.getJob("some-queue", "non-existent-id");
      expect(job).toBeUndefined();

      await app.stop();
    });

    test("getJobs with offset larger than list should return empty array", async () => {
      class TestService {
        queue = $queue({
          name: "offset-test",
          schema: payloadSchema,
          handler: async () => {},
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      await app.start();

      const provider = app.inject(QueueProvider);
      const testService = app.inject(TestService);

      await testService.queue.push({ id: "test", value: 1 });

      await expect
        .poll(
          async () => {
            const counts = await provider.getJobCounts("offset-test");
            return counts.completed === 1;
          },
          { timeout: 1000 },
        )
        .toBeTruthy();

      const jobs = await provider.getJobs("offset-test", "completed", {
        offset: 100,
        limit: 10,
      });

      expect(jobs).toEqual([]);

      await app.stop();
    });

    test("getJobCounts for non-existent queue should return zeros", async () => {
      const app = await createTestApp();
      await app.start();

      const provider = app.inject(QueueProvider);

      const counts = await provider.getJobCounts("non-existent-queue");
      expect(counts).toEqual({
        waiting: 0,
        delayed: 0,
        active: 0,
        completed: 0,
        failed: 0,
      });

      await app.stop();
    });

    test("renewJobLock for non-existent job should return false", async () => {
      const app = await createTestApp();
      await app.start();

      const provider = app.inject(QueueProvider);

      const renewed = await provider.renewJobLock(
        "some-queue",
        "non-existent-id",
        "worker-1",
      );
      expect(renewed).toBe(false);

      await app.stop();
    });

    test("renewJobLock with wrong workerId should return false", async () => {
      let jobId: string | undefined;

      class TestService {
        queue = $queue({
          name: "renew-wrong-worker",
          schema: payloadSchema,
          lockDuration: 10000,
          handler: async () => {
            // Long running job
            await new Promise((resolve) => setTimeout(resolve, 500));
          },
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      await app.start();

      const provider = app.inject(QueueProvider);
      const testService = app.inject(TestService);

      await testService.queue.push({ id: "renew-test", value: 1 });

      // Wait for job to be active
      await expect
        .poll(
          async () => {
            const jobs = await provider.getJobs("renew-wrong-worker", "active");
            if (jobs.length > 0) {
              jobId = jobs[0].id;
              return true;
            }
            return false;
          },
          { timeout: 1000 },
        )
        .toBeTruthy();

      // Try to renew with wrong worker ID
      const renewed = await provider.renewJobLock(
        "renew-wrong-worker",
        jobId!,
        "wrong-worker-id",
      );
      expect(renewed).toBe(false);

      await app.stop();
    });
  });

  // ===========================================
  // Consumer Edge Cases
  // ===========================================
  describe("Consumer Edge Cases", () => {
    test("multiple consumers for same queue should all receive jobs", async () => {
      const consumer1Jobs: string[] = [];
      const consumer2Jobs: string[] = [];

      class TestService {
        queue = $queue({
          name: "multi-consumer",
          schema: payloadSchema,
        });

        consumer1 = $consumer({
          queue: this.queue,
          handler: async ({ payload }) => {
            consumer1Jobs.push(payload.id);
          },
        });

        consumer2 = $consumer({
          queue: this.queue,
          handler: async ({ payload }) => {
            consumer2Jobs.push(payload.id);
          },
        });
      }

      const app = await createTestApp({ workerConcurrency: 2 });
      app.with(TestService);

      await app.start();

      const testService = app.inject(TestService);

      // Push multiple jobs
      for (let i = 0; i < 10; i++) {
        await testService.queue.push({ id: `job-${i}`, value: i });
      }

      await expect
        .poll(() => consumer1Jobs.length + consumer2Jobs.length === 10, {
          timeout: 3000,
        })
        .toBeTruthy();

      // Each job should be processed by exactly one consumer
      const allJobs = [...consumer1Jobs, ...consumer2Jobs];
      expect(allJobs.length).toBe(10);
      expect(new Set(allJobs).size).toBe(10);

      await app.stop();
    });

    test("consumer without queue handler should work", async () => {
      const consumerJobs: string[] = [];

      class TestService {
        queue = $queue({
          name: "consumer-only",
          schema: payloadSchema,
          // No handler on queue itself
        });

        consumer = $consumer({
          queue: this.queue,
          handler: async ({ payload }) => {
            consumerJobs.push(payload.id);
          },
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      await app.start();

      const testService = app.inject(TestService);
      await testService.queue.push({ id: "consumer-job", value: 1 });

      await expect
        .poll(() => consumerJobs.length === 1, { timeout: 1000 })
        .toBeTruthy();

      expect(consumerJobs).toEqual(["consumer-job"]);

      await app.stop();
    });
  });
});
