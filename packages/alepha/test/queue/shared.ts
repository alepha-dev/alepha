import { $inject, Alepha, type Service, t } from "alepha";
import { expect } from "vitest";
import {
  $consumer,
  $queue,
  MemoryQueueProvider,
  QueueProvider,
} from "../../src/queue";
import { WorkerProvider } from "../../src/queue/providers/WorkerProvider.ts";

export const payloadSchema = t.object({
  id: t.text(),
  count: t.integer(),
});

export const queueList: Record<string, string[]> = {};
export class SharedQueueProvider extends MemoryQueueProvider {
  queueList = queueList;
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
        QUEUE_WORKER_INTERVAL: 10,
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
  const app = Alepha.create()
    .with({
      provide: QueueProvider,
      use: provider,
    })
    .with(A);

  await app.start();
  expect(count).toBe(0);

  await app.inject(A).q.push({ n: 123 });
  await expect.poll(() => expect(count).toBe(123)).toBeTruthy();
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
      QUEUE_WORKER_INTERVAL: 10000,
    },
  })
    .with({
      provide: QueueProvider,
      use: provider,
    })
    .with({
      provide: WorkerProvider,
      use: class FakeQueueDescriptorProvider extends WorkerProvider {
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
