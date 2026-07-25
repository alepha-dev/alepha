import { Alepha, z } from "alepha";
import { $logger } from "alepha/logger";
import { describe, expect, test, vi } from "vitest";
import {
  $consumer,
  $queue,
  MemoryQueueProvider,
  QueueProvider,
  queueWorkerOptions,
  WorkerProvider,
} from "../index.ts";

const payloadSchema = z.object({
  id: z.text(),
  count: z.integer(),
});

class TestWorkerProvider extends WorkerProvider {
  public readonly log = $logger();
  public workersRunning = 0;
  public workerIntervals: Record<number, number> = {};
  public abortController = new AbortController();
  public waitForNextMessage(n: number): Promise<void> {
    return super.waitForNextMessage(n);
  }
}

describe("WorkerProvider", () => {
  const createTestApp = async (
    options: {
      workerConcurrency?: number;
      workerInterval?: number;
      workerMaxInterval?: number;
    } = {},
  ) => {
    const app = Alepha.create();

    app.store.mut(queueWorkerOptions, () => ({
      concurrency: options.workerConcurrency ?? 1,
      interval: options.workerInterval ?? 10,
      maxInterval: options.workerMaxInterval ?? 1000,
    }));

    app.with({
      provide: WorkerProvider,
      use: TestWorkerProvider,
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

      const workerProvider = app.inject(TestWorkerProvider);
      const logSpy = vi.spyOn(workerProvider.log, "debug");

      await app.start();

      expect(logSpy).toHaveBeenCalledWith("Starting worker n-0");
      expect(workerProvider.workersRunning).toBe(1);

      await app.stop();
      expect(workerProvider.workersRunning).toBe(0);
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

      const workerProvider = app.inject(TestWorkerProvider);
      const logSpy = vi.spyOn(workerProvider.log, "debug");

      await app.start();

      expect(logSpy).toHaveBeenCalledWith("Starting worker n-0");
      expect(logSpy).toHaveBeenCalledWith("Starting worker n-1");
      expect(logSpy).toHaveBeenCalledWith("Starting worker n-2");
      expect(workerProvider.workersRunning).toBe(3);

      await app.stop();
      expect(workerProvider.workersRunning).toBe(0);
    });

    test("should not start workers when no consumers", async () => {
      const app = await createTestApp();

      const workerProvider = app.inject(TestWorkerProvider);
      const logSpy = vi.spyOn(workerProvider.log, "debug");

      await app.start();

      expect(logSpy).not.toHaveBeenCalledWith(
        expect.stringMatching(/Starting worker/),
      );
      expect(workerProvider.workersRunning).toBe(0);

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

      const workerProvider = app.inject(TestWorkerProvider);
      const debugSpy = vi.spyOn(workerProvider.log, "debug");

      await app.start();
      expect(workerProvider.workersRunning).toBe(2);

      // Simulate worker crash by manually decrementing counter
      workerProvider.workersRunning = 1;

      // Call wakeUp - should detect missing worker and restart it
      workerProvider.wakeUp();

      expect(debugSpy).toHaveBeenCalledWith("Waking up workers...");
      expect(workerProvider.workersRunning).toBe(2);

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

      const workerProvider = app.inject(TestWorkerProvider);

      await app.start();

      const oldController = workerProvider.abortController;
      expect(oldController.signal.aborted).toBe(false);

      workerProvider.wakeUp();

      const newController = workerProvider.abortController;
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

      const workerProvider = app.inject(TestWorkerProvider);
      const errorSpy = vi.spyOn(workerProvider.log, "error");

      await app.start();

      const testService = app.inject(TestService);
      await testService.queue.push({ id: "error", count: 1 });

      await expect
        .poll(() => errorSpy.mock.calls.length > 0, { timeout: 500 })
        .toBeTruthy();

      // Worker should still be running after processing error
      expect(workerProvider.workersRunning).toBe(1);

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

      const workerProvider = app.inject(TestWorkerProvider);
      const queueProvider = app.inject(QueueProvider);
      const errorSpy = vi.spyOn(workerProvider.log, "error");

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
      expect(workerProvider.workersRunning).toBe(1);

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

      const workerProvider = app.inject(TestWorkerProvider);
      const queueProvider = app.inject(QueueProvider);
      const errorSpy = vi.spyOn(workerProvider.log, "error");

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
      expect(workerProvider.workersRunning).toBe(1);

      await app.stop();
    });

    test("should round-trip a payload through the wire format", async () => {
      // `push` decoded an already-runtime payload and the worker decoded it
      // again — two decodes, no encode. `$topic` gets this right (encode at
      // publish, decode at receive); here anything whose encoded form differs
      // from its runtime form round-tripped only by luck of JSON.stringify.
      const received: Array<{ id: string; at: string }> = [];

      const schema = z.object({
        id: z.text(),
        at: z.string().meta({ format: "date-time" }),
      });

      class TestService {
        queue = $queue({
          name: "roundtrip",
          schema,
          handler: async (msg) => {
            received.push(msg.payload as { id: string; at: string });
          },
        });
      }

      const app = await createTestApp({ workerInterval: 5 });
      app.with(TestService);
      const service = app.inject(TestService);
      await app.start();

      const sent = { id: "a1", at: "2026-07-25T10:00:00.000Z" };
      await service.queue.push(sent);

      const deadline = Date.now() + 2000;
      while (received.length === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 10));
      }

      expect(received).toEqual([sent]);

      await app.stop();
    });

    test("should keep polling after a pop() failure", async () => {
      // A transient backend error (a Redis blip) used to escape the worker
      // loop entirely: the .catch logged "crashed" and decremented
      // workersRunning, so at the default concurrency of 1 polling stopped
      // for good and queued work silently stopped being processed.
      let popCalls = 0;
      const processed: string[] = [];

      class FlakyQueueProvider extends MemoryQueueProvider {
        public override async pop(name: string) {
          popCalls++;
          if (popCalls <= 2) {
            throw new Error("backend unavailable");
          }
          return super.pop(name);
        }
      }

      class TestService {
        queue = $queue({
          name: "flaky",
          schema: payloadSchema,
          handler: async (msg) => {
            processed.push(msg.payload.id);
          },
        });
      }

      const app = Alepha.create();
      app.store.mut(queueWorkerOptions, () => ({
        concurrency: 1,
        interval: 5,
        maxInterval: 20,
      }));
      app.with({ provide: WorkerProvider, use: TestWorkerProvider });
      app.with({ provide: QueueProvider, use: FlakyQueueProvider });
      app.with(TestService);

      const workerProvider = app.inject(TestWorkerProvider);
      const service = app.inject(TestService);
      await app.start();

      // Let the failing polls happen first.
      await new Promise((r) => setTimeout(r, 50));

      // The worker must still be alive to pick this up.
      expect(workerProvider.workersRunning).toBe(1);

      await service.queue.push({ id: "after-blip", count: 1 });

      const deadline = Date.now() + 2000;
      while (processed.length === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 10));
      }

      expect(processed).toEqual(["after-blip"]);

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

      const workerProvider = app.inject(TestWorkerProvider);
      const warnSpy = vi.spyOn(workerProvider.log, "warn");

      await app.start();

      // Abort the controller to simulate abort during wait
      workerProvider.abortController.abort();

      // This should detect the abort and return early
      await workerProvider.waitForNextMessage(0);

      expect(warnSpy).toHaveBeenCalledWith("Worker n-0 aborted.");

      await app.stop();
    });
  });
});
