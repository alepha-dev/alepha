import { $inject, $store, AlephaError } from "alepha";
import { $logger } from "alepha/logger";

import { mqttOptions } from "../mqttOptions.ts";
import { MqttTopicMatcher } from "../services/MqttTopicMatcher.ts";

/**
 * MQTT 5 client provider.
 *
 * Low-level MQTT client for publish/subscribe messaging, analogous to
 * `RedisProvider`: the transport that `@alepha/mqtt/topic` builds on.
 * Payloads are bytes (`string | Uint8Array` out, `Uint8Array` in), so JSON,
 * protobuf and Sparkplug all ride on it.
 *
 * **Dispatch by Subscription Identifier.** Every broker subscription carries
 * its own MQTT 5 Subscription Identifier, and a received message reaches only
 * the subscriptions whose identifiers it carries. Matching by filter instead
 * would hand a message received for `$share/g/a/+` to a plain `a/+` held by
 * the same client too, and the copy received for `a/+` to the group's
 * callbacks, so a group handler would run twice, and run on an instance the
 * broker did not pick. Under MQTT 3.1.1 (`protocolVersion: 4`) there are no
 * identifiers: the client falls back to filter matching and refuses
 * `$share/`.
 *
 * Subclasses own the wire (`sendPublish`, `sendSubscribe`, `sendUnsubscribe`,
 * the connection); this class owns the subscription registry, so the memory
 * client and mqtt.js cannot disagree about it.
 */
export abstract class MqttClientProvider {
  protected readonly log = $logger();
  protected readonly options = $store(mqttOptions);
  protected readonly matcher = $inject(MqttTopicMatcher);

  /**
   * Broker subscriptions by filter, `$share/<group>/` prefix included.
   */
  protected readonly subscriptions = new Map<string, MqttSubscription>();

  /**
   * Next MQTT 5 Subscription Identifier (1 to 268,435,455).
   */
  protected nextSubscriptionId = 1;

  /**
   * The will set by `setWill()`, which wins over the atom's once set.
   */
  protected willOverride: { will: MqttWill | undefined } | undefined;

  /**
   * Connect to the MQTT broker.
   *
   * Calling this while a connection is already open, or while another
   * `connect()` is still in flight, resolves against that connection instead
   * of opening a second one.
   */
  public abstract connect(): Promise<void>;

  /**
   * Disconnect from the MQTT broker, gracefully: the broker does not publish
   * the Last Will. Every subscription is dropped.
   */
  public abstract disconnect(): Promise<void>;

  /**
   * Whether the client is currently connected.
   */
  public abstract get isConnected(): boolean;

  /**
   * The wire half of `publish()`, on a connected client.
   */
  protected abstract sendPublish(
    topic: string,
    payload: string | Uint8Array,
    options: Required<MqttPublishOptions>,
  ): Promise<void>;

  /**
   * The wire half of a SUBSCRIBE: resolves on the SUBACK. `id` is undefined
   * under MQTT 3.1.1.
   */
  protected abstract sendSubscribe(
    filter: string,
    qos: MqttQoS,
    id: number | undefined,
  ): Promise<void>;

  /**
   * The wire half of an UNSUBSCRIBE.
   */
  protected abstract sendUnsubscribe(filter: string): Promise<void>;

  /**
   * Apply the current will to the transport, for the next connect or
   * reconnect.
   */
  protected abstract applyWill(): void;

  // -----------------------------------------------------------------------------------------------------------------

  /**
   * The MQTT protocol version in use: 5 unless configured otherwise.
   */
  public get protocolVersion(): 4 | 5 {
    return this.options.protocolVersion;
  }

