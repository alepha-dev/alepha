import { AlephaMqtt } from "@alepha/mqtt";
import { $module, type Alepha } from "alepha";
import { AlephaTopic } from "alepha/topic";

import { MqttTopicProvider } from "./providers/MqttTopicProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./providers/MqttTopicProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * `$topic` over MQTT, for device and integration topics.
 *
 * Registers `MqttTopicProvider` as a service, with `AlephaMqtt` and
 * `AlephaTopic`, and leaves the app's `TopicProvider` alone: the framework's
 * own topics stay on memory or Redis, and a device topic opts in with
 * `provider: MqttTopicProvider`.
 *
 * @see {@link MqttTopicProvider}
 * @module alepha.topic.mqtt
 */
export const AlephaTopicMqtt = $module({
  name: "alepha.topic.mqtt",
  services: [MqttTopicProvider],
  register: (alepha: Alepha): Alepha =>
    alepha.with(AlephaMqtt).with(AlephaTopic),
});
