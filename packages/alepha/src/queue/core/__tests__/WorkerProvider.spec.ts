import { $hook, $inject, Alepha, type Infer, type ZType, z } from "alepha";
import { $logger } from "alepha/logger";
import { describe, expect, test, vi } from "vitest";

import {
  MemoryQueueProvider,
  QueueCodec,
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

/**
 * Builds a service that registers one queue consumer on start.
 *
 * Replaces the `$queue` / `$consumer` primitives these tests used to declare —
 * queues are now registered imperatively against `WorkerProvider`.
 */
const consumerService = <T extends ZType>(
  name: string,
  schema: T,
  handler: (message: { payload: Infer<T> }) => Promise<void>,
) =>
  class TestConsumerService {
    protected readonly queueProvider = $inject(QueueProvider);
    protected readonly workerProvider = $inject(WorkerProvider);

    // Default priority, so it lands before WorkerProvider's `priority: "last"`
    // start hook boots the polling loop.
    protected readonly registration = $hook({
      on: "start",
      handler: () => {
        this.workerProvider.register({
          name,
          schema,
          provider: this.queueProvider,
          handler,
        });
      },
    });
  };

describe("WorkerProvider", () => {
  const createTestApp = async (
    options: {
      workerConcurrency?: number;
      workerInterval?: number;
      workerMaxInterval?: number;
      queueProvider?: any;
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
      use: options.queueProvider ?? MemoryQueueProvider,
    });

    app.with(QueueCodec);

    return app;
  };

  /**
   * Encode + push + wake, resolved before `start()` so the container lock
   * does not reject a late inject.
   */
  const producerFor = (app: Alepha) => {
    const provider = app.inject(QueueProvider);
    const codec = app.inject(QueueCodec);
    const worker = app.inject(WorkerProvider);
    return async <T extends ZType>(
      queue: string,
      schema: T,
      payload: Infer<T>,
    ) => {
      await provider.push(queue, codec.encode(schema, payload));
      worker.wakeUp();
    };
  };

  describe("Worker Lifecycle", () => {
    test("should start workers when consumers are present", async () => {
      const app = await createTestApp();
      app.with(consumerService("test", payloadSchema, async () => {}));

      const workerProvider = app.inject(TestWorkerProvider);
      const logSpy = vi.spyOn(workerProvider.log, "debug");

      await app.start();

      expect(logSpy).toHaveBeenCalledWith("Starting worker n-0");
      expect(workerProvider.workersRunning).toBe(1);

      await app.stop();
      expect(workerProvider.workersRunning).toBe(0);
    });

    test("should start multiple workers with concurrency", async () => {
      const app = await createTestApp({ workerConcurrency: 3 });
      app.with(consumerService("test", payloadSchema, async () => {}));

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
      const app = await createTestApp({ workerConcurrency: 2 });
      app.with(consumerService("test", payloadSchema, async () => {}));

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
      const app = await createTestApp();
      app.with(consumerService("test", payloadSchema, async () => {}));

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

      const app = await createTestApp({ workerInterval: 5 });
      app.with(
        consumerService("test", payloadSchema, async ({ payload }) => {
          messages.push(payload);
        }),
      );
      const push = producerFor(app);

      await app.start();

      await push("test", payloadSchema, { id: "msg1", count: 5 });
      await push("test", payloadSchema, { id: "msg2", count: 10 });

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
      const app = await createTestApp();
      app.with(
        consumerService("test", payloadSchema, async ({ payload }) => {
          if (payload.id === "error") {
            throw new Error("Processing error");
          }
        }),
      );
      const push = producerFor(app);

      const workerProvider = app.inject(TestWorkerProvider);
      const errorSpy = vi.spyOn(workerProvider.log, "error");

      await app.start();

      await push("test", payloadSchema, { id: "error", count: 1 });

      await expect
        .poll(() => errorSpy.mock.calls.length > 0, { timeout: 500 })
        .toBeTruthy();

      // Worker should still be running after processing error
      expect(workerProvider.workersRunning).toBe(1);

      await app.stop();
    });
  });

  describe("Edge Cases", () => {
    test("should handle malformed JSON messages", async () => {
      const app = await createTestApp();
      app.with(consumerService("test", payloadSchema, async () => {}));

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
      const app = await createTestApp();
      app.with(consumerService("test", payloadSchema, async () => {}));

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
      // The producer encodes and the worker decodes exactly once each.
      // Anything whose encoded form differs from its runtime form used to
      // round-trip only by luck of JSON.stringify.
      const received: Array<{ id: string; at: string }> = [];

      const schema = z.object({
        id: z.text(),
        at: z.string().meta({ format: "date-time" }),
      });

      const app = await createTestApp({ workerInterval: 5 });
      app.with(
        consumerService("roundtrip", schema, async (msg) => {
          received.push(msg.payload as { id: string; at: string });
        }),
      );
      const push = producerFor(app);

      await app.start();

      const sent = { id: "a1", at: "2026-07-25T10:00:00.000Z" };
      await push("roundtrip", schema, sent);

      await expect
        .poll(() => received.length === 1, { timeout: 2000 })
        .toBeTruthy();
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

      const app = await createTestApp({
        workerInterval: 5,
        workerMaxInterval: 20,
        queueProvider: FlakyQueueProvider,
      });
      app.with(
        consumerService("flaky", payloadSchema, async (msg) => {
          processed.push(msg.payload.id);
        }),
      );
      const push = producerFor(app);

      const workerProvider = app.inject(TestWorkerProvider);
      await app.start();

      // Let the failing polls happen first.
      await new Promise((r) => setTimeout(r, 50));

      // The worker must still be alive to pick this up.
      expect(workerProvider.workersRunning).toBe(1);

      await push("flaky", payloadSchema, { id: "after-blip", count: 1 });

      await expect
        .poll(() => processed.length === 1, { timeout: 2000 })
        .toBeTruthy();
      expect(processed).toEqual(["after-blip"]);

      await app.stop();
    });

    test("should handle abort signal during wait", async () => {
      const app = await createTestApp({ workerInterval: 5000 });
      app.with(consumerService("test", payloadSchema, async () => {}));

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
