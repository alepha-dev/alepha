import { randomUUID } from "node:crypto";
import { Alepha, t } from "alepha";
import { MqttClientProvider, MqttJsClientProvider } from "alepha/mqtt";
import { $topic, TopicProvider } from "alepha/topic";
import { describe, it } from "vitest";
import {
  testTopicAsSub,
  testTopicLateSubscribe,
  testTopicParams,
  testTopicRetain,
} from "../../core/__tests__/shared.ts";
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
    await testTopicAsSub(MqttTopicProvider, configure);
  });

  it("should subscribe after start with provider", async () => {
    await testTopicLateSubscribe(MqttTopicProvider, configure);
  });

  it("should deliver retained message to new subscriber", async () => {
    await testTopicRetain(MqttTopicProvider, configure);
  });

  it("should support parameterized topic names", async () => {
    await testTopicParams(MqttTopicProvider, configure);
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
