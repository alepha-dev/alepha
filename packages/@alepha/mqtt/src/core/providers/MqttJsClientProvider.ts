import {
  $atom,
  $env,
  $hook,
  $inject,
  $store,
  Alepha,
  AlephaError,
  type Infer,
  z,
} from "alepha";
import { $logger } from "alepha/logger";
import type { IClientOptions, MqttClient } from "mqtt";

import {
  MqttClientProvider,
  type MqttMessageCallback,
  type MqttPublishOptions,
  type MqttQoS,
  type MqttSubscribeOptions,
} from "./MqttClientProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

const envSchema = z.object({
  MQTT_BROKER_URL: z.text({
    default: "mqtt://localhost:1883",
    description: "MQTT broker connection URL",
  }),
});

declare module "alepha" {
  interface Env extends Partial<Infer<typeof envSchema>> {}
}

// ---------------------------------------------------------------------------------------------------------------------

const qosSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);

/**
 * MQTT client configuration atom.
 *
 * `serverOnly` because the schema carries a plaintext broker `password`: this
 * value must never enter the SSR hydration payload, and DevTools must not
 * print it in `/metadata`.
 */
export const mqttOptions = $atom({
  name: "alepha.mqtt.options",
  schema: z.object({
    clientId: z
      .text({
        description: "MQTT client identifier. Auto-generated if omitted.",
      })
      .optional(),
    keepalive: z
      .number()
      .describe("Keepalive interval in seconds.")
      .default(60),
    lazy: z
      .boolean()
      .describe(
        "When true, the connection is deferred until the first publish or subscribe.",
      )
      .default(false),
    username: z
      .string()
      .describe(
        "Username for broker authentication. Takes precedence over credentials embedded in MQTT_BROKER_URL.",
      )
      .optional(),
    password: z
      .string()
      .describe("Password for broker authentication.")
      .optional(),
    reconnectPeriod: z
      .number()
      .describe(
        "Milliseconds between reconnection attempts. 0 disables automatic reconnection.",
      )
      .default(1000),
    will: z
      .object({
        topic: z.string().describe("Topic the broker publishes the will to."),
        payload: z.string().describe("Message body the broker publishes."),
        qos: qosSchema.describe("QoS used for the will message.").default(0),
        retain: z
          .boolean()
          .describe("Whether the will message is retained.")
          .default(false),
      })
      .describe(
        "Last Will and Testament — published BY THE BROKER when this client disconnects ungracefully.",
      )
      .optional(),
    connect: z
      .json()
      .describe(
        "Escape hatch: extra mqtt.js `IClientOptions` merged last, overriding everything above.",
      )
      .optional(),
  }),
  default: {
    keepalive: 60,
    lazy: false,
    reconnectPeriod: 1000,
  },
  serverOnly: true,
});

export type MqttOptions = Infer<typeof mqttOptions.schema>;

declare module "alepha" {
  interface State {
    [mqttOptions.key]: MqttOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * One topic filter this client is subscribed to, and everyone listening on it.
 */
interface MqttSubscription {
  callbacks: Set<MqttMessageCallback>;

  /**
   * Resolves once the broker has ACKed the SUBSCRIBE.
   *
   * Held so that a second caller joining an existing filter waits for the same
   * ACK instead of returning early and missing the messages it was about to
   * trigger.
   */
  ready: Promise<void>;

