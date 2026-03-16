import {
  $atom,
  $env,
  $hook,
  $inject,
  $use,
  Alepha,
  AlephaError,
  type Static,
  t,
} from "alepha";
import { $logger } from "alepha/logger";
import type { UnSubscribeFn } from "alepha/topic";
import type { MqttClient } from "mqtt";
import {
  MqttClientProvider,
  type MqttMessageCallback,
  type MqttPublishOptions,
  type MqttSubscribeOptions,
} from "./MqttClientProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

const envSchema = t.object({
  MQTT_BROKER_URL: t.text({
    default: "mqtt://localhost:1883",
    description: "MQTT broker connection URL",
  }),
});

declare module "alepha" {
  interface Env extends Partial<Static<typeof envSchema>> {}
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * MQTT client configuration atom.
 */
export const mqttOptions = $atom({
  name: "alepha.mqtt.options",
  schema: t.object({
    clientId: t.optional(
      t.text({
        description: "MQTT client identifier. Auto-generated if omitted.",
      }),
    ),
    keepalive: t.number({
      default: 60,
      description: "Keepalive interval in seconds.",
    }),
    lazy: t.boolean({
      default: false,
      description:
        "When true, the connection is deferred until the first publish or subscribe.",
    }),
  }),
  default: {
    keepalive: 60,
    lazy: false,
  },
});

export type MqttOptions = Static<typeof mqttOptions.schema>;

declare module "alepha" {
  interface State {
    [mqttOptions.key]: MqttOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * MQTT client provider backed by the `mqtt` npm package (mqtt.js).
 *
 * Wraps `mqtt.connectAsync` and exposes a lifecycle-managed client.
 *
 * @example
 * ```ts
 * // Set MQTT_BROKER_URL environment variable (default: mqtt://localhost:1883)
 * // MQTT_BROKER_URL=mqtt://broker.example.com:1883
 *
 * // Or configure programmatically
 * alepha.with({
 *   provide: MqttClientProvider,
 *   use: MqttJsClientProvider,
 * });
 * ```
 */
export class MqttJsClientProvider extends MqttClientProvider {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly env = $env(envSchema);
  protected readonly options = $use(mqttOptions);

  protected client: MqttClient | undefined;

  /**
   * Subscriptions map: pattern → set of callbacks.
   */
  protected subscriptions = new Map<string, Set<MqttMessageCallback>>();

  // -----------------------------------------------------------------------------------------------------------------

  protected readonly start = $hook({
    on: "start",
    handler: async () => {
      if (!this.options.lazy) {
        await this.connect();
      }
    },
  });

  protected readonly stop = $hook({
    on: "stop",
    handler: async () => {
      if (this.client) {
        await this.disconnect();
      }
    },
  });

  // -----------------------------------------------------------------------------------------------------------------

  public override get isConnected(): boolean {
    return this.client?.connected ?? false;
  }

  /**
   * Connect to the MQTT broker.
   */
  public override async connect(): Promise<void> {
    const url = this.env.MQTT_BROKER_URL;
    this.log.debug(`Connecting to ${url}...`);

    const { connectAsync } = await import("mqtt");

    this.client = await connectAsync(url, {
      clientId: this.options.clientId,
      keepalive: this.options.keepalive,
    });

    this.client.on("error", (error) => {
      if (this.alepha.isStarted()) {
        this.log.error("MQTT client error", error);
      }
    });

    this.client.on("message", (receivedTopic, payload) => {
      const message = payload.toString();

      for (const [pattern, callbacks] of this.subscriptions.entries()) {
        if (this.topicMatches(pattern, receivedTopic)) {
          for (const callback of callbacks) {
            Promise.resolve(callback(receivedTopic, message)).catch((error) => {
              this.log.error(
                `Error in MQTT message handler for topic '${receivedTopic}'`,
                error,
              );
            });
          }
        }
      }
    });

    this.log.info("MQTT connection OK");
  }

  /**
   * Disconnect from the MQTT broker.
   */
  public override async disconnect(): Promise<void> {
    if (!this.client) {
      return;
    }

    this.log.debug("Disconnecting...");
    await this.client.endAsync();
    this.client = undefined;
    this.subscriptions.clear();
    this.log.info("MQTT connection closed");
  }

  /**
   * Publish a message to an MQTT topic.
   */
  public override async publish(
    topic: string,
    message: string,
    options?: MqttPublishOptions,
  ): Promise<void> {
    await this.ensureConnected();
    await this.client!.publishAsync(topic, message, {
      qos: options?.qos,
      retain: options?.retain,
    });
  }

  /**
   * Subscribe to an MQTT topic pattern.
   *
   * Supports MQTT wildcards: `+` for a single level, `#` for multiple levels.
   * The callback receives the actual received topic as the first argument.
   */
  public override async subscribe(
    topic: string,
    callback: MqttMessageCallback,
    options?: MqttSubscribeOptions,
  ): Promise<UnSubscribeFn> {
    await this.ensureConnected();

    if (!this.subscriptions.has(topic)) {
      this.subscriptions.set(topic, new Set());
      await this.client!.subscribeAsync(topic, { qos: options?.qos ?? 0 });
    }

    this.subscriptions.get(topic)!.add(callback);

    return async () => {
      await this.unsubscribeCallback(topic, callback);
    };
  }

  /**
   * Unsubscribe all callbacks from an MQTT topic pattern.
   */
  public override async unsubscribe(topic: string): Promise<void> {
    if (!this.subscriptions.has(topic)) {
      return;
    }

    this.subscriptions.delete(topic);

    if (this.client?.connected) {
      await this.client.unsubscribeAsync(topic);
    }
  }

  // -----------------------------------------------------------------------------------------------------------------

  /**
   * Ensure the client is connected, connecting lazily if needed.
   */
  protected async ensureConnected(): Promise<void> {
    if (!this.client || !this.client.connected) {
      if (!this.options.lazy) {
        throw new AlephaError("MQTT client is not connected");
      }

      await this.connect();
    }
  }

  /**
   * Remove a single callback from a topic subscription.
   * Unsubscribes from the broker when no callbacks remain.
   */
  protected async unsubscribeCallback(
    topic: string,
    callback: MqttMessageCallback,
  ): Promise<void> {
    const callbacks = this.subscriptions.get(topic);
    if (!callbacks) {
      return;
    }

    callbacks.delete(callback);

    if (callbacks.size === 0) {
      await this.unsubscribe(topic);
    }
  }

  /**
   * Test whether a received MQTT topic matches a subscription pattern.
   *
   * Supports the two MQTT wildcard characters:
   * - `+` matches exactly one topic level
   * - `#` matches any number of remaining levels (must be the last segment)
   */
  protected topicMatches(pattern: string, topic: string): boolean {
    if (pattern === topic) {
      return true;
    }

    const patternParts = pattern.split("/");
    const topicParts = topic.split("/");

    for (let i = 0; i < patternParts.length; i++) {
      const p = patternParts[i];

      if (p === "#") {
        // Multi-level wildcard — matches everything remaining.
        return true;
      }

      if (i >= topicParts.length) {
        return false;
      }

      if (p !== "+" && p !== topicParts[i]) {
        return false;
      }
    }

    return patternParts.length === topicParts.length;
  }
}
