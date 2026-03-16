import { randomUUID } from "node:crypto";
import { Alepha } from "alepha";
import { describe, it } from "vitest";
import { MqttClientProvider } from "./MqttClientProvider.ts";
import { MqttJsClientProvider, mqttOptions } from "./MqttJsClientProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Creates an Alepha instance wired with MqttJsClientProvider.
 */
const createApp = () => {
  return Alepha.create().with({
    provide: MqttClientProvider,
    use: MqttJsClientProvider,
  });
};

// ---------------------------------------------------------------------------------------------------------------------

describe("MqttJsClientProvider", () => {
  it("should connect on start and disconnect on stop", async ({ expect }) => {
    const alepha = createApp();
    const mqtt = alepha.inject(MqttJsClientProvider);

    expect(mqtt.isConnected).toBe(false);

    await alepha.start();
    expect(mqtt.isConnected).toBe(true);

    await alepha.stop();
    expect(mqtt.isConnected).toBe(false);
  });

  it("should publish and receive a message", async ({ expect }) => {
    const topic = `test/mqtt-client/${randomUUID()}/basic`;
    const received: string[] = [];

    const alepha = createApp();
    const mqtt = alepha.inject(MqttJsClientProvider);
    await alepha.start();

    await mqtt.subscribe(topic, (_t, payload) => {
      received.push(payload);
    });

    await mqtt.publish(topic, "hello");

    await expect.poll(() => received.length, { timeout: 5000 }).toBe(1);
    expect(received[0]).toBe("hello");

    await alepha.stop();
  });

  it("should support wildcard subscriptions with + single-level wildcard", async ({
    expect,
  }) => {
    const uid = randomUUID();
    const pattern = `test/mqtt-client/${uid}/+/data`;
    const received: Array<{ topic: string; payload: string }> = [];

    const alepha = createApp();
    const mqtt = alepha.inject(MqttJsClientProvider);
    await alepha.start();

    await mqtt.subscribe(pattern, (t, payload) => {
      received.push({ topic: t, payload });
    });

    await mqtt.publish(`test/mqtt-client/${uid}/device1/data`, "msg1");
    await mqtt.publish(`test/mqtt-client/${uid}/device2/data`, "msg2");

    await expect.poll(() => received.length, { timeout: 5000 }).toBe(2);

    const topics = received.map((r) => r.topic);
    expect(topics).toContain(`test/mqtt-client/${uid}/device1/data`);
    expect(topics).toContain(`test/mqtt-client/${uid}/device2/data`);

    const payloads = received.map((r) => r.payload);
    expect(payloads).toContain("msg1");
    expect(payloads).toContain("msg2");

    await alepha.stop();
  });

  it("should not auto-connect when lazy: true", async ({ expect }) => {
    const alepha = createApp();
    alepha.store.mut(mqttOptions, () => ({ keepalive: 60, lazy: true }));

    const mqtt = alepha.inject(MqttJsClientProvider);

    await alepha.start();
    expect(mqtt.isConnected).toBe(false);

    // publish should trigger lazy connection
    const topic = `test/mqtt-client/${randomUUID()}/lazy`;
    await mqtt.publish(topic, "wake-up");
    expect(mqtt.isConnected).toBe(true);

    await alepha.stop();
  });

  it("should stop receiving messages after unsubscribe", async ({ expect }) => {
    const topic = `test/mqtt-client/${randomUUID()}/unsub`;
    const received: string[] = [];

    const alepha = createApp();
    const mqtt = alepha.inject(MqttJsClientProvider);
    await alepha.start();

    const unsubscribe = await mqtt.subscribe(topic, (_t, payload) => {
      received.push(payload);
    });

    await mqtt.publish(topic, "before-unsub");
    await expect.poll(() => received.length, { timeout: 5000 }).toBe(1);

    await unsubscribe();

    await mqtt.publish(topic, "after-unsub");

    // Give a short window to confirm the second message does NOT arrive.
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    expect(received.length).toBe(1);

    await alepha.stop();
  });

  it("should deliver a retained message to a late subscriber", async ({
    expect,
  }) => {
    const topic = `test/mqtt-client/${randomUUID()}/retain`;
    const received: string[] = [];

    const alepha = createApp();
    const mqtt = alepha.inject(MqttJsClientProvider);
    await alepha.start();

    // Publish with retain before subscribing.
    await mqtt.publish(topic, "retained-value", { retain: true });

    // Subscribe after the message was published.
    await mqtt.subscribe(topic, (_t, payload) => {
      received.push(payload);
    });

    await expect.poll(() => received.length, { timeout: 5000 }).toBe(1);
    expect(received[0]).toBe("retained-value");

    // Clean up: clear the retained message from the broker.
    await mqtt.publish(topic, "", { retain: true });

    await alepha.stop();
  });
});
