import { Alepha, AlephaError } from "alepha";
import { describe, it } from "vitest";

import {
  AlephaMqtt,
  MemoryMqttBroker,
  MemoryMqttClientProvider,
  MqttClientProvider,
  MqttJsClientProvider,
  type MqttOptions,
  mqttOptions,
} from "../index.ts";
import { MqttInbox } from "./MqttClientContract.ts";

const createClient = async (
  broker: MemoryMqttBroker,
  options: Partial<MqttOptions> = {},
) => {
  const alepha = Alepha.create()
    .with({ provide: MqttClientProvider, use: MemoryMqttClientProvider })
    .with(AlephaMqtt);
  alepha.set(mqttOptions, { ...alepha.get(mqttOptions), ...options });
  const client = alepha.inject(MemoryMqttClientProvider).useBroker(broker);
  await alepha.start();
  return client;
};

const newBroker = () => Alepha.create().inject(MemoryMqttBroker);

describe("MemoryMqttClientProvider", () => {
  it("hands a message matching two filters to each of them once, by subscription identifier", async ({
    expect,
  }) => {
    const client = await createClient(newBroker());
    const exact = new MqttInbox();
    const wildcard = new MqttInbox();
    await client.subscribe("a/b", exact.callback);
    await client.subscribe("a/+", wildcard.callback);

    await client.publish("a/b", "one");

    expect(exact.texts()).toEqual(["one"]);
    expect(wildcard.texts()).toEqual(["one"]);
  });

  it("keeps a shared group apart from a plain subscription of the same client", async ({
    expect,
  }) => {
    const broker = newBroker();
    const member = await createClient(broker);
    const other = await createClient(broker);
    const group = new MqttInbox();
    const plain = new MqttInbox();
    await member.subscribe("$share/g/x/+", group.callback);
    await other.subscribe("$share/g/x/+", group.callback);
    await member.subscribe("x/+", plain.callback);

    for (let i = 0; i < 4; i++) {
      await other.publish(`x/${i}`, `m${i}`);
    }

    expect(group.texts()).toEqual(["m0", "m1", "m2", "m3"]);
    expect(plain.texts()).toEqual(["m0", "m1", "m2", "m3"]);
  });

  it("rotates a shared group round robin, and reaches every local callback of the chosen member", async ({
    expect,
  }) => {
    const broker = newBroker();
    const a = await createClient(broker);
    const b = await createClient(broker);
    const a1 = new MqttInbox();
    const a2 = new MqttInbox();
    const b1 = new MqttInbox();
    await a.subscribe("$share/g/jobs", a1.callback);
    await a.subscribe("$share/g/jobs", a2.callback);
    await b.subscribe("$share/g/jobs", b1.callback);

    for (let i = 0; i < 4; i++) {
      await a.publish("jobs", `j${i}`);
    }

    expect(a1.texts()).toEqual(["j0", "j2"]);
    expect(a2.texts()).toEqual(["j0", "j2"]);
    expect(b1.texts()).toEqual(["j1", "j3"]);
  });

  it("sends no retained message on a shared subscription", async ({
    expect,
  }) => {
    const broker = newBroker();
    const client = await createClient(broker);
    await client.publish("state", "kept", { retain: true });
    const shared = new MqttInbox();
    const plain = new MqttInbox();

    await client.subscribe("$share/g/state", shared.callback);
    await client.subscribe("state", plain.callback);

    expect(shared.texts()).toEqual([]);
    expect(plain.texts()).toEqual(["kept"]);
    expect(broker.retainedMessage("state")).toBeDefined();
  });

  it("delivers at the lower of the published and the subscribed QoS", async ({
    expect,
  }) => {
    const client = await createClient(newBroker());
    const low = new MqttInbox();
    const high = new MqttInbox();
    await client.subscribe("q/low", low.callback, { qos: 0 });
    await client.subscribe("q/high", high.callback, { qos: 2 });

    await client.publish("q/low", "x", { qos: 1 });
    await client.publish("q/high", "x", { qos: 1 });

    expect(low.messages[0].qos).toBe(0);
    expect(high.messages[0].qos).toBe(1);
  });

  it("never matches a $ topic with a wildcard-led filter", async ({
    expect,
  }) => {
    const client = await createClient(newBroker());
    const all = new MqttInbox();
    const sys = new MqttInbox();
    await client.subscribe("#", all.callback);
    await client.subscribe("$SYS/#", sys.callback);

    await client.publish("$SYS/uptime", "1");

    expect(all.texts()).toEqual([]);
    expect(sys.texts()).toEqual(["1"]);
  });

  it("keeps the broker subscription until its last callback goes", async ({
    expect,
  }) => {
    const client = await createClient(newBroker());
    const first = new MqttInbox();
    const second = new MqttInbox();
    const offFirst = await client.subscribe("t", first.callback);
    const offSecond = await client.subscribe("t", second.callback);

    await offFirst();
    await client.publish("t", "a");
    await offSecond();
    await client.publish("t", "b");

    expect(first.texts()).toEqual([]);
    expect(second.texts()).toEqual(["a"]);
  });

  it("logs a callback that throws and still runs the others", async ({
    expect,
  }) => {
    const client = await createClient(newBroker());
    const inbox = new MqttInbox();
    await client.subscribe("t", () => {
      throw new AlephaError("boom");
    });
    await client.subscribe("t", inbox.callback);

    await client.publish("t", "after");

    expect(inbox.texts()).toEqual(["after"]);
  });

  it("refuses to publish on a wildcard topic", async ({ expect }) => {
    const client = await createClient(newBroker());

    await expect(client.publish("a/+", "x")).rejects.toThrow(AlephaError);
    await expect(client.publish("a/#", "x")).rejects.toThrow(AlephaError);
  });

  it("publishes no will once cleared with setWill(undefined)", async ({
    expect,
  }) => {
    const broker = newBroker();
    const watcher = await createClient(broker);
    const inbox = new MqttInbox();
    await watcher.subscribe("will", inbox.callback);
    const device = await createClient(broker, {
      will: { topic: "will", payload: "gone", qos: 0, retain: false },
    });

    device.setWill(undefined);
    await device.simulateDisconnect();
    await device.simulateDisconnect();

    expect(inbox.texts()).toEqual(["gone"]);
  });

  it("stays disconnected after a drop when reconnectPeriod is 0", async ({
    expect,
  }) => {
    const client = await createClient(newBroker(), { reconnectPeriod: 0 });

    await client.simulateDisconnect();

    expect(client.isConnected).toBe(false);
  });

  it("refuses a shared subscription under MQTT 3.1.1 and matches by filter there", async ({
    expect,
  }) => {
    const client = await createClient(newBroker(), { protocolVersion: 4 });
    const exact = new MqttInbox();
    const wildcard = new MqttInbox();

    await expect(
      client.subscribe("$share/g/x", exact.callback),
    ).rejects.toThrow(AlephaError);

    await client.subscribe("a/b", exact.callback);
    await client.subscribe("a/+", wildcard.callback);
    await client.publish("a/b", "one");

    expect(exact.texts()).toEqual(["one"]);
    expect(wildcard.texts()).toEqual(["one"]);
  });

  it("refuses useBroker() once connected", async ({ expect }) => {
    const client = await createClient(newBroker());

    expect(() => client.useBroker(newBroker())).toThrow(AlephaError);
  });
});

describe("MqttActivation", () => {
  it("selects mqtt.js when MQTT_URL is set", ({ expect }) => {
    const alepha = Alepha.create({
      env: { MQTT_URL: "mqtt://broker.invalid:1883" },
    }).with(AlephaMqtt);

    expect(alepha.inject(MqttClientProvider)).toBeInstanceOf(
      MqttJsClientProvider,
    );
  });

  it("selects the memory broker when MQTT_URL is unset or blank", ({
    expect,
  }) => {
    const unset = Alepha.create({ env: { MQTT_URL: undefined } }).with(
      AlephaMqtt,
    );
    const blank = Alepha.create({ env: { MQTT_URL: "  " } }).with(AlephaMqtt);

    expect(unset.inject(MqttClientProvider)).toBeInstanceOf(
      MemoryMqttClientProvider,
    );
    expect(blank.inject(MqttClientProvider)).toBeInstanceOf(
      MemoryMqttClientProvider,
    );
  });
});
