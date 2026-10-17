import {
  MemoryMqttBroker,
  MemoryMqttClientProvider,
  MqttClientProvider,
  mqttOptions,
} from "@alepha/mqtt";
import { Alepha, AlephaError, z } from "alepha";
import {
  $subscriber,
  $topic,
  MemoryTopicProvider,
  TopicProvider,
} from "alepha/topic";
import { describe, it } from "vitest";

import { MqttInbox } from "../../core/__tests__/MqttClientContract.ts";
import {
  AlephaTopicMqtt,
  MqttTopicProvider,
  mqttTopicOptions,
} from "../index.ts";

const statusSchema = z.object({ state: z.text(), level: z.number() });

class Devices {
  received: Array<{ site: string; device: string; state: string }> = [];

  status = $topic({
    name: "mcs/v1/{site}/{device}/status",
    provider: MqttTopicProvider,
    schema: {
      params: z.object({ site: z.text(), device: z.text() }),
      payload: statusSchema,
    },
  });

  onStatus = $subscriber({
    topic: this.status,
    handler: async (message) => {
      this.received.push({ ...message.params, state: message.payload.state });
    },
  });
}

class SharedDevices {
  first: string[] = [];
  second: string[] = [];

  status = $topic({
    name: "fleet/{device}/status",
    provider: MqttTopicProvider,
    schema: {
      params: z.object({ device: z.text() }),
      payload: statusSchema,
    },
    mqtt: { qos: 1, share: "fleet" },
  });

  onFirst = $subscriber({
    topic: this.status,
    handler: async (message) => {
      this.first.push(message.payload.state);
    },
  });

  onSecond = $subscriber({
    topic: this.status,
    handler: async (message) => {
      this.second.push(message.payload.state);
    },
  });
}

/**
 * A container on the shared broker, with the client the spec drives as a
 * "device".
 */
const createApp = async <T extends object>(
  broker: MemoryMqttBroker,
  service?: new () => T,
  configure?: (alepha: Alepha) => void,
) => {
  const alepha = Alepha.create()
    .with({ provide: MqttClientProvider, use: MemoryMqttClientProvider })
    .with(AlephaTopicMqtt);
  if (service) {
    alepha.with(service);
  }
  configure?.(alepha);
  const client = alepha.inject(MemoryMqttClientProvider).useBroker(broker);
  await alepha.start();
  return { alepha, client, service: service && alepha.inject(service) };
};

const newBroker = () => Alepha.create().inject(MemoryMqttBroker);

