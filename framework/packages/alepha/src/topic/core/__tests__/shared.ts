import { randomUUID } from "node:crypto";

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

/**
 * A topic name no other run uses.
 *
 * The Redis specs share one server, and every checkout runs under the
 * default `APP_NAME`: with a fixed name, two runs at once (two worktrees, or
 * CI lanes on one host) deliver their messages to each other's subscribers,
 * and the exact-array assertions below fail on a message nobody here
 * published.
 */
export const uniqueTopicName = (label: string): string =>
  `${label}-${randomUUID()}`;

export const testTopicParams = async (
  provider: Service<TopicProvider>,
  configure?: (app: Alepha) => void,
) => {
  const root = uniqueTopicName("devices");

  class TestParams {
    sensor = $topic({
      name: `${root}/{deviceId}/sensor`,
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
  const name = uniqueTopicName("test");

  class TestTopic {
    t = $topic({
      name,
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

  // Both polls are awaited, by the `Promise.all` that wraps them, which the
  // rule does not follow.
  await Promise.all([
    // oxlint-disable-next-line vitest/require-awaited-expect-poll
    expect.poll(() => expect(test3.stack).toEqual(["12", "23"])).toBeTruthy(),
    // oxlint-disable-next-line vitest/require-awaited-expect-poll
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
  const name = uniqueTopicName("a");

  class A {
    t = $topic({
      name,
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

  await expect.poll(() => count).toBe(123);

  // A payload the schema refuses is refused on publish, and never sent.
  await expect(a.t.publish({ n: 123.6 })).rejects.toThrow();
  expect(count).toBe(123);

  await app.stop();
};

export const testTopicRetain = async (
  provider: Service<TopicProvider>,
  configure?: (app: Alepha) => void,
) => {
  class TestRetain {
    t = $topic({
      name: uniqueTopicName("retain-test"),
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

  // Subscribe AFTER publish: should receive the retained message
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

  const inc = uniqueTopicName("inc");
  const inc10 = uniqueTopicName("inc10");

  let count = 0;
  const unsub = await provider.subscribe(inc, () => {
    count += 1;
  });
  await provider.subscribe(inc10, () => {
    count += 10;
  });

  expect(count).toBe(0);
  await provider.publish(inc, "");
  await provider.publish(inc10, "");
  await expect.poll(() => count).toBe(11);

  await unsub();

  await provider.publish(inc, "");
  await provider.publish(inc10, "");
  await expect.poll(() => count).toBe(21);

  await alepha.stop();
};

export const testTopicSameCallbackTwice = async (
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
  const name = uniqueTopicName("twice");

  let count = 0;
  const callback = () => {
    count += 1;
  };
  // Subscribed last, so it has seen every message the callback has.
  let published = 0;
  const publish = async () => {
    await provider.publish(name, "");
    published += 1;
    await expect.poll(() => sentinel).toBe(published);
  };
  let sentinel = 0;

  const first = await provider.subscribe(name, callback);
  const second = await provider.subscribe(name, callback);
  await provider.subscribe(name, () => {
    sentinel += 1;
  });

  await publish();
  expect(count).toBe(2);

  // One subscription goes, the other registration of the callback stays.
  await first();
  await publish();
  expect(count).toBe(3);

  await first();
  await publish();
  expect(count).toBe(4);

  await second();
  await publish();
  expect(count).toBe(4);

  await alepha.stop();
};
