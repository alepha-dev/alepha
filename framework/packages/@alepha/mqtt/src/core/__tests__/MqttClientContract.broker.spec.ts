import { Alepha } from "alepha";
import { describe } from "vitest";

import {
  AlephaMqtt,
  MqttClientProvider,
  MqttJsClientProvider,
  mqttOptions,
} from "../index.ts";
import { MqttClientContract } from "./MqttClientContract.ts";

/**
 * The contract on a real broker: Mosquitto, from `compose.yml` locally
 * (11883) and from the `mqtt-broker` job of `verify.yml` in CI, same port.
 *
 * Not in the root run: `*.broker.spec.ts` is excluded by
 * `scripts/vitest.projects.ts` and collected only by
 * `vitest.broker.config.ts`, run by `yarn test:broker`. No broker, red: it
 * never skips.
 */
const url = process.env.MQTT_URL || "mqtt://127.0.0.1:11883";

describe("MQTT client contract - Mosquitto", () => {
  MqttClientContract.define({
    create: async (options) => {
      const alepha = Alepha.create({ env: { MQTT_URL: url } })
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
