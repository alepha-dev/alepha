import { $inject, Alepha, type Service, z } from "alepha";
import {
  $subscriber,
  $topic,
  AlephaTopic,
  MemoryTopicProvider,
  type SubscribeCallback,
  TopicProvider,
} from "alepha/topic";
import { expect } from "vitest";

export const testTopicParams = async (
  provider: Service<TopicProvider>,
  configure?: (app: Alepha) => void,
) => {
  class TestParams {
    sensor = $topic({
      name: "devices/{deviceId}/sensor",
      schema: {
        params: z.object({ deviceId: z.text() }),
        payload: z.object({ temp: z.number() }),
      },
    });
  }

  const app = Alepha.create();

  configure?.(app);

  app.with({ provide: TopicProvider, use: provider }).with(TestParams);

  await app.start();
  const test = app.inject(TestParams);

  // Subscribe to all devices
  const received: Array<{ deviceId: string; temp: number }> = [];
  await test.sensor.subscribe(async (m) => {
    received.push({ deviceId: m.params.deviceId, temp: m.payload.temp });
  });

  // Publish to specific devices
  await test.sensor.publish({
    params: { deviceId: "dev-1" },
    payload: { temp: 22.5 },
  });
  await test.sensor.publish({
    params: { deviceId: "dev-2" },
    payload: { temp: 18.0 },
  });

  await expect
    .poll(() => received)
    .toEqual([
      { deviceId: "dev-1", temp: 22.5 },
      { deviceId: "dev-2", temp: 18.0 },
    ]);

  await app.stop();
};

export const payloadSchema = z.object({
  id: z.text(),
  count: z.integer(),
});

export const subscriptions: Record<string, SubscribeCallback[]> = {};
export class SharedTopicProvider extends MemoryTopicProvider {
  subscriptions = subscriptions;
}

export const testTopicBasic = async (
  provider: Service<TopicProvider>,
  configure?: (app: Alepha) => void,
) => {
  class TestTopic {
    t = $topic({
      name: "test",
      schema: {
        payload: payloadSchema,
      },
    });
  }

  class TestSubscriber {
    stack: string[] = [];
    test = $inject(TestTopic);
    s = $subscriber({
      topic: this.test.t,
      handler: async (m) => {
        this.stack.push(m.payload.id + m.payload.count);
      },
    });
  }

  const createApp = async <T extends object>(
    testClass: Service<T>,
  ): Promise<{ app: Alepha; test: T }> => {
    const app = Alepha.create();

    configure?.(app);

    app.with({
      provide: TopicProvider,
      use: provider,
    });

    const test = app.inject(testClass);

    await app.start();

    return { app, test };
  };

  const { app: app1, test: test1 } = await createApp(TestTopic);
  const { app: app2, test: test2 } = await createApp(TestTopic);
  const { app: app3, test: test3 } = await createApp(TestSubscriber);
  const { app: app4, test: test4 } = await createApp(TestSubscriber);

  await test1.t.publish({ id: "1", count: 2 });
  await test2.t.publish({ id: "2", count: 3 });

  await Promise.all([
    expect.poll(() => expect(test3.stack).toEqual(["12", "23"])).toBeTruthy(),
    expect.poll(() => expect(test4.stack).toEqual(["12", "23"])).toBeTruthy(),
  ]);

  await app1.stop();
  await app2.stop();
  await app3.stop();
  await app4.stop();
};

export const testTopicAsSub = async (
  provider: Service<TopicProvider>,
  configure?: (app: Alepha) => void,
) => {
  let count = 0;
  class A {
    t = $topic({
      name: "a",
      schema: {
        payload: z.object({ n: z.integer() }),
      },
      handler: async ({ payload }) => {
        count += payload.n;
      },
    });
  }

  const app = Alepha.create({});

  configure?.(app);

  app
    .with({
      provide: TopicProvider,
      use: provider,
    })
    .with(A);

  await app.start();

  const a = app.inject(A);

  await a.t.publish({ n: 123 });

  await expect.poll(() => expect(count).toBe(123)).toBeTruthy();
  //await expect(a.t.publish({ n: 123.6 })).rejects.toThrowError(SchemaValidationError);
};

export const testTopicRetain = async (
  provider: Service<TopicProvider>,
  configure?: (app: Alepha) => void,
) => {
  class TestRetain {
    t = $topic({
      name: `retain-test-${crypto.randomUUID()}`,
      schema: {
        payload: z.object({ value: z.text() }),
      },
      retain: true,
    });
  }

  const app = Alepha.create();

  configure?.(app);

  app.with({ provide: TopicProvider, use: provider }).with(TestRetain);

  await app.start();
  const test = app.inject(TestRetain);

  // Publish a retained message
  await test.t.publish({ value: "retained" });

  // Subscribe AFTER publish — should receive the retained message
  const received: string[] = [];
  await test.t.subscribe(async (m) => {
    received.push(m.payload.value);
  });

  await expect.poll(() => received, { timeout: 5000 }).toEqual(["retained"]);

  await app.stop();
};

export const testTopicLateSubscribe = async (
  Provider: Service<TopicProvider>,
  configure?: (app: Alepha) => void,
) => {
  const alepha = Alepha.create();

  configure?.(alepha);

  alepha
    .with({
      provide: TopicProvider,
      use: Provider,
    })
    .with(AlephaTopic);

  await alepha.start();

  const provider = alepha.inject(TopicProvider);

  // no topic created yet !

  let count = 0;
  const unsub = await provider.subscribe("inc", () => {
    count += 1;
  });
  await provider.subscribe("inc10", () => {
    count += 10;
  });

  expect(count).toBe(0);
  await provider.publish("inc", "");
  await provider.publish("inc10", "");
  await expect.poll(() => expect(count).toBe(11)).toBeTruthy();

  await unsub();

  await provider.publish("inc", "");
  await provider.publish("inc10", "");
  await expect.poll(() => expect(count).toBe(21)).toBeTruthy();
};
