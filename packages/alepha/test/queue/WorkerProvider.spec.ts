/** biome-ignore-all lint/complexity/useLiteralKeys: testing */
import { Alepha, t } from "alepha";
import {
  $consumer,
  $queue,
  MemoryQueueProvider,
  QueueProvider,
  WorkerProvider,
} from "alepha/queue";
import { describe, expect, test, vi } from "vitest";

const payloadSchema = t.object({
  id: t.text(),
  count: t.integer(),
});

describe("WorkerProvider", () => {
  const createTestApp = async (
    options: { workerConcurrency?: number; blockingTimeout?: number } = {},
  ) => {
    const app = Alepha.create({
      env: {
        QUEUE_WORKER_CONCURRENCY: options.workerConcurrency ?? 1,
        QUEUE_WORKER_BLOCKING_TIMEOUT: options.blockingTimeout ?? 1,
        QUEUE_SCHEDULER_INTERVAL: 100, // Fast scheduler for tests
        QUEUE_STALLED_THRESHOLD: 100,
      },
    });

    app.with({
      provide: QueueProvider,
      use: MemoryQueueProvider,
    });

    return app;
  };

  describe("Worker Lifecycle", () => {
    test("should start workers when consumers are present", async () => {
      class TestService {
        queue = $queue({
          name: "test",
          schema: payloadSchema,
          handler: async () => {
            // Just a dummy handler for this test
          },
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      const workerProvider = app.inject(WorkerProvider);
      const logSpy = vi.spyOn(workerProvider["log"], "debug");

      await app.start();

      expect(logSpy).toHaveBeenCalledWith("Starting worker n-0");
      expect(workerProvider["workersRunning"]).toBe(1);

      await app.stop();
      expect(workerProvider["workersRunning"]).toBe(0);
    });

    test("should start multiple workers with concurrency", async () => {
      class TestService {
        queue = $queue({
          name: "test",
          schema: payloadSchema,
          handler: async () => {},
        });
      }

      const app = await createTestApp({ workerConcurrency: 3 });
      app.with(TestService);

      const workerProvider = app.inject(WorkerProvider);
      const logSpy = vi.spyOn(workerProvider["log"], "debug");

      await app.start();

      expect(logSpy).toHaveBeenCalledWith("Starting worker n-0");
      expect(logSpy).toHaveBeenCalledWith("Starting worker n-1");
      expect(logSpy).toHaveBeenCalledWith("Starting worker n-2");
      expect(workerProvider["workersRunning"]).toBe(3);

      await app.stop();
      expect(workerProvider["workersRunning"]).toBe(0);
    });

    test("should not start workers when no consumers", async () => {
      const app = await createTestApp();

      const workerProvider = app.inject(WorkerProvider);
      const logSpy = vi.spyOn(workerProvider["log"], "debug");

      await app.start();

      expect(logSpy).not.toHaveBeenCalledWith(
        expect.stringMatching(/Starting worker/),
      );
      expect(workerProvider["workersRunning"]).toBe(0);

      await app.stop();
    });
  });

  describe("Message Processing", () => {
    test("should process messages correctly", async () => {
      const messages: any[] = [];

      class TestService {
        queue = $queue({
          schema: payloadSchema,
          handler: async ({ payload }) => {
            messages.push(payload);
          },
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      await app.start();

      const testService = app.inject(TestService);
      await testService.queue.push({ id: "msg1", count: 5 });
      await testService.queue.push({ id: "msg2", count: 10 });

      await expect
        .poll(() => messages.length === 2, { timeout: 1000 })
        .toBeTruthy();
      expect(messages).toEqual([
        { id: "msg1", count: 5 },
        { id: "msg2", count: 10 },
      ]);

      await app.stop();
    });

    test("should handle message processing errors gracefully", async () => {
      class TestService {
        queue = $queue({
          name: "test",
          schema: payloadSchema,
          handler: async ({ payload }) => {
            if (payload.id === "error") {
              throw new Error("Processing error");
            }
          },
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      const workerProvider = app.inject(WorkerProvider);
      const errorSpy = vi.spyOn(workerProvider["log"], "error");

      await app.start();

      const testService = app.inject(TestService);
      await testService.queue.push({ id: "error", count: 1 });

      await expect
        .poll(() => errorSpy.mock.calls.length > 0, { timeout: 500 })
        .toBeTruthy();

      // Worker should still be running after processing error
      expect(workerProvider["workersRunning"]).toBe(1);

      await app.stop();
    });

    test("should handle consumer with queue descriptor", async () => {
      const messages: any[] = [];

      class TestService {
        queue = $queue({
          name: "test",
          schema: payloadSchema,
        });

        consumer = $consumer({
          queue: this.queue,
          handler: async ({ payload }) => {
            messages.push(payload);
          },
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      await app.start();

      const testService = app.inject(TestService);
      await testService.queue.push({ id: "consumer-test", count: 15 });

      await expect
        .poll(() => messages.length === 1, { timeout: 500 })
        .toBeTruthy();
      expect(messages).toEqual([{ id: "consumer-test", count: 15 }]);

      await app.stop();
    });
  });

  describe("Edge Cases", () => {
    test("should handle invalid payload during processing", async () => {
      class TestService {
        queue = $queue({
          name: "test",
          schema: payloadSchema,
          handler: async () => {},
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      const workerProvider = app.inject(WorkerProvider);
      const queueProvider = app.inject(QueueProvider);
      const errorSpy = vi.spyOn(workerProvider["log"], "error");

      await app.start();

      // Push job with invalid payload directly via job API
      // This bypasses schema validation at push time
      await queueProvider.addJob("test", {
        id: 123, // Should be string
        count: "invalid", // Should be number
      });

      await expect
        .poll(() => errorSpy.mock.calls.length > 0, { timeout: 500 })
        .toBeTruthy();

      // Worker should still be running after processing error
      expect(workerProvider["workersRunning"]).toBe(1);

      await app.stop();
    });

    test("should handle handler errors and mark job as failed", async () => {
      const processedIds: string[] = [];

      class TestService {
        queue = $queue({
          name: "error-test",
          schema: payloadSchema,
          handler: async ({ payload }) => {
            processedIds.push(payload.id);
            if (payload.id === "fail") {
              throw new Error("Handler error");
            }
          },
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      const workerProvider = app.inject(WorkerProvider);
      const queueProvider = app.inject(QueueProvider);
      const errorSpy = vi.spyOn(workerProvider["log"], "error");

      await app.start();

      const testService = app.inject(TestService);
      await testService.queue.push({ id: "fail", count: 1 });

      await expect
        .poll(() => processedIds.includes("fail"), { timeout: 500 })
        .toBeTruthy();

      // Check error was logged
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("failed"),
        expect.any(Error),
      );

      // Job should be marked as failed
      const jobCounts = await queueProvider.getJobCounts("error-test");
      expect(jobCounts.failed).toBe(1);

      // Worker should still be running
      expect(workerProvider["workersRunning"]).toBe(1);

      await app.stop();
    });
  });
});
