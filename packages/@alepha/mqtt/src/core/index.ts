import { $module, type Alepha } from "alepha";

import { MqttClientProvider } from "./providers/MqttClientProvider.ts";
import { MqttJsClientProvider } from "./providers/MqttJsClientProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/MqttClientProvider.ts";
export * from "./providers/MqttJsClientProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * MQTT client module for Alepha.
 *
 * Provides a lifecycle-managed MQTT client backed by `mqtt.js`.
 * Registers `MqttJsClientProvider` as the default implementation of `MqttClientProvider`.
 *
 * @see {@link MqttClientProvider}
 * @see {@link MqttJsClientProvider}
 * @module alepha.mqtt
 */
export const AlephaMqtt = $module({
  name: "alepha.mqtt",
  services: [MqttClientProvider],
  variants: [MqttJsClientProvider],
  register: (alepha: Alepha): void => {
    alepha.with({
      optional: true,
      provide: MqttClientProvider,
      use: MqttJsClientProvider,
    });
  },
});
