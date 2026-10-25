import { Alepha } from "alepha";
import { beforeEach, describe } from "vitest";

import {
  AlephaMqtt,
  MemoryMqttBroker,
  MemoryMqttClientProvider,
  MqttClientProvider,
  mqttOptions,
} from "../index.ts";
import { MqttClientContract } from "./MqttClientContract.ts";

describe("MQTT client contract - memory broker", () => {
  // One broker per test, shared by every client the test creates.
  let broker: MemoryMqttBroker;
  beforeEach(() => {
    broker = Alepha.create().inject(MemoryMqttBroker);
  });

  MqttClientContract.define({
    create: async (options) => {
      const alepha = Alepha.create()
        .with({ provide: MqttClientProvider, use: MemoryMqttClientProvider })
        .with(AlephaMqtt);
      alepha.set(mqttOptions, { ...alepha.get(mqttOptions), ...options });
      const client = alepha.inject(MemoryMqttClientProvider).useBroker(broker);
      await alepha.start();
      return {
        client,
        simulateDisconnect: () => client.simulateDisconnect(),
      };
    },
  });
});
