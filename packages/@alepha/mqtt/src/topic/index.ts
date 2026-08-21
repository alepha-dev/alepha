import { $module, type Alepha } from "alepha";
import { AlephaTopic, TopicProvider } from "alepha/topic";

import { MqttTopicProvider } from "./providers/MqttTopicProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/MqttTopicProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Plugin for Alepha Topic that provides MQTT pub/sub capabilities.
 *
 * Users must register `AlephaMqtt` separately for the MQTT client transport.
 *
 * @see {@link MqttTopicProvider}
 * @module alepha.topic.mqtt
 */
export const AlephaTopicMqtt = $module({
  name: "alepha.topic.mqtt",
  services: [MqttTopicProvider],
  register: (alepha: Alepha): Alepha =>
    alepha
      .with({
        optional: true,
        provide: TopicProvider,
        use: MqttTopicProvider,
      })
      .with(AlephaTopic),
});
