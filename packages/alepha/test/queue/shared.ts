import { $inject, Alepha, type Service, t } from "alepha";
import {
  $consumer,
  $queue,
  MemoryQueueProvider,
  QueueProvider,
  WorkerProvider,
} from "alepha/queue";
import { expect } from "vitest";

export const payloadSchema = t.object({
  id: t.text(),
  count: t.integer(),
});

// Shared storage for cross-app testing
export const sharedMessageQueues: Record<string, string[]> = {};
export const sharedJobs: Map<string, Map<string, any>> = new Map();
export const sharedWaiting: Map<string, string[]> = new Map();
export const sharedDelayed: Map<string, string[]> = new Map();
export const sharedActive: Map<string, Set<string>> = new Map();
export const sharedCompleted: Map<string, string[]> = new Map();
export const sharedFailed: Map<string, string[]> = new Map();
export const sharedJobWaiters: Set<any> = new Set();
export const sharedMessageWaiters: Set<any> = new Set();

/**
 * Shared queue provider for testing cross-app communication.
 * All instances share the same storage.
 */
export class SharedQueueProvider extends MemoryQueueProvider {
  protected messageQueues = sharedMessageQueues;
  protected jobs = sharedJobs;
  protected waiting = sharedWaiting;
  protected delayed = sharedDelayed;
  protected active = sharedActive;
  protected completed = sharedCompleted;
  protected failed = sharedFailed;
  protected jobWaiters = sharedJobWaiters;
  protected messageWaiters = sharedMessageWaiters;
}

export const testQueueBasic = async (provider: Service<QueueProvider>) => {
  class TestQueue {
    q = $queue({
      name: "test",
      schema: payloadSchema,
    });
  }

  class TestConsumer {
    stack: string[] = [];
    test = $inject(TestQueue);
    s = $consumer({
      queue: this.test.q,
      handler: async (m) => {
        this.stack.push(m.payload.id + m.payload.count);
      },
    });
  }

  const createApp = async <T extends object>(
    testClass: Service<T>,
  ): Promise<{ app: Alepha; test: T }> => {
    const app = Alepha.create({
      env: {
        QUEUE_WORKER_BLOCKING_TIMEOUT: 1,
        QUEUE_SCHEDULER_INTERVAL: 100,
        QUEUE_STALLED_THRESHOLD: 100,
      },
    });

    app.with({
      provide: QueueProvider,
      use: provider,
    });

    const test = app.inject(testClass);

    await app.start();

    return { app, test };
  };

  const { app: app1, test: test1 } = await createApp(TestQueue);
  const { app: app2, test: test2 } = await createApp(TestQueue);
  const { app: app3, test: test3 } = await createApp(TestConsumer);

  await test1.q.push({ id: "1", count: 2 });
  await test2.q.push({ id: "2", count: 3 });

  await expect
    .poll(() => expect(test3.stack).toEqual(["12", "23"]))
    .toBeTruthy();

  await app1.stop();
  await app2.stop();
  await app3.stop();
};

export const testQueueHasConsumer = async (
  provider: Service<QueueProvider>,
) => {
  let count = 0;
  class A {
    q = $queue({
      schema: t.object({ n: t.integer() }),
      handler: async ({ payload }) => {
        count += payload.n;
      },
    });
  }
  const app = Alepha.create({
    env: {
      QUEUE_WORKER_BLOCKING_TIMEOUT: 1,
      QUEUE_SCHEDULER_INTERVAL: 100,
      QUEUE_STALLED_THRESHOLD: 100,
    },
  })
    .with({
      provide: QueueProvider,
      use: provider,
    })
    .with(A);

  await app.start();
  expect(count).toBe(0);

  await app.inject(A).q.push({ n: 123 });
  await expect.poll(() => expect(count).toBe(123)).toBeTruthy();

  await app.stop();
};

export const testQueueKillWorkerSleep = async (
  provider: Service<QueueProvider>,
) => {
  let count = 0;
  class A {
    q = $queue({
      schema: t.object({}),
    });
    c = $consumer({
      queue: this.q,
      handler: async () => {},
    });
  }

  const app = Alepha.create({
    env: {
      QUEUE_WORKER_BLOCKING_TIMEOUT: 1,
      QUEUE_SCHEDULER_INTERVAL: 100,
      QUEUE_STALLED_THRESHOLD: 100,
    },
  })
    .with({
      provide: QueueProvider,
      use: provider,
    })
    .with({
      provide: WorkerProvider,
      use: class FakeQueuePrimitiveProvider extends WorkerProvider {
        async stopWorkers() {
          await super.stopWorkers();
          count += 123;
        }
      },
    })
    .with(A);

  expect(count).toBe(0);
  await app.start();
  expect(count).toBe(0);

  await app.stop();
  expect(count).toBe(123);
};
