import { Alepha, createMiddleware, z } from "alepha";
import { describe, expect, test } from "vitest";
import {
  $consumer,
  $queue,
  MemoryQueueProvider,
  QueueProvider,
  queueWorkerOptions,
  WorkerProvider,
} from "../index.ts";
import { WorkerdWorkerProvider } from "../providers/WorkerdWorkerProvider.ts";

const $track = (log: string[], tag: string) =>
  createMiddleware({
    name: `$track:${tag}`,
    handler:
      ({ next }) =>
      async (...args: any[]) => {
        log.push(`${tag}:before`);
        const result = await next(...args);
        log.push(`${tag}:after`);
        return result;
      },
  });

const payloadSchema = z.object({
  id: z.text(),
  count: z.integer(),
});

describe("$consumer middleware", () => {
  test("should apply middleware to consumer handler", async () => {
    const log: string[] = [];

    class TestService {
      queue = $queue({
        name: "test",
        schema: payloadSchema,
      });

      consumer = $consumer({
        queue: this.queue,
        use: [$track(log, "mw")],
        handler: async ({ payload }) => {
          log.push(`handler:${payload.id}`);
        },
      });
    }

    const app = Alepha.create().with({
      provide: QueueProvider,
      use: MemoryQueueProvider,
    });
    app.store.mut(queueWorkerOptions, (current) => ({
      ...current,
      interval: 5,
    }));

    const svc = app.inject(TestService);
    await app.start();

    await svc.queue.push({ id: "msg1", count: 1 });

    await expect.poll(() => log.length === 3, { timeout: 1000 }).toBeTruthy();

    expect(log).toStrictEqual(["mw:before", "handler:msg1", "mw:after"]);

    await app.stop();
  });

  test("should apply middleware on the Cloudflare worker path", async () => {
    const log: string[] = [];

    class TestService {
      queue = $queue({
        name: "cf-test",
        schema: payloadSchema,
      });

      consumer = $consumer({
        queue: this.queue,
        use: [$track(log, "mw")],
        handler: async ({ payload }) => {
          log.push(`handler:${payload.id}`);
        },
      });
    }

    const app = Alepha.create()
      .with({ provide: QueueProvider, use: MemoryQueueProvider })
      .with({ provide: WorkerProvider, use: WorkerdWorkerProvider });

    const svc = app.inject(TestService);
    await app.start();

    // Simulate a Cloudflare Queue delivery — middleware declared in `use`
    // must run on this path exactly like on the Node polling path.
    await app.events.emit("cloudflare:queue", {
      queue: svc.queue.name,
      message: JSON.stringify({ payload: { id: "m1", count: 1 } }),
    } as never);

    expect(log).toStrictEqual(["mw:before", "handler:m1", "mw:after"]);

    await app.stop();
  });

  test("should compose multiple middleware in order", async () => {
    const log: string[] = [];

    class TestService {
      queue = $queue({
        name: "test-multi",
        schema: payloadSchema,
      });

      consumer = $consumer({
        queue: this.queue,
        use: [$track(log, "first"), $track(log, "second")],
        handler: async ({ payload }) => {
          log.push(`handler:${payload.id}`);
        },
      });
    }

    const app = Alepha.create().with({
      provide: QueueProvider,
      use: MemoryQueueProvider,
    });
    app.store.mut(queueWorkerOptions, (current) => ({
      ...current,
      interval: 5,
    }));

    const svc = app.inject(TestService);
    await app.start();

    await svc.queue.push({ id: "msg1", count: 1 });

    await expect.poll(() => log.length === 5, { timeout: 1000 }).toBeTruthy();

    expect(log).toStrictEqual([
      "first:before",
      "second:before",
      "handler:msg1",
      "second:after",
      "first:after",
    ]);

    await app.stop();
  });

  test("should work without middleware", async () => {
    const messages: any[] = [];

    class TestService {
      queue = $queue({
        name: "test-plain",
        schema: payloadSchema,
      });

      consumer = $consumer({
        queue: this.queue,
        handler: async ({ payload }) => {
          messages.push(payload);
        },
      });
    }

    const app = Alepha.create().with({
      provide: QueueProvider,
      use: MemoryQueueProvider,
    });
    app.store.mut(queueWorkerOptions, (current) => ({
      ...current,
      interval: 5,
    }));

    const svc = app.inject(TestService);
    await app.start();

    await svc.queue.push({ id: "msg1", count: 42 });

    await expect
      .poll(() => messages.length === 1, { timeout: 1000 })
      .toBeTruthy();

    expect(messages).toEqual([{ id: "msg1", count: 42 }]);

    await app.stop();
  });
});
