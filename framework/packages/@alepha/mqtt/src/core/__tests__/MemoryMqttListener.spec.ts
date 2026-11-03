import { Alepha } from "alepha";
import mqtt from "mqtt";
import { afterAll, beforeAll, describe, it } from "vitest";

import {
  AlephaMqtt,
  MemoryMqttBroker,
  type MemoryMqttListener,
  MqttClientProvider,
  MqttJsClientProvider,
  mqttOptions,
} from "../index.ts";
import { MqttClientContract } from "./MqttClientContract.ts";

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

  it("listens on the loopback only", async ({ expect }) => {
    await expect(broker.listen({ host: "0.0.0.0" })).rejects.toThrow(
      /loopback only/,
    );
  });
});
