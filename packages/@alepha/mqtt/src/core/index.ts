import { $module, type Alepha } from "alepha";

import { MemoryMqttClientProvider } from "./providers/MemoryMqttClientProvider.ts";
import { MqttClientProvider } from "./providers/MqttClientProvider.ts";
import { MqttJsClientProvider } from "./providers/MqttJsClientProvider.ts";
import { MqttActivation } from "./services/MqttActivation.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./mqttOptions.ts";
export * from "./providers/MemoryMqttClientProvider.ts";
export * from "./providers/MqttClientProvider.ts";
export * from "./providers/MqttJsClientProvider.ts";
export * from "./services/MemoryMqttBroker.ts";
export * from "./services/MqttActivation.ts";
export * from "./services/MqttTopicMatcher.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * MQTT 5 client for Alepha.
 *
 * A lifecycle-managed client with byte payloads, Last Will (settable by
 * code), reconnection and dispatch by Subscription Identifier.
 *
 * - `MQTT_URL` set (Node or Bun): `MqttJsClientProvider`, on mqtt.js.
 * - Otherwise: `MemoryMqttClientProvider`, on an in-process broker.
 *
 * An app's own `MqttClientProvider` substitution wins over both.
 *
 * @see {@link MqttClientProvider}
 * @module alepha.mqtt
 */
export const AlephaMqtt = $module({
  name: "alepha.mqtt",
  services: [MqttClientProvider],
  variants: [MqttJsClientProvider, MemoryMqttClientProvider],
  register: (alepha: Alepha): void => {
    alepha.with({
      optional: true,
      provide: MqttClientProvider,
      use: alepha.inject(MqttActivation).isActive()
        ? MqttJsClientProvider
        : MemoryMqttClientProvider,
    });
  },
});
