import {
  MemoryMqttBroker,
  MemoryMqttClientProvider,
  MqttClientProvider,
  mqttOptions,
} from "@alepha/mqtt";
import { Alepha, AlephaError, z } from "alepha";
import { $topic } from "alepha/topic";
import { describe, it } from "vitest";

import { MqttInbox } from "../../core/__tests__/MqttClientContract.ts";
import {
  AlephaTopicMqtt,
  MqttTopicProvider,
  mqttTopicOptions,
} from "../index.ts";

const commandSchema = {
  params: z.object({ site: z.text(), device: z.text() }),
  payload: z.object({ action: z.text() }),
  response: z.object({ done: z.boolean(), by: z.text() }),
};

class Controller {
  command = $topic({
    name: "mcs/v1/{site}/{device}/cmd",
    provider: MqttTopicProvider,
    schema: commandSchema,
  });
}

class Device {
  command = $topic({
    name: "mcs/v1/{site}/{device}/cmd",
    provider: MqttTopicProvider,
    schema: commandSchema,
    handler: async ({ params, payload }) => ({
      done: payload.action === "reboot",
      by: params.device,
    }),
  });
}

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

/**
 * A raw MQTT client answering every request on the command topics, the way
 * a device does: bare JSON to the Response Topic, Correlation Data echoed.
 */
const answerAsDevice = async (
  device: MqttClientProvider,
  reply: { done: boolean; by: string },
  filter = "#",
) => {
  const inbox = new MqttInbox();
  await device.subscribe(filter, async (message) => {
    inbox.callback(message);
    if (message.responseTopic) {
      await device.publish(message.responseTopic, JSON.stringify(reply), {
        qos: 1,
        correlationData: message.correlationData,
      });
    }
  });
  return inbox;
};

describe("MqttTopicProvider request/response", () => {
  it("answers a request from another instance through the Response Topic", async ({
    expect,
  }) => {
    const broker = newBroker();
    await createApp(broker, Device);
    const { service } = await createApp(broker, Controller);

    const result = await service?.command.request(
      {
        params: { site: "paris", device: "tvm-42" },
        payload: { action: "reboot" },
      },
      { timeout: [5, "seconds"] },
    );

    expect(result).toEqual({ done: true, by: "tvm-42" });
  });

  it("speaks plain MQTT 5 to a device: bare JSON, Response Topic, Correlation Data", async ({
    expect,
  }) => {
    const broker = newBroker();
    const { service } = await createApp(broker, Controller);
    const { client: device } = await createApp(broker);
    const requests = await answerAsDevice(
      device,
      { done: false, by: "raw-device" },
      "mcs/v1/+/+/cmd",
    );

    const result = await service?.command.request({
      params: { site: "lyon", device: "gate-1" },
      payload: { action: "stop" },
    });

    expect(result).toEqual({ done: false, by: "raw-device" });
    expect(JSON.parse(requests.texts()[0])).toEqual({ action: "stop" });
    expect(requests.messages[0].correlationData).toBeInstanceOf(Uint8Array);
  });

  it("keeps the reply topic out of the prefix, and takes it from the atom", async ({
    expect,
  }) => {
    const broker = newBroker();
    const { service } = await createApp(broker, Controller, (alepha) =>
      alepha.set(mqttTopicOptions, {
        prefix: "site-a",
        replyTopic: "acl/replies/controller-1",
      }),
    );
    const { client: device } = await createApp(broker);
    const seen = await answerAsDevice(device, { done: true, by: "d" });

    await service?.command.request({
      params: { site: "s", device: "d" },
      payload: { action: "reboot" },
    });

    expect(seen.messages.map((it) => it.topic)).toEqual([
      "site-a/mcs/v1/s/d/cmd",
      "acl/replies/controller-1",
    ]);
    expect(seen.messages[0].responseTopic).toBe("acl/replies/controller-1");
  });

  it("uses one reply topic per instance, named after the app", async ({
    expect,
  }) => {
    const broker = newBroker();
    const { alepha, service } = await createApp(broker, Controller);
    const { client: device } = await createApp(broker);
    const requests = await answerAsDevice(
      device,
      { done: true, by: "d" },
      "mcs/v1/+/+/cmd",
    );

    for (let i = 0; i < 2; i++) {
      await service?.command.request({
        params: { site: "s", device: "d" },
        payload: { action: "reboot" },
      });
    }

    const [first, second] = requests.messages.map((it) => it.responseTopic);
    expect(first).toMatch(new RegExp(`^${alepha.name}/reply/[0-9a-f-]{36}$`));
    expect(second).toBe(first);
  });

  it("refuses a request under MQTT 3.1.1", async ({ expect }) => {
    const { service } = await createApp(newBroker(), Controller, (alepha) =>
      alepha.set(mqttOptions, {
        ...alepha.get(mqttOptions),
        protocolVersion: 4,
      }),
    );

    await expect(
      service?.command.request({
        params: { site: "s", device: "d" },
        payload: { action: "reboot" },
      }),
    ).rejects.toThrow(AlephaError);
  });
});
