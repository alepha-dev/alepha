import {
  $env,
  $hook,
  $inject,
  Alepha,
  AlephaError,
  type Infer,
  z,
} from "alepha";
import type { IClientOptions, IPublishPacket, MqttClient } from "mqtt";

import {
  MqttClientProvider,
  type MqttPublishOptions,
  type MqttQoS,
} from "./MqttClientProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

const envSchema = z.object({
  MQTT_URL: z
    .text({
      description:
        "MQTT broker URL (`mqtt://`, `mqtts://`, `ws://`, `wss://`). Set, it selects the mqtt.js client; unset, the in-process memory broker.",
    })
    .optional(),
});

declare module "alepha" {
  interface Env extends Partial<Infer<typeof envSchema>> {}
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * MQTT client provider backed by the `mqtt` npm package (mqtt.js).
 *
 * Selected by `AlephaMqtt` when `MQTT_URL` is set on Node or Bun. MQTT 5 by
 * default; `protocolVersion: 4` in the options atom speaks MQTT 3.1.1.
 *
 * Resubscription after a reconnect is done here rather than by mqtt.js, so
 * every subscription keeps its Subscription Identifier and `connect()` can
 * wait for the SUBACKs before it resolves.
 *
 * @example
 * ```ts
 * // MQTT_URL=mqtts://broker.example.com:8883
 *
 * // Credentials, reconnection and a Last Will the broker publishes if this
 * // client dies without saying goodbye.
 * alepha.set(mqttOptions, {
 *   clientId: "tvm-042",
 *   protocolVersion: 5,
 *   keepalive: 60,
 *   lazy: false,
 *   reconnectPeriod: 5_000,
 *   username: "device",
 *   password: "s3cret",
 *   will: {
 *     topic: "station-1/tvm/42/connection",
 *     payload: JSON.stringify({ online: false }),
 *     qos: 1,
 *     retain: true,
 *   },
 *   // Anything else mqtt.js accepts (`ca`, `cert`, `key`...), merged last.
 *   connect: { rejectUnauthorized: true },
 * });
 * ```
 */
export class MqttJsClientProvider extends MqttClientProvider {
  protected readonly alepha = $inject(Alepha);
  protected readonly env = $env(envSchema);

  protected client: MqttClient | undefined;

  /**
   * The connect currently in flight, if any.
   *
   * Without it, two concurrent `publish()` calls on a lazy client each open
   * their own socket and one of the two clients is orphaned: still connected
   * to the broker, no longer reachable from here, never closed on stop.
   */
  protected connecting: Promise<void> | undefined;