describe("MqttTopicProvider", () => {
  it("hands bare JSON a device publishes to a typed $subscriber, with its params", async ({
    expect,
  }) => {
    const broker = newBroker();
    const { service } = await createApp(broker, Devices);
    const { client: device } = await createApp(broker);

    await device.publish(
      "mcs/v1/paris/tvm-42/status",
      JSON.stringify({ state: "ok", level: 3 }),
      { qos: 1 },
    );

    expect(service?.received).toEqual([
      { site: "paris", device: "tvm-42", state: "ok" },
    ]);
  });

  it("publishes the payload alone, on the exact topic name", async ({
    expect,
  }) => {
    const broker = newBroker();
    const { service } = await createApp(broker, Devices);
    const { client: device } = await createApp(broker);
    const inbox = new MqttInbox();
    await device.subscribe("mcs/v1/+/+/status", inbox.callback, { qos: 2 });

    await service?.status.publish({
      params: { site: "lyon", device: "gate-1" },
      payload: { state: "down", level: 0 },
    });

    expect(inbox.messages[0].topic).toBe("mcs/v1/lyon/gate-1/status");
    expect(JSON.parse(inbox.texts()[0])).toEqual({ state: "down", level: 0 });
    // The default QoS is 1.
    expect(inbox.messages[0].qos).toBe(1);
  });

  it("drops a message that does not decode, and keeps going", async ({
    expect,
  }) => {
    const broker = newBroker();
    const { service } = await createApp(broker, Devices);
    const { client: device } = await createApp(broker);

    await device.publish("mcs/v1/a/b/status", "not json");
    await device.publish("mcs/v1/a/b/status", JSON.stringify({ state: 1 }));
    await device.publish(
      "mcs/v1/a/b/status",
      JSON.stringify({ state: "ok", level: 1 }),
    );

    expect(service?.received).toEqual([
      { site: "a", device: "b", state: "ok" },
    ]);
  });

  it("joins the prefix atom with / and strips it before extracting params", async ({
    expect,
  }) => {
    const broker = newBroker();
    const { service } = await createApp(broker, Devices, (alepha) =>
      alepha.set(mqttTopicOptions, { prefix: "site-a" }),
    );
    const { client: device } = await createApp(broker);
    const inbox = new MqttInbox();
    await device.subscribe("#", inbox.callback);

    await device.publish(
      "site-a/mcs/v1/x/y/status",
      JSON.stringify({ state: "ok", level: 1 }),
    );
    await service?.status.publish({
      params: { site: "x", device: "z" },
      payload: { state: "up", level: 2 },
    });

    expect(service?.received).toEqual([
      { site: "x", device: "y", state: "ok" },
      { site: "x", device: "z", state: "up" },
    ]);
    expect(inbox.messages.map((it) => it.topic)).toEqual([
      "site-a/mcs/v1/x/y/status",
      "site-a/mcs/v1/x/z/status",
    ]);
  });

  it("hands each message to one instance of a shared group, and to every local $subscriber there", async ({
    expect,
  }) => {
    const broker = newBroker();
    const a = await createApp(broker, SharedDevices);
    const b = await createApp(broker, SharedDevices);
    const { client: device } = await createApp(broker);

    for (let i = 0; i < 4; i++) {
      await device.publish(
        `fleet/d${i}/status`,
        JSON.stringify({ state: `s${i}`, level: i }),
        { qos: 1 },
      );
    }

    const seenA = a.service?.first ?? [];
    const seenB = b.service?.first ?? [];
    expect([...seenA, ...seenB].sort()).toEqual(["s0", "s1", "s2", "s3"]);
    expect(seenA.length).toBe(2);
    expect(a.service?.second).toEqual(seenA);
    expect(b.service?.second).toEqual(seenB);
  });

  it("keeps a wait() beside a shared $subscriber out of the group, and the handler runs once", async ({
    expect,
  }) => {
    const broker = newBroker();
    const { service } = await createApp(broker, SharedDevices);
    const { client: device } = await createApp(broker);

    const waited = service?.status.wait({
      filter: (message) => message.params.device === "d7",
    });
    // `wait()` subscribes in the background; on the memory broker that is
    // microtasks only, all settled by the next macrotask.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await device.publish(
      "fleet/d7/status",
      JSON.stringify({ state: "ok", level: 7 }),
    );

    const message = await waited;
    expect(message?.params).toEqual({ device: "d7" });
    expect(message?.payload.state).toBe("ok");
    expect(service?.first).toEqual(["ok"]);
    expect(service?.second).toEqual(["ok"]);
  });

  it("forwards a per-topic QoS to the client, on publish and on subscribe", async ({
    expect,
  }) => {
    class QosTopics {
      low = $topic({
        name: "qos/low",
        provider: MqttTopicProvider,
        schema: { payload: statusSchema },
        mqtt: { qos: 0 },
        handler: () => undefined,
      });
    }

    class InspectableClient extends MemoryMqttClientProvider {
      public subscribedQos(filter: string) {
        return this.subscriptions.get(filter)?.qos;
      }
    }

    const broker = newBroker();
    const alepha = Alepha.create()
      .with({ provide: MqttClientProvider, use: InspectableClient })
      .with(AlephaTopicMqtt)
      .with(QosTopics);
    const client = alepha.inject(InspectableClient).useBroker(broker);
    await alepha.start();
    const { client: device } = await createApp(broker);
    const inbox = new MqttInbox();
    await device.subscribe("qos/low", inbox.callback, { qos: 2 });

    await alepha.inject(QosTopics).low.publish({ state: "ok", level: 1 });

    expect(client.subscribedQos("qos/low")).toBe(0);
    expect(inbox.messages[0].qos).toBe(0);
  });

  it("refuses a shared group under MQTT 3.1.1", async ({ expect }) => {
    class Shared {
      t = $topic({
        name: "jobs",
        provider: MqttTopicProvider,
        schema: { payload: statusSchema },
        mqtt: { share: "g" },
      });
    }

    const alepha = Alepha.create()
      .with({ provide: MqttClientProvider, use: MemoryMqttClientProvider })
      .with(AlephaTopicMqtt)
      .with(Shared);
    alepha.set(mqttOptions, { ...alepha.get(mqttOptions), protocolVersion: 4 });
    await alepha.start();

    await expect(
      alepha.inject(Shared).t.subscribe(() => undefined),
    ).rejects.toThrow(AlephaError);
  });

  it("leaves the framework's own topics on the app's TopicProvider", async ({
    expect,
  }) => {
    const { alepha } = await createApp(newBroker(), Devices);

    expect(alepha.inject(TopicProvider)).toBeInstanceOf(MemoryTopicProvider);
    expect(alepha.inject(Devices).status.provider).toBeInstanceOf(
      MqttTopicProvider,
    );
  });
});
