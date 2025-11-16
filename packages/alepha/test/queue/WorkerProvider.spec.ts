/** biome-ignore-all lint/complexity/useLiteralKeys: testing */
import { Alepha, t } from "alepha";
import { describe, expect, test, vi } from "vitest";
import {
  $consumer,
  $queue,
  MemoryQueueProvider,
  QueueProvider,
} from "../../src/queue";
import { WorkerProvider } from "../../src/queue/providers/WorkerProvider.ts";

const payloadSchema = t.object({
  id: t.text(),
  count: t.int(),
});

describe("WorkerProvider", () => {
  const createTestApp = async (
    options: {
      workerConcurrency?: number;
      workerInterval?: number;
      workerMaxInterval?: number;
    } = {},
  ) => {
    const app = Alepha.create({
      env: {
        QUEUE_WORKER_CONCURRENCY: options.workerConcurrency ?? 1,
        QUEUE_WORKER_INTERVAL: options.workerInterval ?? 10,
        QUEUE_WORKER_MAX_INTERVAL: options.workerMaxInterval ?? 1000,
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

  describe("WakeUp Functionality", () => {
    test("should wake up workers and start missing ones", async () => {
      class TestService {
        queue = $queue({
          name: "test",
          schema: payloadSchema,
          handler: async () => {},
        });
      }

      const app = await createTestApp({ workerConcurrency: 2 });
      app.with(TestService);

      const workerProvider = app.inject(WorkerProvider);
      const debugSpy = vi.spyOn(workerProvider["log"], "debug");

      await app.start();
      expect(workerProvider["workersRunning"]).toBe(2);

      // Simulate worker crash by manually decrementing counter
      workerProvider["workersRunning"] = 1;

      // Call wakeUp - should detect missing worker and restart it
      workerProvider.wakeUp();

      expect(debugSpy).toHaveBeenCalledWith("Waking up workers...");
      expect(workerProvider["workersRunning"]).toBe(2);

      await app.stop();
    });

    test("should create new AbortController on wakeUp", async () => {
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

      await app.start();

      const oldController = workerProvider["abortController"];
      expect(oldController.signal.aborted).toBe(false);

      workerProvider.wakeUp();

      const newController = workerProvider["abortController"];
      expect(oldController.signal.aborted).toBe(true);
      expect(newController.signal.aborted).toBe(false);
      expect(newController).not.toBe(oldController);

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

      const app = await createTestApp({ workerInterval: 5 });
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
    test("should handle malformed JSON messages", async () => {
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

      // Push malformed JSON directly to the queue
      await queueProvider.push("test", "invalid-json");

      await expect
        .poll(() => errorSpy.mock.calls.length > 0, { timeout: 500 })
        .toBeTruthy();

      expect(errorSpy).toHaveBeenCalledWith(
        "Failed to process message",
        expect.any(Error),
      );

      // Worker should still be running
      expect(workerProvider["workersRunning"]).toBe(1);

      await app.stop();
    });

    test("should handle schema validation errors", async () => {
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

      // Push message with invalid schema
      await queueProvider.push(
        "test",
        JSON.stringify({
          payload: { id: 123, count: "invalid" }, // id should be string, count should be number
        }),
      );

      await expect
        .poll(() => errorSpy.mock.calls.length > 0, { timeout: 500 })
        .toBeTruthy();

      expect(errorSpy).toHaveBeenCalledWith(
        "Failed to process message",
        expect.any(Error),
      );

      // Worker should still be running
      expect(workerProvider["workersRunning"]).toBe(1);

      await app.stop();
    });

    test("should handle abort signal during wait", async () => {
      class TestService {
        queue = $queue({
          name: "test",
          schema: payloadSchema,
          handler: async () => {},
        });
      }

      const app = await createTestApp({ workerInterval: 5000 });
      app.with(TestService);

      const workerProvider = app.inject(WorkerProvider);
      const warnSpy = vi.spyOn(workerProvider["log"], "warn");

      await app.start();

      // Abort the controller to simulate abort during wait
      workerProvider["abortController"].abort();

      // This should detect the abort and return early
      await workerProvider["waitForNextMessage"](0);

      expect(warnSpy).toHaveBeenCalledWith("Worker n-0 aborted.");

      await app.stop();
    });
  });
});
