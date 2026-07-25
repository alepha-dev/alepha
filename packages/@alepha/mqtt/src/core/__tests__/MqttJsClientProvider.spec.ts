import { randomUUID } from "node:crypto";
import { Alepha } from "alepha";
import { describe, it } from "vitest";
import { MqttClientProvider } from "../providers/MqttClientProvider.ts";
import {
  MqttJsClientProvider,
  mqttOptions,
} from "../providers/MqttJsClientProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Counts connections and exposes the protected topic matcher.
 */
class TestMqttJsClientProvider extends MqttJsClientProvider {
  public connectCount = 0;
  public testTopicMatches = this.topicMatches.bind(this);

  protected override async openConnection(): Promise<void> {
    this.connectCount++;
    await super.openConnection();
  }
}

/**
 * Creates an Alepha instance wired with the MQTT client.
 */
const createApp = (options?: { lazy?: boolean }) => {
  const alepha = Alepha.create().with({
    provide: MqttClientProvider,
    use: TestMqttJsClientProvider,
  });

  if (options?.lazy) {
    alepha.set(mqttOptions, { keepalive: 60, lazy: true });
  }

  return alepha;
};

/**
 * A topic namespace no other test, file or run can collide with.
 *
 * The broker is shared and long-lived: retained messages published by an
 * earlier run outlive it, so a fixed topic name is a slow-burning flake.
 */
const namespace = () => `test/mqtt-client/${randomUUID()}`;

// ---------------------------------------------------------------------------------------------------------------------

