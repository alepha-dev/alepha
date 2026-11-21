import { connect } from "node:net";

import { Alepha } from "alepha";
import mqtt from "mqtt";
import mqttPacket, { type Packet } from "mqtt-packet";
import { afterAll, beforeAll, describe, it } from "vitest";

import {
  AlephaMqtt,
  MemoryMqttBroker,
  MemoryMqttClientProvider,
  type MemoryMqttListener,
  MqttClientProvider,
  MqttJsClientProvider,
  mqttOptions,
} from "../index.ts";
import { MqttClientContract, MqttInbox } from "./MqttClientContract.ts";

/**
 * The memory broker on a socket (#Q3094): the client contract that runs
 * against Mosquitto, run here by the mqtt.js client over TCP; then the
 * login check and the will of a dropped socket.
 */
const broker = Alepha.create().with(AlephaMqtt).inject(MemoryMqttBroker);
let listener: MemoryMqttListener;

beforeAll(async () => {
  listener = await broker.listen({
    authenticate: ({ username, password }) =>
      username === undefined || password === `${username}-secret`,
  });
});

afterAll(async () => {
  await listener.close();
});

describe("MQTT client contract - memory broker over TCP", () => {
  MqttClientContract.define({
    create: async (options) => {
      const alepha = Alepha.create({ env: { MQTT_URL: listener.url } })
        .with({ provide: MqttClientProvider, use: MqttJsClientProvider })
        .with(AlephaMqtt);
      alepha.set(mqttOptions, {
        ...alepha.get(mqttOptions),
        reconnectPeriod: 100,
        ...options,
      });
      const client = alepha.inject(MqttJsClientProvider);
      await alepha.start();
      return {
        client,
        simulateDisconnect: () => client.simulateDisconnect(),
      };
    },
  });
});

describe("MemoryMqttBroker.listen", () => {
  it("refuses a wrong login with CONNACK 5 (3.1.1) and 135 (5)", async ({
    expect,
  }) => {
    for (const protocolVersion of [4, 5] as const) {
      const client = mqtt.connect(listener.url, {
        username: "dev-1",
        password: "wrong",
        protocolVersion,
        reconnectPeriod: 0,
      });
      const error = await new Promise<{ code?: number }>((resolve) =>
        client.once("error", (e) => resolve(e as { code?: number })),
      );
      expect(error.code).toBe(protocolVersion === 5 ? 135 : 5);
      client.end(true);
    }
  });

  it("publishes the will of a dropped socket, not of a graceful disconnect", async ({
    expect,
  }) => {
    const watcher = await mqtt.connectAsync(listener.url, {
      protocolVersion: 4,
    });
    const seen: string[] = [];
    watcher.on("message", (_topic, payload) => seen.push(payload.toString()));
    await watcher.subscribeAsync("devices/+/state", { qos: 1 });

    const login = { username: "dev-1", password: "dev-1-secret" };
    const graceful = await mqtt.connectAsync(listener.url, {
      ...login,
      clientId: "dev-1",
      will: {
        topic: "devices/dev-1/state",
        payload: Buffer.from("gone-1"),
        qos: 1,
        retain: false,
      },
    });
    await graceful.endAsync();

    const cut = await mqtt.connectAsync(listener.url, {
      ...login,
      clientId: "dev-1",
      will: {
        topic: "devices/dev-1/state",
        payload: Buffer.from("gone-2"),
        qos: 1,
        retain: true,
      },
    });
    cut.stream.destroy();
    await expect.poll(() => seen).toEqual(["gone-2"]);
    expect(
      new TextDecoder().decode(broker.retainedMessage("devices/dev-1/state")),
    ).toBe("gone-2");
    await cut.endAsync(true);
    await watcher.endAsync();
  });

  it("answers an invalid filter's SUBACK entry with a failure, 0x80 (3.1.1) and 0x8F (5)", async ({
    expect,
  }) => {
    for (const protocolVersion of [4, 5] as const) {
      const granted = await rawSuback(protocolVersion, [
        { topic: "dev/#/b", qos: 1 },
        { topic: "dev/+/state", qos: 1 },
        { topic: "dev/a+", qos: 0 },
      ]);
      const failure = protocolVersion === 5 ? 0x8f : 0x80;
      expect(granted).toEqual([failure, 1, failure]);
    }
  });

  it("drops a connection that publishes to a wildcard topic name", async ({
    expect,
  }) => {
    const app = Alepha.create()
      .with({ provide: MqttClientProvider, use: MemoryMqttClientProvider })
      .with(AlephaMqtt);
    const local = app.inject(MemoryMqttClientProvider).useBroker(broker);
    await app.start();
    const inbox = new MqttInbox();
    await local.subscribe("wild/+", inbox.callback);

    const remote = await mqtt.connectAsync(listener.url, {
      reconnectPeriod: 0,
    });
    const closed = new Promise<void>((resolve) =>
      remote.once("close", () => resolve()),
    );
    remote.publish("wild/+", "x");
    await closed;
    await remote.endAsync(true);

    expect(inbox.texts()).toEqual([]);
    await app.stop();
  });

  it("listens on the loopback only", async ({ expect }) => {
    await expect(broker.listen({ host: "0.0.0.0" })).rejects.toThrow(
      /loopback only/,
    );
  });
});

/**
 * CONNECT then SUBSCRIBE on a raw socket, and the SUBACK's granted list:
 * mqtt.js refuses an invalid filter before it reaches the wire.
 */
const rawSuback = async (
  protocolVersion: 4 | 5,
  subscriptions: Array<{ topic: string; qos: 0 | 1 }>,
): Promise<number[]> => {
  const socket = connect(listener.port, "127.0.0.1");
  const parser = mqttPacket.parser({ protocolVersion });
  const opts = { protocolVersion };
  try {
    return await new Promise<number[]>((resolve, reject) => {
      socket.on("error", reject);
      socket.on("data", (chunk) => parser.parse(chunk as Buffer));
      parser.on("packet", (packet) => {
        if (packet.cmd === "connack") {
          socket.write(
            mqttPacket.generate(
              {
                cmd: "subscribe",
                messageId: 1,
                subscriptions,
                ...(protocolVersion === 5
                  ? { properties: { subscriptionIdentifier: 1 } }
                  : {}),
              } as Packet,
              opts,
            ),
          );
        }
        if (packet.cmd === "suback") {
          resolve(packet.granted as number[]);
        }
      });
      socket.write(
        mqttPacket.generate(
          {
            cmd: "connect",
            protocolId: "MQTT",
            protocolVersion,
            clean: true,
            clientId: `raw-${protocolVersion}`,
            keepalive: 0,
          } as Packet,
          opts,
        ),
      );
    });
  } finally {
    socket.destroy();
  }
};
