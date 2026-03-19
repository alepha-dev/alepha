import { randomUUID } from "node:crypto";
import { MqttClientProvider, MqttJsClientProvider } from "@alepha/mqtt";
import { Alepha, t } from "alepha";
import { $topic, AlephaTopic, TopicProvider } from "alepha/topic";
import { describe, expect, it } from "vitest";
import { MqttTopicProvider } from "../index.ts";

// ---------------------------------------------------------------------------------------------------------------------

const configure = (app: Alepha) => {
  app.with({ provide: MqttClientProvider, use: MqttJsClientProvider });
};

// ---------------------------------------------------------------------------------------------------------------------

describe("$topic - mqtt", () => {
  it("should subscribe and publish", async ({ expect }) => {
    // Use a unique topic name to avoid cross-test interference.
    const uid = randomUUID();

    class TestTopic {
      t = $topic({
        name: `basic-${uid}`,
        schema: { payload: t.object({ value: t.text() }) },
      });
    }

    const alepha = Alepha.create();

    configure(alepha);

    alepha
      .with({ provide: TopicProvider, use: MqttTopicProvider })
      .with(TestTopic);

    await alepha.start();

    const test = alepha.inject(TestTopic);
    const received: string[] = [];

    await test.t.subscribe(async (m) => {
      received.push(m.payload.value);
    });

    await test.t.publish({ value: "hello" });
    await test.t.publish({ value: "world" });

    await expect
      .poll(() => received, { timeout: 5000 })
      .toEqual(["hello", "world"]);

    await alepha.stop();
  });

  it("should subscribe with handler", async () => {
    let count = 0;
    class A {
      t = $topic({
        name: "a",
        schema: {
          payload: t.object({ n: t.integer() }),
        },
        handler: async ({ payload }) => {
          count += payload.n;
        },
      });
    }

    const app = Alepha.create({});

    configure(app);

    app
      .with({
        provide: TopicProvider,
        use: MqttTopicProvider,
      })
      .with(A);

    await app.start();

    const a = app.inject(A);

    await a.t.publish({ n: 123 });

    await expect.poll(() => expect(count).toBe(123)).toBeTruthy();
  });

  it("should subscribe after start with provider", async () => {
    const alepha = Alepha.create();

    configure(alepha);

    alepha
      .with({
        provide: TopicProvider,
        use: MqttTopicProvider,
      })
      .with(AlephaTopic);

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
    await expect.poll(() => expect(count).toBe(11)).toBeTruthy();

    await unsub();

    await provider.publish("inc", "");
    await provider.publish("inc10", "");
    await expect.poll(() => expect(count).toBe(21)).toBeTruthy();
  });

  it("should deliver retained message to new subscriber", {
    retry: 3,
  }, async () => {
    // Uses two separate apps to avoid same-client retained message delivery races.
    const topicName = `retain-test-${randomUUID()}`;

    class Publisher {
      t = $topic({
        name: topicName,
        schema: { payload: t.object({ value: t.text() }) },
        retain: true,
        mqtt: { qos: 1 },
      });
    }

    class Subscriber {
      t = $topic({
        name: topicName,
        schema: { payload: t.object({ value: t.text() }) },
        retain: true,
        mqtt: { qos: 1 },
      });
    }

    const pubApp = Alepha.create();
    const subApp = Alepha.create();

    configure(pubApp);
    configure(subApp);

    pubApp
      .with({ provide: TopicProvider, use: MqttTopicProvider })
      .with(Publisher);
    subApp
      .with({ provide: TopicProvider, use: MqttTopicProvider })
      .with(Subscriber);

    await pubApp.start();
    const pub = pubApp.inject(Publisher);

    await pub.t.publish({ value: "retained" });

    await subApp.start();
    const sub = subApp.inject(Subscriber);

    const received: string[] = [];
    await sub.t.subscribe(async (m) => {
      received.push(m.payload.value);
    });

    await expect.poll(() => received, { timeout: 5000 }).toEqual(["retained"]);

    await pubApp.stop();
    await subApp.stop();
  });

  it("should support parameterized topic names", async () => {
    class TestParams {
      sensor = $topic({
        name: "devices/{deviceId}/sensor",
        schema: {
          params: t.object({ deviceId: t.text() }),
          payload: t.object({ temp: t.number() }),
        },
      });
    }

    const app = Alepha.create();

    configure(app);

    app
      .with({ provide: TopicProvider, use: MqttTopicProvider })
      .with(TestParams);

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
      .poll(() => received)
      .toEqual([
        { deviceId: "dev-1", temp: 22.5 },
        { deviceId: "dev-2", temp: 18.0 },
      ]);

    await app.stop();
  });

  it("should support QoS via mqtt options", async ({ expect }) => {
    class QosTopic {
      sensor = $topic({
        name: "qos-test",
        schema: { payload: t.object({ value: t.number() }) },
        mqtt: { qos: 1 },
      });
    }

    const alepha = Alepha.create();

    configure(alepha);

    alepha
      .with({ provide: TopicProvider, use: MqttTopicProvider })
      .with(QosTopic);

    await alepha.start();

    const topic = alepha.inject(QosTopic);
    const received: number[] = [];

    await topic.sensor.subscribe(async (m) => {
      received.push(m.payload.value);
    });

    await topic.sensor.publish({ value: 42 });

    await expect.poll(() => received, { timeout: 5000 }).toEqual([42]);

    await alepha.stop();
  });
});
