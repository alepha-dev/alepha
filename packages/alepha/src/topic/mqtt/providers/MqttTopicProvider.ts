import { $atom, $hook, $inject, $use, type Static, t } from "alepha";
import { $logger } from "alepha/logger";
import { MqttClientProvider } from "alepha/mqtt";
import {
  type SubscribeCallback,
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
  schema: t.object({
    prefix: t.text({
      default: "topic",
      description: "Prefix for all topic channels in MQTT.",
    }),
  }),
  default: {
    prefix: "topic",
  },
});

export type MqttTopicOptions = Static<typeof mqttTopicOptions.schema>;

declare module "alepha" {
  interface State {
    [mqttTopicOptions.key]: MqttTopicOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Module augmentation — adds MQTT-specific publish options to $topic.
 *
 * Only used when the active TopicProvider is MqttTopicProvider.
 * Ignored by Memory and Redis providers.
 */
declare module "alepha/topic" {
  interface TopicSubscribeOptions {
    mqtt?: {
      qos?: 0 | 1 | 2;
    };
  }

  interface TopicPrimitiveOptions<T> {
    /**
     * MQTT-specific options for this topic.
     * Only used when the active TopicProvider is MqttTopicProvider.
     * Ignored by Memory and Redis providers.
     */
    mqtt?: {
      /**
       * MQTT Quality of Service level.
       * - 0: At most once (fire and forget)
       * - 1: At least once (acknowledged delivery)
       * - 2: Exactly once (four-step handshake)
       *
       * @default 0
       */
      qos?: 0 | 1 | 2;
    };
  }
}

// ---------------------------------------------------------------------------------------------------------------------

export class MqttTopicProvider extends TopicProvider {
  protected readonly mqttClient = $inject(MqttClientProvider);
  protected readonly options = $use(mqttTopicOptions);
  protected readonly log = $logger();

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
      qos: (options as any)?.mqtt?.qos ?? 0,
      retain: options?.retain ?? false,
    });
  }

  public async subscribe(
    name: string,
    callback: SubscribeCallback,
    options?: TopicSubscribeOptions,
  ): Promise<UnSubscribeFn> {
    const qos = options?.mqtt?.qos;

    return this.mqttClient.subscribe(
      this.prefix(name),
      (receivedTopic, payload) => {
        const unprefixed = this.unprefix(receivedTopic);
        return callback(payload, unprefixed);
      },
      qos !== undefined ? { qos } : undefined,
    );
  }

  public async unsubscribe(name: string): Promise<void> {
    await this.mqttClient.unsubscribe(this.prefix(name));
  }
}
