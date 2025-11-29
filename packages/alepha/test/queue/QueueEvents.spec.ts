import { Alepha, t } from "alepha";
import {
  $queue,
  MemoryQueueProvider,
  type QueueEvent,
  type QueueEventActive,
  type QueueEventCompleted,
  type QueueEventFailed,
  type QueueEventRemoved,
  type QueueEventRetrying,
  type QueueEventWaiting,
  QueueProvider,
} from "alepha/queue";
import { describe, expect, test } from "vitest";

const payloadSchema = t.object({
  id: t.text(),
  count: t.integer(),
});

describe("Queue Events", () => {
  const createTestApp = async (
    options: { workerConcurrency?: number; blockingTimeout?: number } = {},
  ) => {
    const app = Alepha.create({
      env: {
        QUEUE_WORKER_CONCURRENCY: options.workerConcurrency ?? 1,
        QUEUE_WORKER_BLOCKING_TIMEOUT: options.blockingTimeout ?? 1,
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

  describe("Event Emission", () => {
    test("should emit waiting event when job is added", async () => {
      const events: QueueEvent[] = [];

      class TestService {
        queue = $queue({
          name: "test-waiting",
          schema: payloadSchema,
          handler: async () => {},
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      const provider = app.inject(QueueProvider);
      provider.on("waiting", (event) => {
        events.push(event);
      });

      await app.start();

      const testService = app.inject(TestService);
      await testService.queue.push({ id: "event-test", count: 1 });

      expect(events.length).toBe(1);
      expect(events[0].type).toBe("waiting");
      expect((events[0] as QueueEventWaiting).jobId).toContain("job_");

      await app.stop();
    });

    test("should emit active event when job is acquired", async () => {
      const events: QueueEventActive[] = [];

      class TestService {
        queue = $queue({
          name: "test-active",
          schema: payloadSchema,
          handler: async () => {},
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      const provider = app.inject(QueueProvider);
      provider.on("active", (event) => {
        events.push(event);
      });

      await app.start();

      const testService = app.inject(TestService);
      await testService.queue.push({ id: "active-test", count: 1 });

      await expect
        .poll(() => events.length === 1, { timeout: 1000 })
        .toBeTruthy();

      expect(events[0].type).toBe("active");
      expect(events[0].workerId).toBeDefined();
      expect(events[0].workerId.length).toBeGreaterThan(0);
      expect(events[0].attempt).toBe(1);

      await app.stop();
    });

    test("should emit completed event when job finishes", async () => {
      const events: QueueEventCompleted[] = [];

      class TestService {
        queue = $queue({
          name: "test-completed",
          schema: payloadSchema,
          handler: async () => {
            // Job completes successfully
          },
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      const provider = app.inject(QueueProvider);
      provider.on("completed", (event) => {
        events.push(event);
      });

      await app.start();

      const testService = app.inject(TestService);
      await testService.queue.push({ id: "complete-test", count: 1 });

      await expect
        .poll(() => events.length === 1, { timeout: 1000 })
        .toBeTruthy();

      expect(events[0].type).toBe("completed");
      expect(events[0].duration).toBeGreaterThanOrEqual(0);

      await app.stop();
    });

    test("should emit failed event when job fails permanently", async () => {
      const events: QueueEventFailed[] = [];

      class TestService {
        queue = $queue({
          name: "test-failed",
          schema: payloadSchema,
          handler: async () => {
            throw new Error("Test failure");
          },
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      const provider = app.inject(QueueProvider);
      provider.on("failed", (event) => {
        events.push(event);
      });

      await app.start();

      const testService = app.inject(TestService);
      await testService.queue.push({ id: "fail-test", count: 1 });

      await expect
        .poll(() => events.length === 1, { timeout: 1000 })
        .toBeTruthy();

      expect(events[0].type).toBe("failed");
      expect(events[0].error).toBe("Test failure");
      expect(events[0].attempts).toBe(1);

      await app.stop();
    });

    test("should emit retrying event when job fails but has retries", async () => {
      const events: QueueEventRetrying[] = [];
      let attempts = 0;

      class TestService {
        queue = $queue({
          name: "test-retrying",
          schema: payloadSchema,
          maxAttempts: 3,
          backoff: { type: "fixed", delay: 10 },
          handler: async () => {
            attempts++;
            if (attempts < 2) {
              throw new Error("Temporary failure");
            }
          },
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      const provider = app.inject(QueueProvider);
      provider.on("retrying", (event) => {
        events.push(event);
      });

      await app.start();

      const testService = app.inject(TestService);
      await testService.queue.push({ id: "retry-test", count: 1 });

      await expect
        .poll(() => events.length >= 1, { timeout: 1000 })
        .toBeTruthy();

      expect(events[0].type).toBe("retrying");
      expect(events[0].error).toBe("Temporary failure");
      expect(events[0].attempt).toBe(2);
      expect(events[0].delay).toBe(10);

      await app.stop();
    });

    test("should emit removed event when job is manually removed", async () => {
      const events: QueueEventRemoved[] = [];

      class TestService {
        queue = $queue({
          name: "test-removed",
          schema: payloadSchema,
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      const provider = app.inject(QueueProvider);
      provider.on("removed", (event) => {
        events.push(event);
      });

      await app.start();

      const testService = app.inject(TestService);
      const job = await provider.addJob("test-removed", {
        id: "remove-test",
        count: 1,
      });
      await provider.removeJob("test-removed", job.id);

      expect(events.length).toBe(1);
      expect(events[0].type).toBe("removed");
      expect(events[0].previousStatus).toBe("waiting");

      await app.stop();
    });

    test("should support wildcard event listener", async () => {
      const events: QueueEvent[] = [];

      class TestService {
        queue = $queue({
          name: "test-wildcard",
          schema: payloadSchema,
          handler: async () => {},
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      const provider = app.inject(QueueProvider);
      provider.on("*", (event) => {
        events.push(event);
      });

      await app.start();

      const testService = app.inject(TestService);
      await testService.queue.push({ id: "wildcard-test", count: 1 });

      await expect
        .poll(() => events.length >= 3, { timeout: 1000 })
        .toBeTruthy();

      const types = events.map((e) => e.type);
      expect(types).toContain("waiting");
      expect(types).toContain("active");
      expect(types).toContain("completed");

      await app.stop();
    });

    test("should allow unsubscribing from events", async () => {
      const events: QueueEvent[] = [];

      class TestService {
        queue = $queue({
          name: "test-unsub",
          schema: payloadSchema,
          handler: async () => {},
        });
      }

      const app = await createTestApp();
      app.with(TestService);

      const provider = app.inject(QueueProvider);
      const unsubscribe = provider.on("completed", (event) => {
        events.push(event);
      });

      await app.start();

      const testService = app.inject(TestService);
      await testService.queue.push({ id: "unsub-test-1", count: 1 });

      await expect
        .poll(() => events.length === 1, { timeout: 1000 })
        .toBeTruthy();

      // Unsubscribe
      unsubscribe();

      await testService.queue.push({ id: "unsub-test-2", count: 2 });

      // Wait a bit to ensure the job completes
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Should still only have 1 event
      expect(events.length).toBe(1);

      await app.stop();
    });
  });
});