  /**
   * The QoS the filter is currently subscribed at.
   */
  qos: MqttQoS;
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
 *
 * @example
 * ```ts
 * // Credentials, reconnection and a Last Will the broker publishes if this
 * // client dies without saying goodbye.
 * alepha.set(mqttOptions, {
 *   clientId: "tvm-042",
 *   keepalive: 60,
 *   lazy: false,
 *   reconnectPeriod: 5_000,
 *   username: "device",
 *   password: "s3cret",
 *   will: {
 *     topic: "station-1/tvm/42/connection",
 *     payload: JSON.stringify({ ERROR_COMMUNICATION: 1 }),
 *     qos: 1,
 *     retain: true,
 *   },
 *   // Anything else mqtt.js accepts, merged last.
 *   connect: { protocolVersion: 5 },
 * });
 * ```
 */
export class MqttJsClientProvider extends MqttClientProvider {
  protected readonly log = $logger();
  protected readonly alepha = $inject(Alepha);
  protected readonly env = $env(envSchema);
  protected readonly options = $store(mqttOptions);

  protected client: MqttClient | undefined;

  /**
   * The connect currently in flight, if any.
   *
   * Without it, two concurrent `publish()` calls on a lazy client each open
   * their own socket and one of the two clients is orphaned — still connected
   * to the broker, no longer reachable from here, never closed on stop.
   */
  protected connecting: Promise<void> | undefined;

  /**
   * Subscriptions by topic filter.
   */
  protected subscriptions = new Map<string, MqttSubscription>();

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
      await this.disconnect();
    },
  });

  // -----------------------------------------------------------------------------------------------------------------

  public override get isConnected(): boolean {
    return this.client?.connected ?? false;
  }

  /**
   * Connect to the MQTT broker.
   *
   * Idempotent: an open connection is reused and a concurrent call joins the
   * connect already in flight.
   */
  public override async connect(): Promise<void> {
    if (this.client?.connected) {
      return;
    }

    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = this.openConnection().finally(() => {
      this.connecting = undefined;
    });

    return this.connecting;
  }

  /**
   * Disconnect from the MQTT broker.
   */
  public override async disconnect(): Promise<void> {
    // A connect racing with stop would otherwise leave a live socket behind
    // that nothing owns.
    if (this.connecting) {
      await this.connecting.catch(() => undefined);
    }

    if (!this.client) {
      return;
    }

    this.log.debug("Disconnecting...");
    const client = this.client;
    this.client = undefined;
    this.subscriptions.clear();
    await client.endAsync();
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
    const client = await this.ensureConnected();
    await client.publishAsync(topic, message, {
      qos: options?.qos ?? 0,
      retain: options?.retain ?? false,
    });
  }

  /**
   * Subscribe to an MQTT topic filter.
   *
   * Supports MQTT wildcards: `+` for a single level, `#` for the rest of the
   * levels. The callback receives the actual received topic as its first
   * argument, so a wildcard subscriber can tell messages apart.
   */
  public override async subscribe(
    topic: string,
    callback: MqttMessageCallback,
    options?: MqttSubscribeOptions,
  ): Promise<() => Promise<void>> {
    const client = await this.ensureConnected();
    const qos = options?.qos ?? 0;

    let subscription = this.subscriptions.get(topic);

    if (!subscription) {
      subscription = {
        callbacks: new Set(),
        qos,
        ready: client.subscribeAsync(topic, { qos }).then(() => undefined),
      };
      this.subscriptions.set(topic, subscription);
    } else if (qos > subscription.qos) {
      // Re-SUBSCRIBE on an existing filter replaces its QoS. Without this the
      // first subscriber silently decides the delivery guarantee for every
      // later one.
      const previous = subscription.ready;
      subscription.qos = qos;
      subscription.ready = previous.then(async () => {
        await client.subscribeAsync(topic, { qos });
      });
    }

    subscription.callbacks.add(callback);

    // Awaited AFTER registering the callback: the SUBACK may be followed
    // immediately by a retained message, and a callback added afterwards
    // would miss it.
    await subscription.ready;

    return async () => {
      await this.unsubscribeCallback(topic, callback);
    };
  }

