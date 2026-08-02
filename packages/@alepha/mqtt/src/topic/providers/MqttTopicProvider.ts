import { MqttClientProvider, type MqttQoS } from "@alepha/mqtt";
import { $atom, $hook, $inject, $store, type Infer, z } from "alepha";
import { $logger } from "alepha/logger";
import {
  type SubscribeCallback,
  type TopicMessageSchema,
  TopicProvider,
  type TopicPublishOptions,
  type TopicSubscribeOptions,
  type UnSubscribeFn,
} from "alepha/topic";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * MQTT topic configuration atom.
 */
export const mqttTopicOptions = $atom({
  name: "alepha.topic.mqtt.options",
  schema: z.object({
    prefix: z.text({
      default: "topic",
      description: "Prefix for all topic channels in MQTT.",
    }),
  }),
  default: {
    prefix: "topic",
  },
  serverOnly: true,
});

export type MqttTopicOptions = Infer<typeof mqttTopicOptions.schema>;

declare module "alepha" {
  interface State {
    [mqttTopicOptions.key]: MqttTopicOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * MQTT-specific options, attachable to a `$topic` declaration and carried
 * through publish/subscribe.
 *
 * Ignored by the Memory and Redis providers.
 */
export interface MqttTopicSettings {
  /**
   * MQTT Quality of Service level.
   *
   * - `0`: at most once (fire and forget)
   * - `1`: at least once (acknowledged delivery)
   * - `2`: exactly once (four-step handshake)
   *
   * @default 1
   */
  qos?: MqttQoS;
}

/**
 * Module augmentation — adds MQTT-specific options to $topic.
 *
 * Only used when the active TopicProvider is MqttTopicProvider.
 * Ignored by Memory and Redis providers.
 */
declare module "alepha/topic" {
  interface TopicPublishOptions {
    mqtt?: MqttTopicSettings;
  }

  interface TopicSubscribeOptions {
    mqtt?: MqttTopicSettings;
  }

  interface TopicPrimitiveOptions<T extends TopicMessageSchema> {
    /**
     * MQTT-specific options for this topic.
     * Only used when the active TopicProvider is MqttTopicProvider.
     * Ignored by Memory and Redis providers.
     */
    mqtt?: MqttTopicSettings;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export class MqttTopicProvider extends TopicProvider {
  protected readonly mqttClient = $inject(MqttClientProvider);
  protected readonly options = $store(mqttTopicOptions);
  protected readonly log = $logger();

  /**
   * QoS used when a topic does not pick one.
   *
   * MQTT's own default is 0, but `TopicProvider.publish()` returns a promise,
   * and at QoS 0 that promise resolves on socket write — it says nothing about
   * whether the broker took the message. QoS 1 makes the await mean what the
   * Memory and Redis providers already make it mean, which is also what makes
   * two awaited publishes arrive in the order they were issued. Opt down with
   * `mqtt: { qos: 0 }` on the topic.
   */
  protected readonly defaultQos: MqttQoS = 1;

  protected readonly start = $hook({
    on: "start",
    handler: async () => {
      const subscribers = this.subscribers();
      if (subscribers.length) {
        await Promise.all(subscribers.map((fn) => fn()));
        for (const subscriber of subscribers) {
          this.log.debug(`Subscribed to topic '${subscriber.name}'`);
        }
      }
    },
  });

  /**
   * Returns the MQTT topic path with prefix applied (using / separator).
   */
  public prefix(name: string): string {
    return `${this.options.prefix}/${name}`;
  }

  /**
   * Strips the prefix from a received MQTT topic path.
   */
  protected unprefix(topic: string): string {
    const pfx = `${this.options.prefix}/`;
    return topic.startsWith(pfx) ? topic.slice(pfx.length) : topic;
  }

  /**
   * MQTT uses + as the single-level wildcard character.
   */
  protected override wildcardChar(): string {
    return "+";
  }

  public async publish(
    topic: string,
    message: string,
    options?: TopicPublishOptions,
  ): Promise<void> {
    await this.mqttClient.publish(this.prefix(topic), message, {
      qos: options?.mqtt?.qos ?? this.defaultQos,
      retain: options?.retain ?? false,
    });
  }

  public async subscribe(
    name: string,
    callback: SubscribeCallback,
    options?: TopicSubscribeOptions,
  ): Promise<UnSubscribeFn> {
    return this.mqttClient.subscribe(
      this.prefix(name),
      (receivedTopic, payload) =>
        callback(payload, this.unprefix(receivedTopic)),
      { qos: options?.mqtt?.qos ?? this.defaultQos },
    );
  }

  public async unsubscribe(name: string): Promise<void> {
    await this.mqttClient.unsubscribe(this.prefix(name));
  }
}
