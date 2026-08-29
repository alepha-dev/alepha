import { $hook, $inject, Alepha, type Service, z } from "alepha";
import {
  MemoryQueueProvider,
  type MemoryQueueEntry,
  QueueCodec,
  QueueProvider,
  queueWorkerOptions,
  WorkerProvider,
} from "alepha/queue";
import { expect } from "vitest";

export const payloadSchema = z.object({
  id: z.text(),
  count: z.integer(),
});

export const queueList: Record<string, MemoryQueueEntry[]> = {};
export class SharedQueueProvider extends MemoryQueueProvider {
  queueList = queueList;
}

/**
 * Pushes to a queue by name. Stands in for what `$job` does internally now
 * that there is no queue primitive.
 */
export class TestProducer {
  protected readonly queueProvider = $inject(QueueProvider);
  protected readonly workerProvider = $inject(WorkerProvider);
  protected readonly codec = $inject(QueueCodec);

  public async push(
    queue: string,
    schema: any,
    ...payloads: Array<any>
  ): Promise<void> {
    await this.queueProvider.pushMany(
      queue,
      payloads.map((payload) => this.codec.encode(schema, payload)),
    );
    this.workerProvider.wakeUp();
  }
}

export const testQueueBasic = async (provider: Service<QueueProvider>) => {
  class TestConsumer {
    stack: string[] = [];
    protected readonly queueProvider = $inject(QueueProvider);
    protected readonly workerProvider = $inject(WorkerProvider);

    protected readonly registration = $hook({
      on: "start",
      handler: () => {
        this.workerProvider.register({
          name: "test",
          schema: payloadSchema,
          provider: this.queueProvider,
          handler: async (m) => {
            this.stack.push(m.payload.id + m.payload.count);
          },
        });
      },
    });
  }

  const createApp = async <T extends object>(
    testClass: Service<T>,
  ): Promise<{ app: Alepha; test: T }> => {
    const app = Alepha.create();
    app.store.mut(queueWorkerOptions, (current) => ({
      ...current,
      interval: 10,
    }));

    app.with({
      provide: QueueProvider,
      use: provider,
    });

    const test = app.inject(testClass);

    await app.start();

    return { app, test };
  };

  const { app: app1, test: test1 } = await createApp(TestProducer);
  const { app: app2, test: test2 } = await createApp(TestProducer);
  const { app: app3, test: test3 } = await createApp(TestConsumer);

  await test1.push("test", payloadSchema, { id: "1", count: 2 });
  await test2.push("test", payloadSchema, { id: "2", count: 3 });

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
  const schema = z.object({ n: z.integer() });

  class A {
    protected readonly queueProvider = $inject(QueueProvider);
    protected readonly workerProvider = $inject(WorkerProvider);

    protected readonly registration = $hook({
      on: "start",
      handler: () => {
        this.workerProvider.register({
          name: "q",
          schema,
          provider: this.queueProvider,
          handler: async ({ payload }) => {
            count += payload.n;
          },
        });
      },
    });
  }

  const app = Alepha.create()
    .with({
      provide: QueueProvider,
      use: provider,
    })
    .with(A);

  // Inject before start — the container locks once started.
  const producer = app.inject(TestProducer);

  await app.start();
  expect(count).toBe(0);

  await producer.push("q", schema, { n: 123 });
  await expect.poll(() => expect(count).toBe(123)).toBeTruthy();
};

export const testQueueKillWorkerSleep = async (
  provider: Service<QueueProvider>,
) => {
  let count = 0;

  class A {
    protected readonly queueProvider = $inject(QueueProvider);
    protected readonly workerProvider = $inject(WorkerProvider);

    protected readonly registration = $hook({
      on: "start",
      handler: () => {
        this.workerProvider.register({
          name: "q",
          schema: z.object({}),
          provider: this.queueProvider,
          handler: async () => {},
        });
      },
    });
  }

  const app = Alepha.create()
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

  app.store.mut(queueWorkerOptions, (current) => ({
    ...current,
    interval: 10000,
  }));

  expect(count).toBe(0);
  await app.start();
  expect(count).toBe(0);

  await app.stop();
  expect(count).toBe(123);
};
