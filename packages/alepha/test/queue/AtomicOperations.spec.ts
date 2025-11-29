import { Alepha, t } from "alepha";
import {
  $consumer,
  $queue,
  MemoryQueueProvider,
  QueueProvider,
} from "alepha/queue";
import { describe, expect, test } from "vitest";

const payloadSchema = t.object({
  id: t.text(),
  value: t.integer(),
});

describe("Atomic Operations", () => {
  const createTestApp = async (
    options: { workerConcurrency?: number } = {},
  ) => {
    const app = Alepha.create({
      env: {
        QUEUE_WORKER_CONCURRENCY: options.workerConcurrency ?? 1,
        QUEUE_WORKER_BLOCKING_TIMEOUT: 1,
        QUEUE_SCHEDULER_INTERVAL: 100,
        QUEUE_STALLED_THRESHOLD: 100,
      },
    });

    app.with({
      provide: QueueProvider,
      use: MemoryQueueProvider,
    });

    return app;
  };

  describe("Concurrent Worker Access", () => {
    test("should handle concurrent workers acquiring jobs", async () => {
      const processedIds = new Set<string>();
      let processedCount = 0;

      class TestService {
        queue = $queue({
          name: "concurrent-test",
          schema: payloadSchema,
          handler: async ({ payload }) => {
            // Simulate some work
            await new Promise((resolve) => setTimeout(resolve, 10));
            processedIds.add(payload.id);
            processedCount++;
          },
        });
      }

      const app = await createTestApp({ workerConcurrency: 3 });
      app.with(TestService);

      await app.start();

      const testService = app.inject(TestService);

      // Push 10 jobs
      for (let i = 0; i < 10; i++) {
        await testService.queue.push({ id: `job-${i}`, value: i });
      }

      await expect
        .poll(() => processedCount === 10, { timeout: 3000 })
        .toBeTruthy();

      // Verify each job was processed exactly once
      expect(processedIds.size).toBe(10);
      for (let i = 0; i < 10; i++) {
        expect(processedIds.has(`job-${i}`)).toBe(true);
      }

      await app.stop();
    });

    test("should not process same job twice with multiple workers", async () => {
      const processingCounts = new Map<string, number>();
      let totalProcessed = 0;

      class TestService {
        queue = $queue({
          name: "no-double-process",
          schema: payloadSchema,
          handler: async ({ payload }) => {
            const count = processingCounts.get(payload.id) ?? 0;
            processingCounts.set(payload.id, count + 1);
            totalProcessed++;
            // Add small delay to increase chance of race condition
            await new Promise((resolve) => setTimeout(resolve, 5));
          },
        });
      }

      const app = await createTestApp({ workerConcurrency: 5 });
      app.with(TestService);

      await app.start();

      const testService = app.inject(TestService);

      // Push 20 jobs rapidly
      await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          testService.queue.push({ id: `job-${i}`, value: i }),
        ),
      );

      await expect
        .poll(() => totalProcessed === 20, { timeout: 5000 })
        .toBeTruthy();

      // Verify each job was processed exactly once
      for (const [id, count] of processingCounts) {
        expect(count).toBe(1);
      }

      await app.stop();
    });
  });

  describe("Job State Consistency", () => {
    test("should maintain correct job counts through lifecycle", async () => {
      let processedCount = 0;

      class TestService {
        queue = $queue({
          name: "count-test",
          schema: payloadSchema,
          handler: async () => {
            processedCount++;
          },
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      const provider = app.inject(QueueProvider);

      // Add jobs before starting
      await provider.addJob("count-test", { id: "j1", value: 1 });
      await provider.addJob("count-test", { id: "j2", value: 2 });
      await provider.addJob("count-test", { id: "j3", value: 3 });

      let counts = await provider.getJobCounts("count-test");
      expect(counts.waiting).toBe(3);
      expect(counts.active).toBe(0);
      expect(counts.completed).toBe(0);

      await app.start();

      await expect
        .poll(() => processedCount === 3, { timeout: 2000 })
        .toBeTruthy();

      counts = await provider.getJobCounts("count-test");
      expect(counts.waiting).toBe(0);
      expect(counts.active).toBe(0);
      expect(counts.completed).toBe(3);

      await app.stop();
    });

    test("should correctly handle job failure counts", async () => {
      let attemptCount = 0;

      class TestService {
        queue = $queue({
          name: "fail-count-test",
          schema: payloadSchema,
          maxAttempts: 3,
          backoff: { type: "fixed", delay: 10 },
          handler: async () => {
            attemptCount++;
            throw new Error("Always fail");
          },
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      const provider = app.inject(QueueProvider);

      await app.start();

      const testService = app.inject(TestService);
      await testService.queue.push({ id: "fail-job", value: 1 });

      // Wait for all retries
      await expect
        .poll(() => attemptCount === 3, { timeout: 3000 })
        .toBeTruthy();

      // Wait for job to be marked as failed
      await new Promise((resolve) => setTimeout(resolve, 200));

      const counts = await provider.getJobCounts("fail-count-test");
      expect(counts.failed).toBe(1);
      expect(counts.waiting).toBe(0);
      expect(counts.delayed).toBe(0);

      await app.stop();
    });
  });

  describe("Lock Mechanism", () => {
    test("should respect job lock during processing", async () => {
      const processingStart = new Map<string, number>();
      const processingEnd = new Map<string, number>();

      class TestService {
        queue = $queue({
          name: "lock-test",
          schema: payloadSchema,
          lockDuration: 5000, // 5 second lock
          handler: async ({ payload }) => {
            processingStart.set(payload.id, Date.now());
            // Simulate work
            await new Promise((resolve) => setTimeout(resolve, 100));
            processingEnd.set(payload.id, Date.now());
          },
        });
      }

      const app = await createTestApp({ workerConcurrency: 2 });
      app.with(TestService);

      const provider = app.inject(QueueProvider);

      await app.start();

      const testService = app.inject(TestService);
      await testService.queue.push({ id: "lock-job", value: 1 });

      await expect
        .poll(() => processingEnd.has("lock-job"), { timeout: 2000 })
        .toBeTruthy();

      // Verify job was processed exactly once
      expect(processingStart.size).toBe(1);
      expect(processingEnd.size).toBe(1);

      await app.stop();
    });

    test("should complete job with adequate lock duration", async () => {
      let completed = false;

      class TestService {
        queue = $queue({
          name: "lock-complete-test",
          schema: payloadSchema,
          lockDuration: 5000, // 5 second lock - plenty of time for the job
          handler: async () => {
            // Simulate some work
            await new Promise((resolve) => setTimeout(resolve, 50));
            completed = true;
          },
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      await app.start();

      const testService = app.inject(TestService);
      await testService.queue.push({ id: "long-job", value: 1 });

      await expect.poll(() => completed, { timeout: 2000 }).toBeTruthy();

      // Job should complete without stalling
      const provider = app.inject(QueueProvider);
      const counts = await provider.getJobCounts("lock-complete-test");
      expect(counts.completed).toBe(1);
      expect(counts.failed).toBe(0);

      await app.stop();
    });
  });

  describe("Priority Queue", () => {
    test("should process higher priority jobs first", async () => {
      const processOrder: number[] = [];

      class TestService {
        queue = $queue({
          name: "priority-test",
          schema: payloadSchema,
        });

        consumer = $consumer({
          queue: this.queue,
          handler: async ({ payload }) => {
            processOrder.push(payload.value);
          },
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      const provider = app.inject(QueueProvider);

      // Add jobs with different priorities (lower = higher priority)
      await provider.addJob(
        "priority-test",
        { id: "low", value: 3 },
        { priority: 10 },
      );
      await provider.addJob(
        "priority-test",
        { id: "high", value: 1 },
        { priority: 1 },
      );
      await provider.addJob(
        "priority-test",
        { id: "medium", value: 2 },
        { priority: 5 },
      );

      await app.start();

      await expect
        .poll(() => processOrder.length === 3, { timeout: 2000 })
        .toBeTruthy();

      // Should be processed in priority order: 1 (high), 2 (medium), 3 (low)
      expect(processOrder).toEqual([1, 2, 3]);

      await app.stop();
    });
  });

  describe("Delayed Jobs", () => {
    test("should process delayed jobs after delay expires", async () => {
      let processedAt: number | undefined;
      const startTime = Date.now();

      class TestService {
        queue = $queue({
          name: "delay-test",
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
      await testService.queue.push({ id: "delayed", value: 1 }, { delay: 200 });

      await expect
        .poll(() => processedAt !== undefined, { timeout: 2000 })
        .toBeTruthy();

      // Should have been delayed at least 150ms (accounting for scheduler interval)
      expect(processedAt! - startTime).toBeGreaterThanOrEqual(150);

      await app.stop();
    });
  });
});
