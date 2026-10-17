import {
  MqttClientProvider,
  type MqttMessage,
  type MqttQoS,
} from "@alepha/mqtt";
import {
  $atom,
  $hook,
  $inject,
  $store,
  AlephaError,
  type Infer,
  z,
} from "alepha";
import { $logger } from "alepha/logger";
import {
  type SubscribeCallback,
  type TopicMessage,
  type TopicMessageMeta,
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
      default: "",
      description:
        "Joined with `/` in front of every topic name. Empty by default: on MQTT the topic name is the contract with devices and other systems.",
    }),
    replyTopic: z
      .text({
        description:
          "This instance's reply topic for `request()`, used verbatim (never prefixed). Default: `<alepha.name>/reply/<instance id>`. The broker ACL must let responders publish there.",
      })
      .optional(),
  }),
  default: {
    prefix: "",
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
 * MQTT-specific options of a `$topic`, carried through publish and
 * subscribe. Ignored by the memory and Redis providers.
 */
export interface MqttTopicSettings {
  /**
   * MQTT Quality of Service level, for publishing and for subscribing.
   *
   * - `0`: at most once (fire and forget)
   * - `1`: at least once (acknowledged delivery)
   * - `2`: exactly once (four-step handshake)
   *
   * @default 1
   */
  qos?: MqttQoS;

  /**
   * Subscribe as a member of this shared group (`$share/<group>/<filter>`),
   * so N instances of an app handle each message once between them, not N
   * times. A member is the instance's connection: the topic's `handler` and
   * every `$subscriber` on it run for the copies this instance receives.
   *
   * `wait()` never joins the group. Needs MQTT 5.
   */
  share?: string;
}

declare module "alepha/topic" {
  interface TopicPublishOptions {
    mqtt?: MqttTopicSettings;
  }

  interface TopicSubscribeOptions {
    mqtt?: MqttTopicSettings;
  }

  interface TopicPrimitiveOptions<T extends TopicMessageSchema> {
    /**
     * MQTT-specific options for this topic: QoS and shared group. Used by
     * `MqttTopicProvider`, ignored by the memory and Redis providers.
     */
    mqtt?: MqttTopicSettings;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Topics over MQTT, for device and integration topics.
 *
 * **Opt in per topic, never the app's `TopicProvider`.** The framework's own
 * topics (`websocket:broadcast`, `parameter:sync`) stay on memory or Redis;
 * a device topic names this provider:
 *
 * ```ts
 * status = $topic({
 *   name: "mcs/v1/{site}/{device}/status",
 *   provider: MqttTopicProvider,
 *   schema: {
 *     params: z.object({ site: z.text(), device: z.text() }),
 *     payload: deviceStatusSchema,
 *   },
 *   mqtt: { qos: 1, share: "mcs" },
 * });
 * ```
 *
 * - **Topic names are exact**: no prefix unless the `prefix` atom sets one.
 * - **Params are `+` wildcards**: a subscriber on a templated name receives
 *   the params of the topic each message arrived on.
 * - **The wire format is the payload alone**, UTF-8 JSON, which is what a
 *   device publishes; not the `{ payload }` envelope of memory and Redis.
 * - **QoS 1 by default.** At QoS 0 an awaited publish resolves on the
 *   socket write and proves nothing; QoS 1 makes the await mean what the
 *   memory and Redis providers make it mean. QoS 1 is at-least-once, so a
 *   handler on a device topic must be idempotent.
 *
 * It runs on whichever `MqttClientProvider` `AlephaMqtt` selects: the memory
 * broker when `MQTT_URL` is unset, which is what tests use.
 */
export class MqttTopicProvider extends TopicProvider {
  protected readonly mqttClient = $inject(MqttClientProvider);
  protected readonly options = $store(mqttTopicOptions);
  protected readonly log = $logger();

  /**
   * QoS used when a topic does not pick one.
   */
  protected readonly defaultQos: MqttQoS = 1;

  protected readonly start = $hook({
    on: "start",
    handler: async () => {
      const subscribers = this.subscribers();
      if (subscribers.length) {
        await Promise.all(subscribers.map((it) => it.subscribe()));
        for (const subscriber of subscribers) {
          this.log.debug(`Subscribed to topic '${subscriber.name}'`);
        }
      }
    },
  });

  /**
   * The MQTT topic of a name: `<prefix>/<name>`, or the name alone when the
   * prefix is empty (the default).
   */
  public prefix(name: string): string {
    return this.options.prefix ? `${this.options.prefix}/${name}` : name;
  }

  /**
   * Strip the prefix from a received topic, so params are extracted from
   * the bare name.
   */
  protected unprefix(topic: string): string {
    if (!this.options.prefix) {
      return topic;
    }

    const prefix = `${this.options.prefix}/`;
    return topic.startsWith(prefix) ? topic.slice(prefix.length) : topic;
  }

  protected override wildcardChar(): string {
    return "+";
  }

  /**
   * The payload alone, as JSON: what a device publishes and expects.
   */
  protected override encodeMessage<T extends TopicMessageSchema>(
    schema: T["payload"],
    payload: TopicMessage<T>["payload"],
  ): string {
    return JSON.stringify(this.alepha.codec.encode(schema, payload));
  }

  protected override decodeMessage<T extends TopicMessageSchema>(
    schema: T["payload"],
    raw: string,
  ): TopicMessage<T>["payload"] {
    return this.alepha.codec.decode(
      schema,
      JSON.parse(raw),
    ) as TopicMessage<T>["payload"];
  }

  /**
   * Nothing to read in the payload: the reply address travels as MQTT 5
   * properties, handed to the subscribe callback.
   */
  protected override decodeMeta(): TopicMessageMeta | undefined {
    return undefined;
  }

  public async publish(
    topic: string,
    message: string,
    options?: TopicPublishOptions,
  ): Promise<void> {
    const reply = options?.reply;
    if (reply?.replyTo !== undefined && this.mqttClient.protocolVersion !== 5) {
      throw new AlephaError(
        "request() over MQTT needs MQTT 5: the reply address travels as Response Topic and Correlation Data",
      );
    }

    await this.mqttClient.publish(this.prefix(topic), message, {
      qos: options?.mqtt?.qos ?? this.defaultQos,
      retain: options?.retain ?? false,
      responseTopic: reply?.replyTo,
      correlationData: reply?.correlationData,
    });
  }

  /**
   * Send a reply to the request's Response Topic, verbatim (never
   * prefixed: it is an address on the wire, not a topic name), with its
   * Correlation Data as received.
   */
  protected override async reply(
    meta: TopicMessageMeta,
    encoded: string,
  ): Promise<void> {
    if (meta.replyTo === undefined) {
      return;
    }

    await this.mqttClient.publish(meta.replyTo, encoded, {
      qos: this.defaultQos,
      correlationData: meta.correlationData,
    });
  }

  /**
   * `<alepha.name>/reply/<instance id>`, or the atom's `replyTopic`. Not
   * prefixed.
   */
  protected override replyTopic(): string {
    return (
      this.options.replyTopic || `${this.alepha.name}/reply/${this.instanceId}`
    );
  }

  /**
   * The reply topic, subscribed verbatim: a plain subscription, never in a
   * shared group.
   */
  protected override subscribeReplies(
    callback: SubscribeCallback,
  ): Promise<UnSubscribeFn> {
    const decoder = new TextDecoder();
    return this.mqttClient.subscribe(
      this.replyTopic(),
      (message) =>
        callback(
          decoder.decode(message.payload),
          message.topic,
          this.meta(message),
        ),
      { qos: this.defaultQos },
    );
  }

  /**
   * Subscribe to a topic, or to a `+` filter for a templated name.
   *
   * With `mqtt.share`, the filter is `$share/<group>/<filter>`. Every
   * callback on one filter shares the client's one broker subscription, so
   * the group's copy reaches all of this instance's handlers.
   */
  public async subscribe(
    name: string,
    callback: SubscribeCallback,
    options?: TopicSubscribeOptions,
  ): Promise<UnSubscribeFn> {
    const filter = this.prefix(name);
    const share = options?.mqtt?.share;
    const decoder = new TextDecoder();

    return this.mqttClient.subscribe(
      share ? `$share/${share}/${filter}` : filter,
      (message) =>
        callback(
          decoder.decode(message.payload),
          this.unprefix(message.topic),
          this.meta(message),
        ),
      { qos: options?.mqtt?.qos ?? this.defaultQos },
    );
  }

  /**
   * The request/response address of a received message, from its MQTT 5
   * properties.
   */
  protected meta(message: MqttMessage): TopicMessageMeta | undefined {
    if (
      message.responseTopic === undefined &&
      message.correlationData === undefined
    ) {
      return undefined;
    }

    return {
      replyTo: message.responseTopic,
      correlationData: message.correlationData,
    };
  }

  /**
   * Drop every callback on a name's plain subscription. A shared group's is
   * released by the function its `subscribe()` returned.
   */
  public async unsubscribe(name: string): Promise<void> {
    await this.mqttClient.unsubscribe(this.prefix(name));
  }
}
