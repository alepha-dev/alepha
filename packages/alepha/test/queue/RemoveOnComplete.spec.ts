import { Alepha, t } from "alepha";
import { describe, expect, test } from "vitest";
import { $queue, MemoryQueueProvider, QueueProvider } from "../../src/queue";

const payloadSchema = t.object({
  id: t.text(),
});

describe("removeOnComplete and removeOnFail", () => {
  const createTestApp = async () => {
    const app = Alepha.create({
      env: {
        QUEUE_WORKER_CONCURRENCY: 1,
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

  describe("removeOnComplete: true", () => {
    test("should remove job immediately after completion", async () => {
      let processed = false;

      class TestService {
        queue = $queue({
          name: "test-remove-complete-true",
          schema: payloadSchema,
          removeOnComplete: true,
          handler: async () => {
            processed = true;
          },
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      await app.start();

      const provider = app.inject(QueueProvider);
      const testService = app.inject(TestService);

      await testService.queue.push({ id: "test1" });

      await expect.poll(() => processed, { timeout: 1000 }).toBeTruthy();

      // Wait a bit for cleanup
      await new Promise((resolve) => setTimeout(resolve, 100));

      const counts = await provider.getJobCounts("test-remove-complete-true");
      expect(counts.completed).toBe(0);

      await app.stop();
    });
  });

  describe("removeOnComplete: number", () => {
    test("should keep only last N completed jobs", async () => {
      let processedCount = 0;

      class TestService {
        queue = $queue({
          name: "test-remove-complete-num",
          schema: payloadSchema,
          removeOnComplete: 2, // Keep only last 2
          handler: async () => {
            processedCount++;
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
        await testService.queue.push({ id: `test-${i}` });
      }

      await expect
        .poll(() => processedCount === 5, { timeout: 2000 })
        .toBeTruthy();

      // Wait for cleanup
      await new Promise((resolve) => setTimeout(resolve, 100));

      const counts = await provider.getJobCounts("test-remove-complete-num");
      expect(counts.completed).toBe(2);

      await app.stop();
    });
  });

  describe("removeOnFail: true", () => {
    test("should remove job immediately after failure", async () => {
      let attempted = false;

      class TestService {
        queue = $queue({
          name: "test-remove-fail-true",
          schema: payloadSchema,
          removeOnFail: true,
          handler: async () => {
            attempted = true;
            throw new Error("Intentional failure");
          },
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      await app.start();

      const provider = app.inject(QueueProvider);
      const testService = app.inject(TestService);

      await testService.queue.push({ id: "fail-test" });

      await expect.poll(() => attempted, { timeout: 1000 }).toBeTruthy();

      // Wait for cleanup
      await new Promise((resolve) => setTimeout(resolve, 100));

      const counts = await provider.getJobCounts("test-remove-fail-true");
      expect(counts.failed).toBe(0);

      await app.stop();
    });
  });

  describe("removeOnFail: number", () => {
    test("should keep only last N failed jobs", async () => {
      let attemptCount = 0;

      class TestService {
        queue = $queue({
          name: "test-remove-fail-num",
          schema: payloadSchema,
          removeOnFail: 3, // Keep only last 3
          handler: async () => {
            attemptCount++;
            throw new Error("Intentional failure");
          },
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      await app.start();

      const provider = app.inject(QueueProvider);
      const testService = app.inject(TestService);

      // Push 6 jobs
      for (let i = 0; i < 6; i++) {
        await testService.queue.push({ id: `fail-${i}` });
      }

      await expect
        .poll(() => attemptCount === 6, { timeout: 2000 })
        .toBeTruthy();

      // Wait for cleanup
      await new Promise((resolve) => setTimeout(resolve, 100));

      const counts = await provider.getJobCounts("test-remove-fail-num");
      expect(counts.failed).toBe(3);

      await app.stop();
    });
  });

  describe("removeOnComplete: false (default)", () => {
    test("should keep completed jobs in history", async () => {
      let processed = false;

      class TestService {
        queue = $queue({
          name: "test-keep-complete",
          schema: payloadSchema,
          handler: async () => {
            processed = true;
          },
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      await app.start();

      const provider = app.inject(QueueProvider);
      const testService = app.inject(TestService);

      await testService.queue.push({ id: "keep-test" });

      await expect.poll(() => processed, { timeout: 1000 }).toBeTruthy();

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 100));

      const counts = await provider.getJobCounts("test-keep-complete");
      expect(counts.completed).toBe(1);

      await app.stop();
    });
  });

  describe("Provider API", () => {
    test("addJob should accept removeOnComplete option", async () => {
      const app = await createTestApp();
      await app.start();

      const provider = app.inject(QueueProvider);

      const job = await provider.addJob(
        "direct-test",
        { id: "direct" },
        { removeOnComplete: true },
      );

      expect(job.options.removeOnComplete).toBe(true);

      await app.stop();
    });

    test("addJob should accept removeOnFail option", async () => {
      const app = await createTestApp();
      await app.start();

      const provider = app.inject(QueueProvider);

      const job = await provider.addJob(
        "direct-fail-test",
        { id: "direct" },
        { removeOnFail: 5 },
      );

      expect(job.options.removeOnFail).toBe(5);

      await app.stop();
    });
  });
});