describe("MqttJsClientProvider", () => {
  it("should connect on start and disconnect on stop", async ({ expect }) => {
    const alepha = createApp();
    const mqtt = alepha.inject(TestMqttJsClientProvider);

    expect(mqtt.isConnected).toBe(false);

    await alepha.start();
    expect(mqtt.isConnected).toBe(true);

    await alepha.stop();
    expect(mqtt.isConnected).toBe(false);
  });

  it("should publish and receive a message", async ({ expect }) => {
    const topic = `${namespace()}/basic`;
    const received: string[] = [];

    const alepha = createApp();
    const mqtt = alepha.inject(TestMqttJsClientProvider);
    await alepha.start();

    await mqtt.subscribe(topic, (_t, payload) => {
      received.push(payload);
    });

    await mqtt.publish(topic, "hello", { qos: 1 });

    await expect.poll(() => received, { timeout: 5000 }).toEqual(["hello"]);
  });

  it("should deliver to every callback on the same filter", async ({
    expect,
  }) => {
    const topic = `${namespace()}/multi`;
    const first: string[] = [];
    const second: string[] = [];

    const alepha = createApp();
    const mqtt = alepha.inject(TestMqttJsClientProvider);
    await alepha.start();

    // The second subscribe joins an existing filter. It must still wait for
    // the broker's SUBACK, or the publish below races it.
    await mqtt.subscribe(topic, (_t, payload) => {
      first.push(payload);
    });
    await mqtt.subscribe(topic, (_t, payload) => {
      second.push(payload);
    });

    await mqtt.publish(topic, "shared", { qos: 1 });

    await expect.poll(() => first, { timeout: 5000 }).toEqual(["shared"]);
    await expect.poll(() => second, { timeout: 5000 }).toEqual(["shared"]);
  });

  it("should support the + single-level wildcard", async ({ expect }) => {
    const ns = namespace();
    const received: Array<{ topic: string; payload: string }> = [];

    const alepha = createApp();
    const mqtt = alepha.inject(TestMqttJsClientProvider);
    await alepha.start();

    await mqtt.subscribe(`${ns}/+/data`, (t, payload) => {
      received.push({ topic: t, payload });
    });

    // Sequential QoS 1 publishes: each resolves on PUBACK, so the broker has
    // fully taken msg1 before msg2 is written. Order is deterministic.
    await mqtt.publish(`${ns}/device1/data`, "msg1", { qos: 1 });
    await mqtt.publish(`${ns}/device2/data`, "msg2", { qos: 1 });

    await expect
      .poll(() => received, { timeout: 5000 })
      .toEqual([
        { topic: `${ns}/device1/data`, payload: "msg1" },
        { topic: `${ns}/device2/data`, payload: "msg2" },
      ]);
  });

  it("should support the # multi-level wildcard", async ({ expect }) => {
    const ns = namespace();
    const received: string[] = [];

    const alepha = createApp();
    const mqtt = alepha.inject(TestMqttJsClientProvider);
    await alepha.start();

    await mqtt.subscribe(`${ns}/#`, (_t, payload) => {
      received.push(payload);
    });

    await mqtt.publish(`${ns}/a`, "one", { qos: 1 });
    await mqtt.publish(`${ns}/a/b/c`, "two", { qos: 1 });

    await expect
      .poll(() => received, { timeout: 5000 })
      .toEqual(["one", "two"]);
  });

  it("should not auto-connect when lazy: true", async ({ expect }) => {
    const alepha = createApp({ lazy: true });
    const mqtt = alepha.inject(TestMqttJsClientProvider);

    await alepha.start();
    expect(mqtt.isConnected).toBe(false);
    expect(mqtt.connectCount).toBe(0);

    // publish should trigger the lazy connection
    await mqtt.publish(`${namespace()}/lazy`, "wake-up", { qos: 1 });
    expect(mqtt.isConnected).toBe(true);
    expect(mqtt.connectCount).toBe(1);
  });

  it("should open a single connection under concurrent lazy publishes", async ({
    expect,
  }) => {
    const ns = namespace();
    const alepha = createApp({ lazy: true });
    const mqtt = alepha.inject(TestMqttJsClientProvider);

    await alepha.start();

    // Every one of these finds `client === undefined` and would each open
    // their own socket without the in-flight guard, orphaning all but one.
    await Promise.all([
      mqtt.publish(`${ns}/a`, "1", { qos: 1 }),
      mqtt.publish(`${ns}/b`, "2", { qos: 1 }),
      mqtt.publish(`${ns}/c`, "3", { qos: 1 }),
      mqtt.subscribe(`${ns}/d`, () => undefined),
    ]);

    expect(mqtt.connectCount).toBe(1);
    expect(mqtt.isConnected).toBe(true);
  });

  it("should stop receiving messages after unsubscribe", async ({ expect }) => {
    const ns = namespace();
    const topic = `${ns}/unsub`;
    const sentinelTopic = `${ns}/sentinel`;
    const received: string[] = [];
    const sentinel: string[] = [];

    const alepha = createApp();
    const mqtt = alepha.inject(TestMqttJsClientProvider);
    await alepha.start();

    const unsubscribe = await mqtt.subscribe(topic, (_t, payload) => {
      received.push(payload);
    });
    await mqtt.subscribe(sentinelTopic, (_t, payload) => {
      sentinel.push(payload);
    });

    await mqtt.publish(topic, "before-unsub", { qos: 1 });
    await expect
      .poll(() => received, { timeout: 5000 })
      .toEqual(["before-unsub"]);

    await unsubscribe();

    // Publish the message that must NOT arrive, then a sentinel that must.
    // Both are QoS 1 on the same connection, so the broker handles them in
    // order — once the sentinel lands, a leaked delivery of the first would
    // already have happened. No sleep, and no window for a false pass.
    await mqtt.publish(topic, "after-unsub", { qos: 1 });
    await mqtt.publish(sentinelTopic, "ping", { qos: 1 });

    await expect.poll(() => sentinel, { timeout: 5000 }).toEqual(["ping"]);
    expect(received).toEqual(["before-unsub"]);
  });

  it("should deliver a retained message to a late subscriber", async ({
    expect,
  }) => {
    const topic = `${namespace()}/retain`;
    const received: string[] = [];

    // Two separate clients: one publishes, the other subscribes afterwards.
    const publisher = createApp();
    const subscriber = createApp();
    const pubMqtt = publisher.inject(TestMqttJsClientProvider);
    const subMqtt = subscriber.inject(TestMqttJsClientProvider);
    await publisher.start();

    // QoS 1: the PUBACK means the broker has stored the retained message, so
    // the subscribe below cannot arrive too early.
    await pubMqtt.publish(topic, "retained-value", { retain: true, qos: 1 });

    await subscriber.start();
    await subMqtt.subscribe(
      topic,
      (_t, payload) => {
        received.push(payload);
      },
      { qos: 1 },
    );

    await expect
      .poll(() => received, { timeout: 5000 })
      .toEqual(["retained-value"]);

    // Clear the retained message so it does not accumulate on the broker.
    await pubMqtt.publish(topic, "", { retain: true, qos: 1 });
  });

  it("should match MQTT topic filters against topics", async ({ expect }) => {
    // Pure function — lazy so the case table costs no broker round-trip.
    const alepha = createApp({ lazy: true });
    const mqtt = alepha.inject(TestMqttJsClientProvider);
    await alepha.start();

    const cases: Array<[string, string, boolean]> = [
      ["a/b", "a/b", true],
      ["a/b", "a/c", false],
      ["a/+", "a/b", true],
      ["a/+", "a/b/c", false],
      ["a/+/c", "a/b/c", true],
      ["+/b", "a/b", true],
      ["a/#", "a", true],
      ["a/#", "a/b", true],
      ["a/#", "a/b/c/d", true],
      ["#", "a/b/c", true],
      ["a/b", "a/b/c", false],
      ["a/b/c", "a/b", false],
    ];

    const actual = cases.map(
      ([pattern, topic]) =>
        [pattern, topic, mqtt.testTopicMatches(pattern, topic)] as const,
    );

    expect(actual).toEqual(cases);
    expect(mqtt.connectCount).toBe(0);
  });
});
