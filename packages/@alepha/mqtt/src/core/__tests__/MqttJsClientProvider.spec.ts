import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { MqttClientProvider } from "../providers/MqttClientProvider.ts";
import {
  MqttJsClientProvider,
  type MqttOptions,
  mqttOptions,
} from "../providers/MqttJsClientProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Counts connections and exposes the protected internals under test.
 */
class TestMqttJsClientProvider extends MqttJsClientProvider {
  public connectCount = 0;
  public testTopicMatches = this.topicMatches.bind(this);
  public testConnectOptions = this.connectOptions.bind(this);

  /**
   * The live mqtt.js client, so a test can inspect the options it was built
   * with or kill its socket without a clean disconnect.
   */
  public get raw() {
    return this.client;
  }

  protected override async openConnection(): Promise<void> {
    this.connectCount++;
    await super.openConnection();
  }
}

/**
 * Creates an Alepha instance wired with the MQTT client.
 *
 * Patches the options atom rather than replacing it, so adding a field with a
 * default to `mqttOptions` does not break every call site here.
 */
const createApp = (options?: Partial<MqttOptions>, brokerUrl?: string) => {
  const alepha = Alepha.create(
    brokerUrl ? { env: { MQTT_BROKER_URL: brokerUrl } } : undefined,
  ).with({
    provide: MqttClientProvider,
    use: TestMqttJsClientProvider,
  });

  if (options) {
    alepha.store.mut(mqttOptions, (current) => ({ ...current, ...options }));
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

  describe("connect options", () => {
    it("should pass clientId, keepalive and reconnectPeriod through", async ({
      expect,
    }) => {
      const alepha = createApp({
        lazy: true,
        clientId: "fixed-id",
        keepalive: 30,
        reconnectPeriod: 0,
      });
      const mqtt = alepha.inject(TestMqttJsClientProvider);
      await alepha.start();

      expect(mqtt.testConnectOptions()).toMatchObject({
        clientId: "fixed-id",
        keepalive: 30,
        reconnectPeriod: 0,
      });
    });

    it("should carry an explicit username past URL credentials", async ({
      expect,
    }) => {
      const alepha = createApp({
        lazy: true,
        username: "bob",
        password: "hunter2",
      });
      const mqtt = alepha.inject(TestMqttJsClientProvider);
      await alepha.start();

      const options = mqtt.testConnectOptions();
      expect(options.username).toBe("bob");
      expect(options.password).toBe("hunter2");

      // The load-bearing part. mqtt.js merges our options over the parsed URL
      // and only THEN re-derives username/password from the URL's userinfo, so
      // without `auth` being blanked here a broker URL carrying credentials
      // silently wins and the explicit option is ignored.
      expect("auth" in options).toBe(true);
      expect(options.auth).toBeUndefined();
    });

    it("should beat URL credentials inside the real mqtt.js client", async ({
      expect,
    }) => {
      // The assertion above only proves the options object is shaped right.
      // This one proves mqtt.js actually resolves to the explicit credentials
      // — the broker is anonymous, so the connection succeeds either way and
      // only the resolved options tell the two apart.
      const alepha = createApp(
        { username: "bob", password: "hunter2" },
        "mqtt://alice:s3cret@localhost:11883",
      );
      const mqtt = alepha.inject(TestMqttJsClientProvider);
      await alepha.start();

      expect(mqtt.raw?.options.username).toBe("bob");
      expect(mqtt.raw?.options.password?.toString()).toBe("hunter2");
    });

    it("should use URL credentials when none are configured", async ({
      expect,
    }) => {
      const alepha = createApp(
        undefined,
        "mqtt://alice:s3cret@localhost:11883",
      );
      const mqtt = alepha.inject(TestMqttJsClientProvider);
      await alepha.start();

      expect(mqtt.raw?.options.username).toBe("alice");
      expect(mqtt.raw?.options.password?.toString()).toBe("s3cret");
    });

    it("should leave URL credentials alone when none are configured", async ({
      expect,
    }) => {
      const alepha = createApp({ lazy: true });
      const mqtt = alepha.inject(TestMqttJsClientProvider);
      await alepha.start();

      // `auth` must be absent entirely, not present-and-undefined — the latter
      // would blank the userinfo of a `mqtt://user:pass@host` broker URL.
      expect("auth" in mqtt.testConnectOptions()).toBe(false);
    });

    it("should let `connect` override everything above it", async ({
      expect,
    }) => {
      const alepha = createApp({
        lazy: true,
        keepalive: 30,
        connect: { keepalive: 90, connectTimeout: 4321, protocolVersion: 5 },
      });
      const mqtt = alepha.inject(TestMqttJsClientProvider);
      await alepha.start();

      expect(mqtt.testConnectOptions()).toMatchObject({
        keepalive: 90,
        connectTimeout: 4321,
        protocolVersion: 5,
      });
    });

    it("should reach the real mqtt.js client", async ({ expect }) => {
      // The options object being right is worth little if it stops there.
      const alepha = createApp({
        clientId: `probe-${randomUUID()}`,
        keepalive: 42,
        reconnectPeriod: 0,
        connect: { connectTimeout: 4321 },
      });
      const mqtt = alepha.inject(TestMqttJsClientProvider);
      await alepha.start();

      expect(mqtt.raw?.options).toMatchObject({
        keepalive: 42,
        reconnectPeriod: 0,
        connectTimeout: 4321,
      });
    });
  });

  describe("last will and testament", () => {
    it("should be published by the broker when a client dies ungracefully", async ({
      expect,
    }) => {
      const ns = namespace();
      const willTopic = `${ns}/status`;
      const received: string[] = [];

      const observerApp = createApp();
      const observer = observerApp.inject(TestMqttJsClientProvider);
      await observerApp.start();
      await observer.subscribe(
        willTopic,
        (_t, payload) => {
          received.push(payload);
        },
        { qos: 1 },
      );

      // reconnectPeriod 0: killing the socket must not start a reconnect loop
      // that races the assertion below.
      const doomedApp = createApp({
        reconnectPeriod: 0,
        will: { topic: willTopic, payload: "offline", qos: 1, retain: false },
      });
      const doomed = doomedApp.inject(TestMqttJsClientProvider);
      await doomedApp.start();
      expect(doomed.isConnected).toBe(true);

      // A normal publish does not trigger the will.
      await doomed.publish(`${ns}/alive`, "1", { qos: 1 });
      expect(received).toEqual([]);

      // Destroy the TCP socket without sending DISCONNECT — the crash, network
      // drop or kill -9 that the will exists for.
      doomed.raw?.stream.destroy();

      await expect.poll(() => received, { timeout: 5000 }).toEqual(["offline"]);
    });

    it("should NOT be published on a graceful disconnect", async ({
      expect,
    }) => {
      const ns = namespace();
      const willTopic = `${ns}/status`;
      const sentinelTopic = `${ns}/sentinel`;
      const willed: string[] = [];
      const sentinel: string[] = [];

      const observerApp = createApp();
      const observer = observerApp.inject(TestMqttJsClientProvider);
      await observerApp.start();
      await observer.subscribe(
        willTopic,
        (_t, payload) => {
          willed.push(payload);
        },
        { qos: 1 },
      );
      await observer.subscribe(
        sentinelTopic,
        (_t, payload) => {
          sentinel.push(payload);
        },
        { qos: 1 },
      );

      const app = createApp({
        reconnectPeriod: 0,
        will: { topic: willTopic, payload: "offline", qos: 1, retain: false },
      });
      app.inject(TestMqttJsClientProvider);
      await app.start();

      // A clean stop sends DISCONNECT, which tells the broker to discard the
      // will rather than publish it.
      await app.stop();

      // Round-trip through the broker after the disconnect completed, so the
      // assertion below is not just reading an empty array too early.
      await observer.publish(sentinelTopic, "ping", { qos: 1 });
      await expect.poll(() => sentinel, { timeout: 5000 }).toEqual(["ping"]);

      expect(willed).toEqual([]);
    });
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
