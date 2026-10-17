import { $hook, $inject, AlephaError } from "alepha";

import {
  MemoryMqttBroker,
  type MemoryMqttSession,
} from "../services/MemoryMqttBroker.ts";
import {
  MqttClientProvider,
  type MqttMessage,
  type MqttQoS,
  type MqttSendOptions,
  type MqttWill,
} from "./MqttClientProvider.ts";

/**
 * MQTT client on an in-process broker: no socket, no timing.
 *
 * Selected by `AlephaMqtt` when `MQTT_URL` is unset, and in the browser and
 * on workerd. It is what the topic provider, `@alepha/sparkplug` and apps
 * test on. Its broker is a `MemoryMqttBroker`, one per container unless
 * shared with `useBroker()`:
 *
 * ```ts
 * const device = Alepha.create().with(AlephaMqtt);
 * const app = Alepha.create().with(AlephaMqtt);
 * app
 *   .inject(MemoryMqttClientProvider)
 *   .useBroker(device.inject(MemoryMqttBroker));
 * ```
 *
 * `publish()` resolves once every subscriber's callbacks have run.
 */
export class MemoryMqttClientProvider
  extends MqttClientProvider
  implements MemoryMqttSession
{
  protected broker = $inject(MemoryMqttBroker);

  protected connected = false;

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

  /**
   * Use another broker, typically another container's, so two containers
   * talk to each other. Before the client connects.
   */
  public useBroker(broker: MemoryMqttBroker): this {
    if (this.connected) {
      throw new AlephaError(
        "useBroker() must be called before the MQTT client connects",
      );
    }

    this.broker = broker;
    return this;
  }

  public override get isConnected(): boolean {
    return this.connected;
  }

  public override async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    this.broker.connect(this);
    this.connected = true;

    // A reconnect after `simulateDisconnect()`: the broker forgot the
    // session, as mqtt.js's own reconnect would find it.
    if (this.subscriptions.size) {
      await this.resubscribeAll();
    }
  }

  public override async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }

    this.broker.disconnect(this);
    this.connected = false;
    this.subscriptions.clear();
  }

  /**
   * Drop the connection as a network cut would: the broker publishes the
   * will. Then reconnect and restore every subscription, as mqtt.js does,
   * unless `reconnectPeriod` is 0.
   *
   * A test method, also on `MqttJsClientProvider`, which is what lets the
   * contract suite run the same case on both.
   */
  public async simulateDisconnect(): Promise<void> {
    if (!this.connected) {
      throw new AlephaError("MQTT client is not connected");
    }

    this.connected = false;
    await this.broker.drop(this);

    if (this.options.reconnectPeriod > 0) {
      await this.connect();
    }
  }

  // -----------------------------------------------------------------------------------------------------------------

  public async deliver(
    message: MqttMessage,
    ids: number[] | undefined,
  ): Promise<void> {
    await this.dispatch(message, ids);
  }

  public will(): MqttWill | undefined {
    return this.currentWill();
  }

  // -----------------------------------------------------------------------------------------------------------------

  protected override async sendPublish(
    topic: string,
    payload: string | Uint8Array,
    options: MqttSendOptions,
  ): Promise<void> {
    await this.broker.publish(
      topic,
      typeof payload === "string" ? new TextEncoder().encode(payload) : payload,
      options,
    );
  }

  protected override async sendSubscribe(
    filter: string,
    qos: MqttQoS,
    id: number | undefined,
  ): Promise<void> {
    // One tick first: `subscribe()` registers its callback right after this
    // call returns, and a retained message delivered synchronously would
    // reach no one.
    await Promise.resolve();
    await this.broker.subscribe(this, filter, qos, id);
  }

  protected override async sendUnsubscribe(filter: string): Promise<void> {
    this.broker.unsubscribe(this, filter);
  }

  protected override applyWill(): void {
    // The broker reads `will()` when the session drops.
  }
}
