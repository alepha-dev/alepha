import { randomUUID } from "node:crypto";
import { MqttClientProvider, MqttJsClientProvider } from "@alepha/mqtt";
import { $inject, Alepha, z } from "alepha";
import { $subscriber, $topic, AlephaTopic, TopicProvider } from "alepha/topic";
import { describe, it } from "vitest";
import { MqttTopicProvider, mqttTopicOptions } from "../index.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Builds a `configure` that pins every app it touches to one private MQTT
 * topic namespace.
 *
 * The broker is shared and its retained messages outlive the process, so two
 * tests — or two runs of the same test — sharing a topic name is the single
 * biggest source of flakiness here. A per-test prefix removes the shared
 * namespace entirely rather than trying to time around it.
 */
const isolated = () => {
  const prefix = `test/topic/${randomUUID()}`;

  return (app: Alepha) => {
    app
      .with({ provide: MqttClientProvider, use: MqttJsClientProvider })
      .with({ provide: TopicProvider, use: MqttTopicProvider })
      .set(mqttTopicOptions, { prefix });
  };
};

// ---------------------------------------------------------------------------------------------------------------------

describe("$topic - mqtt", () => {
  it("should subscribe and publish", async ({ expect }) => {
    const configure = isolated();

    class TestTopic {
      t = $topic({
        name: "basic",
        schema: { payload: z.object({ value: z.text() }) },
      });
    }

    const alepha = Alepha.create();
    configure(alepha);
    alepha.with(TestTopic);

    await alepha.start();

    const test = alepha.inject(TestTopic);
    const received: string[] = [];

    await test.t.subscribe(async (m) => {
      received.push(m.payload.value);
    });

    // Awaited publishes at QoS 1 resolve on PUBACK, so the broker has taken
    // "hello" before "world" is written — the expected order is a guarantee,
    // not a coincidence.
    await test.t.publish({ value: "hello" });
    await test.t.publish({ value: "world" });

    await expect
      .poll(() => received, { timeout: 5000 })
      .toEqual(["hello", "world"]);
  });

  it("should deliver across separate apps on the same topic", async ({
    expect,
  }) => {
    // One namespace, two containers — the point of a broker-backed provider.
    const configure = isolated();

    class TestTopic {
      t = $topic({
        name: "shared",
        schema: { payload: z.object({ id: z.text(), count: z.integer() }) },
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

    const createApp = async <T extends object>(service: new () => T) => {
      const app = Alepha.create();
      configure(app);
      const test = app.inject(service);
      await app.start();
      return { app, test };
    };

    const { test: publisher1 } = await createApp(TestTopic);
    const { test: publisher2 } = await createApp(TestTopic);
    const { test: subscriber1 } = await createApp(TestSubscriber);
    const { test: subscriber2 } = await createApp(TestSubscriber);

    await publisher1.t.publish({ id: "1", count: 2 });
    await publisher2.t.publish({ id: "2", count: 3 });

    await expect
      .poll(() => subscriber1.stack, { timeout: 5000 })
      .toEqual(["12", "23"]);
    await expect
      .poll(() => subscriber2.stack, { timeout: 5000 })
      .toEqual(["12", "23"]);
  });

  it("should subscribe with handler", async ({ expect }) => {
    const configure = isolated();
    let count = 0;

    class A {
      t = $topic({
        name: "with-handler",
        schema: { payload: z.object({ n: z.integer() }) },
        handler: async ({ payload }) => {
          count += payload.n;
        },
      });
    }

    const app = Alepha.create();
    configure(app);
    app.with(A);

    await app.start();

    await app.inject(A).t.publish({ n: 123 });

    await expect.poll(() => count, { timeout: 5000 }).toBe(123);
  });

  it("should subscribe after start with provider", async ({ expect }) => {
    const configure = isolated();

    const alepha = Alepha.create();
    configure(alepha);
    alepha.with(AlephaTopic);

    await alepha.start();

    const provider = alepha.inject(TopicProvider);

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
    await expect.poll(() => count, { timeout: 5000 }).toBe(11);

    await unsub();

    // "inc" is unsubscribed and must not land; "inc10" is the sentinel that
    // proves the broker got past it. Ordered QoS 1 delivery makes this an
    // assertion rather than a sleep.
    await provider.publish("inc", "");
    await provider.publish("inc10", "");
    await expect.poll(() => count, { timeout: 5000 }).toBe(21);
    expect(count).toBe(21);
  });

  it("should deliver a retained message to a new subscriber", async ({
    expect,
  }) => {
    const configure = isolated();

    class Retained {
      t = $topic({
        name: "retain",
        schema: { payload: z.object({ value: z.text() }) },
        retain: true,
      });
    }

    // Publisher and subscriber are separate apps: a retained message is only
    // meaningful to a client that was not connected when it was sent.
    const pubApp = Alepha.create();
    const subApp = Alepha.create();
    configure(pubApp);
    configure(subApp);
    pubApp.with(Retained);
    subApp.with(Retained);

    await pubApp.start();
    await pubApp.inject(Retained).t.publish({ value: "retained" });

    await subApp.start();

    const received: string[] = [];
    await subApp.inject(Retained).t.subscribe(async (m) => {
      received.push(m.payload.value);
    });

    await expect.poll(() => received, { timeout: 5000 }).toEqual(["retained"]);
  });

  it("should support parameterized topic names", async ({ expect }) => {
    const configure = isolated();

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
    configure(app);
    app.with(TestParams);

    await app.start();
    const test = app.inject(TestParams);

    const received: Array<{ deviceId: string; temp: number }> = [];
    await test.sensor.subscribe(async (m) => {
      received.push({ deviceId: m.params.deviceId, temp: m.payload.temp });
    });

    await test.sensor.publish({
      params: { deviceId: "dev-1" },
      payload: { temp: 22.5 },
    });
    await test.sensor.publish({
      params: { deviceId: "dev-2" },
      payload: { temp: 18.0 },
    });

    await expect
      .poll(() => received, { timeout: 5000 })
      .toEqual([
        { deviceId: "dev-1", temp: 22.5 },
        { deviceId: "dev-2", temp: 18.0 },
      ]);
  });

  it("should honour an explicit QoS from the topic options", async ({
    expect,
  }) => {
    const configure = isolated();

    class QosTopic {
      sensor = $topic({
        name: "qos",
        schema: { payload: z.object({ value: z.number() }) },
        mqtt: { qos: 2 },
      });
    }

    const alepha = Alepha.create();
    configure(alepha);
    alepha.with(QosTopic);

    await alepha.start();

    const topic = alepha.inject(QosTopic);
    const received: number[] = [];

    await topic.sensor.subscribe(async (m) => {
      received.push(m.payload.value);
    });

    await topic.sensor.publish({ value: 42 });

    await expect.poll(() => received, { timeout: 5000 }).toEqual([42]);
  });
});
