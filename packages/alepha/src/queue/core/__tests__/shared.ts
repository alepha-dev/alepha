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
 * A queue name no other process can be listening on.
 *
 * ⚠️ Do NOT replace this with a readable literal. Every checkout on the
 * machine points at ONE Redis - `REDIS_URL: "redis://localhost:16379"` in the
 * repo-root `vitest.projects.ts` - so a literal name is shared state between
 * worktrees rather than a label. Two runs of the same spec register two
 * consumers on one list, and either may pop the other's message.
 *
 * ⚠️ This is a HAZARD found by reading, not the cause of anything measured.
 * It was written to fix `should push and pop with handler`, the most
 * frequent false red in `yarn v`, and it did not: two concurrent runs with
 * unique names still lost one. See the note in `testQueueHasConsumer` for
 * what the arithmetic actually says. Kept because a shared list across
 * checkouts is wrong on its own terms and costs nothing to close.
 *
 * The label stays in the name so a stray key in Redis still says which test
 * left it; the suffix is what makes it private.
 */
export const uniqueQueueName = (label: string): string =>
  `${label}-${crypto.randomUUID().slice(0, 8)}`;

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
  // Minted ONCE per call: the two producers and the consumer below must meet
  // on the same queue, and no other process may.
  const queue = uniqueQueueName("test");

  class TestConsumer {
    stack: string[] = [];
    protected readonly queueProvider = $inject(QueueProvider);
    protected readonly workerProvider = $inject(WorkerProvider);

    protected readonly registration = $hook({
      on: "start",
      handler: () => {
        this.workerProvider.register({
          name: queue,
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

  await test1.push(queue, payloadSchema, { id: "1", count: 2 });
  await test2.push(queue, payloadSchema, { id: "2", count: 3 });

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
  const queue = uniqueQueueName("q");

  class A {
    protected readonly queueProvider = $inject(QueueProvider);
    protected readonly workerProvider = $inject(WorkerProvider);

    protected readonly registration = $hook({
      on: "start",
      handler: () => {
        this.workerProvider.register({
          name: queue,
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

  /**
   * A 10ms poll, because the defaults make this assertion a coin flip.
   *
   * `queueWorkerOptions.interval` defaults to **1000ms** (backing off toward
   * `maxInterval`, 32s) and `expect.poll` below has vitest's **1000ms**
   * default deadline. The consumer's next poll and the assertion's deadline
   * were therefore the same number. `push` does call `wakeUp()`, which
   * should pre-empt the sleep, but a wake-up landing between "poll came back
   * empty" and "sleep scheduled" is simply lost, and that window widens
   * under contention.
   *
   * `testQueueBasic` above sets this same 10ms and has never flaked; this
   * one did not set it and is the suite's most frequent false red. That
   * asymmetry, plus 1000 against 1000, is the whole argument.
   *
   * ⚠️ It is an argument from the code, NOT a reproduction. The failure was
   * seen five times in one session and once here under two concurrent runs,
   * but ten further attempts - six concurrent runs against twelve CPU hogs
   * at load 44 - were all green WITHOUT this line. So treat this as a
   * removed hazard rather than a proven cure: if the red returns, the poll
   * interval is no longer a candidate and the wake-up path is where to look.
   */
  app.store.mut(queueWorkerOptions, (current) => ({
    ...current,
    interval: 10,
  }));

  // Inject before start — the container locks once started.
  const producer = app.inject(TestProducer);

  await app.start();
  expect(count).toBe(0);

  await producer.push(queue, schema, { n: 123 });
  await expect.poll(() => expect(count).toBe(123)).toBeTruthy();
};

export const testQueueKillWorkerSleep = async (
  provider: Service<QueueProvider>,
) => {
  let count = 0;
  // ⚠️ This one is a THIEF, not a victim. It pushes nothing and asserts only
  // that `stopWorkers` ran, so a shared name costs it nothing - but while it
  // is alive it holds a consumer on that queue, and it used to hold one on
  // the very name `testQueueHasConsumer` pushes to. So it stole messages it
  // never read. Unique here for the other test's sake.
  const queue = uniqueQueueName("q");

  class A {
    protected readonly queueProvider = $inject(QueueProvider);
    protected readonly workerProvider = $inject(WorkerProvider);

    protected readonly registration = $hook({
      on: "start",
      handler: () => {
        this.workerProvider.register({
          name: queue,
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