  /**
   * The resubscription after the latest reconnect, awaited by `connect()`.
   */
  protected resubscribing: Promise<void> | undefined;

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
   * connect already in flight. After a reconnect it also waits for the
   * subscriptions to be acknowledged again.
   */
  public override async connect(): Promise<void> {
    if (this.client?.connected) {
      await this.resubscribing;
      return;
    }

    if (this.connecting) {
      return this.connecting;
    }

    // A client that exists but is not connected is reconnecting on its own
    // (mqtt.js `reconnectPeriod`). Opening a second socket here orphaned the
    // first one with every subscription still bound to it: messages arrived
    // twice and `disconnect()` ended only the new client, so the orphan kept
    // the process alive after stop.
    const reconnecting = this.client;
    this.connecting = (
      reconnecting ? this.awaitReconnect(reconnecting) : this.openConnection()
    ).finally(() => {
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
   * Drop the socket without a DISCONNECT, as a crash or a network cut would,
   * and resolve once mqtt.js has reconnected and every subscription is back.
   *
   * The broker publishes the Last Will. A test method: the contract suite
   * uses it on a real broker, as it uses the memory client's.
   */
  public async simulateDisconnect(): Promise<void> {
    const client = this.client;
    if (!client?.connected) {
      throw new AlephaError("MQTT client is not connected");
    }

    const reconnected = this.awaitReconnect(client);
    client.stream.destroy();
    await reconnected;
  }

  // -----------------------------------------------------------------------------------------------------------------

  protected override async sendPublish(
    topic: string,
    payload: string | Uint8Array,
    options: Required<MqttPublishOptions>,
  ): Promise<void> {
    const client = this.requireClient();
    await client.publishAsync(
      topic,
      typeof payload === "string" ? payload : Buffer.from(payload),
      { qos: options.qos, retain: options.retain },
    );
  }

  protected override async sendSubscribe(
    filter: string,
    qos: MqttQoS,
    id: number | undefined,
  ): Promise<void> {
    const client = this.requireClient();
    const granted = await client.subscribeAsync(filter, {
      qos,
      ...(id !== undefined
        ? { properties: { subscriptionIdentifier: id } }
        : {}),
    });

    // A refusal is a SUBACK, not an error: reason codes 128 and above.
    const refused = granted.find((it) => it.qos >= 128);
    if (refused) {
      throw new AlephaError(
        `MQTT broker refused the subscription to '${filter}' (reason code ${refused.qos})`,
      );
    }
  }

  protected override async sendUnsubscribe(filter: string): Promise<void> {
    // Also while disconnected: mqtt.js queues the UNSUBSCRIBE for the
    // reconnect.
    if (this.client) {
      await this.client.unsubscribeAsync(filter).catch(() => undefined);
    }
  }

  protected override applyWill(): void {
    if (this.client) {
      this.client.options.will = this.mqttWill();
    }
  }

  // -----------------------------------------------------------------------------------------------------------------

  /**
   * Build the mqtt.js client options.
   *
   * Override this when a value cannot be known at configuration time. This
   * is the same escape hatch `NodeRedisProvider.createClient()` provides.
   */
  protected connectOptions(): IClientOptions {
    const { clientId, keepalive, reconnectPeriod, username, password } =
      this.options;
    const will = this.mqttWill();

    return {
      clientId,
      keepalive,
      reconnectPeriod,
      protocolVersion: this.protocolVersion,
      // Ours, so each subscription keeps its identifier and `connect()` can
      // wait for the SUBACKs (see `onReconnect`).
      resubscribe: false,
      ...(will ? { will } : {}),
      ...this.credentials(username, password),
      // Last, so it can override anything above.
      ...(this.options.connect as IClientOptions | undefined),
    };
  }

  /**
   * The current will in mqtt.js's shape.
   */
  protected mqttWill(): IClientOptions["will"] {
    const will = this.currentWill();
    if (!will) {
      return undefined;
    }

    return {
      topic: will.topic,
      payload:
        typeof will.payload === "string"
          ? Buffer.from(will.payload, "utf8")
          : Buffer.from(will.payload),
      qos: will.qos ?? 0,
      retain: will.retain ?? false,
    };
  }

  /**
   * Resolve the credentials to hand mqtt.js.
   *
   * mqtt.js merges our options over the parsed URL and *then* runs
   * `parseAuthOptions`, which re-derives username/password from the URL's
   * userinfo, so `mqtt://alice:s3cret@host` silently beats an explicit
   * `username: "bob"`. Passing `auth: undefined` blanks the URL's userinfo
   * before that step runs, which is what makes the explicit option win.
   *
   * With no explicit username we return nothing at all, leaving URL
   * credentials to work.
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
   * The broker URL. `MqttActivation` only selects this provider when it is
   * set, but a hand substitution may not have.
   */
  protected url(): string {
    const url = this.env.MQTT_URL;
    if (typeof url !== "string" || url.trim() === "") {
      throw new AlephaError(
        "MqttJsClientProvider needs MQTT_URL (for example mqtt://localhost:1883)",
      );
    }

    return url;
  }

  /**
   * Open the socket and wire the client's event handlers.
   */
  protected async openConnection(): Promise<void> {
    const url = this.url();
    this.log.debug(`Connecting to ${url}...`);

    const { connectAsync } = await import("mqtt");

    const client = await connectAsync(url, this.connectOptions());

    client.on("error", (error) => {
      if (this.alepha.isStarted()) {
        this.log.error("MQTT client error", error);
      }
    });

    client.on("message", (topic, payload, packet) => {
      void this.dispatch(
        {
          topic,
          payload: new Uint8Array(payload),
          qos: packet.qos,
          retain: packet.retain,
        },
        this.subscriptionIds(packet),
      );
    });

    client.on("connect", () => {
      this.onReconnect();
    });

    this.client = client;
    this.log.info("MQTT connection OK");
  }

  /**
   * Restore the subscriptions after a reconnect. A broker keeping the
   * session (`clean: false` through `connect`) already has them, and a
   * second SUBSCRIBE with the same identifier only replaces them.
   */
  protected onReconnect(): void {
    if (this.subscriptions.size === 0) {
      return;
    }

    this.resubscribing = this.resubscribeAll().catch((error) => {
      this.log.error("MQTT resubscription failed", error);
    });
  }

  /**
   * The Subscription Identifiers a received PUBLISH carries: one number, or
   * an array when several of this client's subscriptions matched.
   */
  protected subscriptionIds(packet: IPublishPacket): number[] | undefined {
    const ids = packet.properties?.subscriptionIdentifier;
    if (ids === undefined) {
      return undefined;
    }

    return Array.isArray(ids) ? ids : [ids];
  }

  /**
   * Resolve when mqtt.js has reconnected the existing client and the
   * subscriptions are back, reject when it gives up (`end`) or reports an
   * error meanwhile.
   */
  protected async awaitReconnect(client: MqttClient): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        client.off("connect", onConnect);
        client.off("error", onError);
        client.off("end", onEnd);
      };
      const onConnect = () => {
        cleanup();
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onEnd = () => {
        cleanup();
        reject(new AlephaError("MQTT client ended while reconnecting"));
      };
      client.on("connect", onConnect);
      client.on("error", onError);
      client.on("end", onEnd);
    });

    // `onReconnect` ran first: it was registered before `onConnect`.
    await this.resubscribing;
  }

  protected requireClient(): MqttClient {
    if (!this.client) {
      throw new AlephaError("MQTT client is not connected");
    }

    return this.client;
  }
}
