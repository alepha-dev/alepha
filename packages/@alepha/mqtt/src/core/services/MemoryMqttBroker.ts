import { $inject } from "alepha";

import type {
  MqttMessage,
  MqttQoS,
  MqttWill,
} from "../providers/MqttClientProvider.ts";
import { MqttTopicMatcher } from "./MqttTopicMatcher.ts";

/**
 * An in-process MQTT broker, for `MemoryMqttClientProvider`.
 *
 * Holds what a broker holds: the connected sessions, their subscriptions,
 * the retained messages and each session's will. It lives apart from the
 * client so two containers can share one in a spec (a device and an app, a
 * Sparkplug node and its host): `useBroker()` on the second container's
 * client hands it the first one's.
 *
 * Semantics it keeps, because the contract suite checks them against
 * Mosquitto:
 *
 * - `+`/`#` matching, and no wildcard-led filter sees a `$` topic.
 * - A retained message is stored per topic, replaced by the next one and
 *   cleared by an empty payload; it is sent on a plain SUBSCRIBE, never on a
 *   shared one.
 * - A message reaches each session once per subscription identifier it
 *   matches: the plain subscriptions of a session in one copy carrying all
 *   their identifiers, each shared group in a copy of its own, to one member
 *   of the group, round robin.
 * - The delivered QoS is the lower of the published and the subscribed one.
 * - A dropped session (not a graceful disconnect) has its will published.
 *
 * `publish()` resolves once every subscriber's callbacks have run, which is
 * what makes specs on it deterministic.
 */
export class MemoryMqttBroker {
  protected readonly matcher = $inject(MqttTopicMatcher);

  protected readonly sessions = new Map<
    MemoryMqttSession,
    Map<string, MemoryMqttBrokerSubscription>
  >();

  /**
   * Each session's will, read at connect like a CONNECT packet's.
   */
  protected readonly wills = new Map<MemoryMqttSession, MqttWill>();

  protected readonly retained = new Map<
    string,
    { payload: Uint8Array; qos: MqttQoS }
  >();

  /**
   * Round-robin position per shared group and filter.
   */
  protected readonly cursors = new Map<string, number>();

  /**
   * Open a session. Its subscriptions start empty, like a clean start, and
   * its will is the one it has now: a later `setWill()` applies to the next
   * connection, as on a real broker.
   */
  public connect(session: MemoryMqttSession): void {
    this.sessions.set(session, new Map());
    const will = session.will();
    if (will) {
      this.wills.set(session, { ...will });
    } else {
      this.wills.delete(session);
    }
  }

  /**
   * Close a session gracefully: no will.
   */
  public disconnect(session: MemoryMqttSession): void {
    this.sessions.delete(session);
    this.wills.delete(session);
  }

  /**
   * Close a session as a network cut would: its will is published.
   */
  public async drop(session: MemoryMqttSession): Promise<void> {
    if (!this.sessions.delete(session)) {
      return;
    }

    const will = this.wills.get(session);
    this.wills.delete(session);
    if (will) {
      await this.publish(will.topic, this.bytes(will.payload), {
        qos: will.qos ?? 0,
        retain: will.retain ?? false,
      });
    }
  }

  /**
   * Add or replace a subscription of a session, then send it the retained
   * messages its filter matches (none for a shared subscription).
   */
  public async subscribe(
    session: MemoryMqttSession,
    filter: string,
    qos: MqttQoS,
    id: number | undefined,
  ): Promise<void> {
    const subscriptions = this.sessions.get(session);
    if (!subscriptions) {
      return;
    }

    const parsed = this.matcher.parse(filter);
    subscriptions.set(filter, { filter, qos, id, group: parsed.group });

    if (parsed.group !== undefined) {
      return;
    }

    for (const [topic, message] of this.retained.entries()) {
      if (this.matcher.matches(filter, topic)) {
        await session.deliver(
          {
            topic,
            payload: new Uint8Array(message.payload),
            qos: this.minQos(message.qos, qos),
            retain: true,
          },
          id === undefined ? undefined : [id],
        );
      }
    }
  }

  public unsubscribe(session: MemoryMqttSession, filter: string): void {
    this.sessions.get(session)?.delete(filter);
  }

  /**
   * Route a message to every matching subscription, and store it when
   * retained.
   */
  public async publish(
    topic: string,
    payload: Uint8Array,
    options: { qos: MqttQoS; retain: boolean },
  ): Promise<void> {
    if (options.retain) {
      if (payload.length === 0) {
        this.retained.delete(topic);
      } else {
        this.retained.set(topic, {
          payload: new Uint8Array(payload),
          qos: options.qos,
        });
      }
    }

    const groups = new Map<
      string,
      Array<{
        session: MemoryMqttSession;
        subscription: MemoryMqttBrokerSubscription;
      }>
    >();

    // A snapshot: a session a callback opens does not get this message.
    for (const [session, subscriptions] of Array.from(this.sessions)) {
      const ids: number[] = [];
      let qos: MqttQoS | undefined;

      for (const subscription of subscriptions.values()) {
        if (!this.matcher.matches(subscription.filter, topic)) {
          continue;
        }

        if (subscription.group !== undefined) {
          const key = `${subscription.group}\n${this.matcher.parse(subscription.filter).filter}`;
          const members = groups.get(key) ?? [];
          members.push({ session, subscription });
          groups.set(key, members);
          continue;
        }

        if (subscription.id !== undefined) {
          ids.push(subscription.id);
        }
        qos =
          qos === undefined
            ? subscription.qos
            : (Math.max(qos, subscription.qos) as MqttQoS);
      }

      if (qos !== undefined) {
        await session.deliver(
          {
            topic,
            payload: new Uint8Array(payload),
            qos: this.minQos(options.qos, qos),
            retain: false,
          },
          ids.length ? ids : undefined,
        );
      }
    }

    for (const [key, members] of groups.entries()) {
      const cursor = this.cursors.get(key) ?? 0;
      this.cursors.set(key, cursor + 1);
      const { session, subscription } = members[cursor % members.length];
      await session.deliver(
        {
          topic,
          payload: new Uint8Array(payload),
          qos: this.minQos(options.qos, subscription.qos),
          retain: false,
        },
        subscription.id === undefined ? undefined : [subscription.id],
      );
    }
  }

  /**
   * The retained message of a topic, for assertions.
   */
  public retainedMessage(topic: string): Uint8Array | undefined {
    return this.retained.get(topic)?.payload;
  }

  /**
   * How many sessions are open, for assertions.
   */
  public get sessionCount(): number {
    return this.sessions.size;
  }

  protected bytes(payload: string | Uint8Array): Uint8Array {
    return typeof payload === "string"
      ? new TextEncoder().encode(payload)
      : new Uint8Array(payload);
  }

  protected minQos(a: MqttQoS, b: MqttQoS): MqttQoS {
    return Math.min(a, b) as MqttQoS;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * A client as the memory broker sees it.
 */
export interface MemoryMqttSession {
  /**
   * Hand the session a message, with the identifiers of the subscriptions it
   * matched (undefined when they carry none, under MQTT 3.1.1).
   */
  deliver(message: MqttMessage, ids: number[] | undefined): Promise<void>;

  /**
   * The will its next connection carries.
   */
  will(): MqttWill | undefined;
}

export interface MemoryMqttBrokerSubscription {
  filter: string;
  qos: MqttQoS;
  id: number | undefined;
  group: string | undefined;
}