  /**
   * Publish a message to an MQTT topic.
   *
   * With `qos` 1 or 2 the returned promise resolves only once the broker has
   * acknowledged the message. With `qos` 0 (the default) it resolves as soon
   * as the packet has been written. A retained empty payload clears the
   * topic's retained message.
   */
  public async publish(
    topic: string,
    payload: string | Uint8Array,
    options: MqttPublishOptions = {},
  ): Promise<void> {
    this.matcher.assertPublishable(topic);
    await this.connect();
    await this.sendPublish(topic, payload, {
      qos: options.qos ?? 0,
      retain: options.retain ?? false,
    });
  }

  /**
   * Subscribe to an MQTT topic filter.
   *
   * Supports `+` (one level), `#` (the rest) and, under MQTT 5, shared
   * subscriptions (`$share/<group>/<filter>`). The returned promise resolves
   * once the broker has acknowledged the subscription, so a publish issued
   * afterwards cannot be missed. It resolves to a function removing this one
   * callback; the broker subscription goes when its last callback does.
   *
   * Callbacks on one filter share one broker subscription: for a shared
   * group, the copy the broker hands this client reaches every one of them.
   */
  public async subscribe(
    filter: string,
    callback: MqttMessageCallback,
    options: MqttSubscribeOptions = {},
  ): Promise<() => Promise<void>> {
    const { group } = this.matcher.parse(filter);
    if (group !== undefined && this.protocolVersion !== 5) {
      throw new AlephaError(
        `Shared subscription '${filter}' needs MQTT 5: under protocol 4 there are no subscription identifiers to keep its copies apart`,
      );
    }

    await this.connect();
    const qos = options.qos ?? 0;

    let subscription = this.subscriptions.get(filter);

    if (!subscription) {
      const id = this.protocolVersion === 5 ? this.allocateId() : undefined;
      subscription = {
        id,
        callbacks: new Set(),
        qos,
        ready: this.sendSubscribe(filter, qos, id),
      };
      this.subscriptions.set(filter, subscription);
    } else if (qos > subscription.qos) {
      // Re-SUBSCRIBE on an existing filter replaces its QoS. Without this the
      // first subscriber silently decides the delivery guarantee for every
      // later one.
      const current = subscription;
      current.qos = qos;
      // Sequencing, not a pipeline: the chain's value is never read, only
      // awaited, so there is nothing for this callback to hand on.
      // oxlint-disable-next-line promise/always-return
      current.ready = current.ready.then(async () => {
        await this.sendSubscribe(filter, qos, current.id);
      });
    }

    // Registered BEFORE awaiting the SUBACK: a retained message may follow
    // the SUBACK immediately, and a callback added afterwards would miss it.
    subscription.callbacks.add(callback);

    try {
      await subscription.ready;
    } catch (error) {
      // A refused SUBSCRIBE (ACL, invalid filter) must not leave a poisoned
      // entry that every later subscribe() to the same filter awaits.
      subscription.callbacks.delete(callback);
      if (
        this.subscriptions.get(filter) === subscription &&
        subscription.callbacks.size === 0
      ) {
        this.subscriptions.delete(filter);
      }
      throw error;
    }

    return async () => {
      await this.unsubscribeCallback(filter, callback);
    };
  }

  /**
   * Unsubscribe every callback registered on an MQTT topic filter.
   */
  public async unsubscribe(filter: string): Promise<void> {
    if (!this.subscriptions.has(filter)) {
      return;
    }

    this.subscriptions.delete(filter);
    await this.sendUnsubscribe(filter);
  }

  /**
   * Replace the Last Will for the next connect or reconnect, or clear it with
   * `undefined`.
   *
   * The broker reads the will from the CONNECT packet, so the open
   * connection keeps the will it connected with. Set it before `connect()`
   * (or the `start` hook) for the first connection; set it again whenever a
   * reconnect must carry a new value, such as Sparkplug's NDEATH with its
   * `bdSeq`. Once called, it wins over the `will` of the options atom.
   */
  public setWill(will: MqttWill | undefined): void {
    this.willOverride = { will };
    this.applyWill();
  }

  // -----------------------------------------------------------------------------------------------------------------