  /**
   * Unsubscribe every callback registered on an MQTT topic filter.
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
   * Build the mqtt.js client options.
   *
   * Override this when a value cannot be known at configuration time — a Last
   * Will topic derived from a device identity resolved at startup, say. This
   * is the same escape hatch `NodeRedisProvider.createClient()` provides.
   */
  protected connectOptions(): IClientOptions {
    const { clientId, keepalive, reconnectPeriod, username, password, will } =
      this.options;

    return {
      clientId,
      keepalive,
      reconnectPeriod,
      ...(will ? { will } : {}),
      ...this.credentials(username, password),
      // Last, so it can override anything above.
      ...(this.options.connect as IClientOptions | undefined),
    };
  }

  /**
   * Resolve the credentials to hand mqtt.js.
   *
   * mqtt.js merges our options over the parsed URL and *then* runs
   * `parseAuthOptions`, which re-derives username/password from the URL's
   * userinfo — so `mqtt://alice:s3cret@host` silently beats an explicit
   * `username: "bob"`. Passing `auth: undefined` blanks the URL's userinfo
   * before that step runs, which is what makes the explicit option win.
   *
   * Building an `auth` string instead would not work: `parseAuthOptions`
   * splits on `/^(.+):(.+)$/`, and the greedy first group mangles any password
   * containing a colon.
   *
   * With no explicit username we return nothing at all, leaving URL
   * credentials to work exactly as before.
   */
  protected credentials(
    username: string | undefined,
    password: string | undefined,
  ): IClientOptions {
    if (username === undefined) {
      return {};
    }

    return { username, password, auth: undefined };
  }

  /**
   * Open the socket and wire the client's event handlers.
   */
  protected async openConnection(): Promise<void> {
    const url = String(this.env.MQTT_BROKER_URL);
    this.log.debug(`Connecting to ${url}...`);

    const { connectAsync } = await import("mqtt");

    const client = await connectAsync(url, this.connectOptions());

    client.on("error", (error) => {
      if (this.alepha.isStarted()) {
        this.log.error("MQTT client error", error);
      }
    });

    client.on("message", (receivedTopic, payload) => {
      this.dispatch(receivedTopic, payload.toString());
    });

    this.client = client;
    this.log.info("MQTT connection OK");
  }

  /**
   * Fan a received message out to every subscription whose filter matches.
   *
   * Note: a broker MAY deliver one copy per matching subscription, so a client
   * holding two overlapping filters (`a/b` and `a/+`) sees the message twice
   * and dispatches to both filters each time. mqtt.js does not report which
   * subscription matched, so this cannot be told apart here — do not register
   * overlapping filters on a single client.
   */
  protected dispatch(receivedTopic: string, message: string): void {
    for (const [pattern, subscription] of this.subscriptions.entries()) {
      if (!this.topicMatches(pattern, receivedTopic)) {
        continue;
      }

      for (const callback of subscription.callbacks) {
        Promise.resolve(callback(receivedTopic, message)).catch((error) => {
          this.log.error(
            `Error in MQTT message handler for topic '${receivedTopic}'`,
            error,
          );
        });
      }
    }
  }

  /**
   * Return a connected client, connecting on demand.
   *
   * `lazy` decides whether the connection is opened at start, not whether it
   * is allowed to be opened at all — refusing to connect here only ever
   * produced a startup-ordering race between this provider and whoever
   * publishes first.
   */
  protected async ensureConnected(): Promise<MqttClient> {
    await this.connect();

    if (!this.client) {
      throw new AlephaError("MQTT client is not connected");
    }

    return this.client;
  }

  /**
   * Remove a single callback from a topic subscription.
   * Unsubscribes from the broker when no callbacks remain.
   */
  protected async unsubscribeCallback(
    topic: string,
    callback: MqttMessageCallback,
  ): Promise<void> {
    const subscription = this.subscriptions.get(topic);
    if (!subscription) {
      return;
    }

    subscription.callbacks.delete(callback);

    if (subscription.callbacks.size === 0) {
      await this.unsubscribe(topic);
    }
  }

  /**
   * Test whether a received MQTT topic matches a subscription filter.
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