  /**
   * The will the next CONNECT carries.
   */
  protected currentWill(): MqttWill | undefined {
    if (this.willOverride) {
      return this.willOverride.will;
    }

    return this.options.will;
  }

  /**
   * Hand a received message to the callbacks it belongs to.
   *
   * With identifiers (MQTT 5), only the subscriptions they name. Without
   * (MQTT 3.1.1, or a broker that does not send them), every non-shared
   * subscription whose filter matches. Callbacks run in order; one that
   * throws is logged and does not stop the others.
   */
  protected async dispatch(
    message: MqttMessage,
    ids: number[] | undefined,
  ): Promise<void> {
    const targets: MqttSubscription[] = [];

    if (ids?.length) {
      for (const subscription of this.subscriptions.values()) {
        if (subscription.id !== undefined && ids.includes(subscription.id)) {
          targets.push(subscription);
        }
      }
    } else {
      for (const [filter, subscription] of this.subscriptions.entries()) {
        if (
          this.matcher.parse(filter).group === undefined &&
          this.matcher.matches(filter, message.topic)
        ) {
          targets.push(subscription);
        }
      }
    }

    for (const subscription of targets) {
      // A snapshot: a callback subscribing another one must not see it run
      // for the message that made it.
      for (const callback of Array.from(subscription.callbacks)) {
        try {
          await callback(message);
        } catch (error) {
          this.log.error(
            `Error in MQTT message handler for topic '${message.topic}'`,
            error,
          );
        }
      }
    }
  }

  /**
   * Send a SUBSCRIBE again for every subscription, after a reconnect that
   * lost the session.
   */
  protected async resubscribeAll(): Promise<void> {
    await Promise.all(
      [...this.subscriptions.entries()].map(([filter, subscription]) =>
        this.sendSubscribe(filter, subscription.qos, subscription.id),
      ),
    );
  }

  /**
   * Remove a single callback from a subscription, and the broker
   * subscription with its last callback.
   */
  protected async unsubscribeCallback(
    filter: string,
    callback: MqttMessageCallback,
  ): Promise<void> {
    const subscription = this.subscriptions.get(filter);
    if (!subscription) {
      return;
    }

    subscription.callbacks.delete(callback);

    if (subscription.callbacks.size === 0) {
      await this.unsubscribe(filter);
    }
  }

  protected allocateId(): number {
    const id = this.nextSubscriptionId;
    this.nextSubscriptionId =
      this.nextSubscriptionId >= 268_435_455 ? 1 : this.nextSubscriptionId + 1;
    return id;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * One filter this client is subscribed to, and everyone listening on it.
 */
export interface MqttSubscription {
  /**
   * Its MQTT 5 Subscription Identifier; undefined under MQTT 3.1.1.
   */
  id: number | undefined;

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

export interface MqttPublishOptions {
  qos?: MqttQoS;
  retain?: boolean;
}

export interface MqttSubscribeOptions {
  qos?: MqttQoS;
}

/**
 * A Last Will and Testament: what the broker publishes when this client
 * disconnects without saying goodbye.
 */
export interface MqttWill {
  topic: string;
  payload: string | Uint8Array;
  qos?: MqttQoS;
  retain?: boolean;
}

/**
 * A message received from the broker.
 */
export interface MqttMessage {
  /**
   * The topic it was published to, which is what makes wildcard filters
   * usable.
   */
  topic: string;

  payload: Uint8Array;

  qos: MqttQoS;

  /**
   * True for a retained message delivered on subscribe.
   */
  retain: boolean;
}

/**
 * MQTT Quality of Service level.
 *
 * - `0`: at most once (fire and forget)
 * - `1`: at least once (acknowledged delivery)
 * - `2`: exactly once (four-step handshake)
 */
export type MqttQoS = 0 | 1 | 2;

export type MqttMessageCallback = (
  message: MqttMessage,
) => void | Promise<void>;
