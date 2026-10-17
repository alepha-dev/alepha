import { randomUUID } from "node:crypto";

import { expect, it } from "vitest";

import type { MqttOptions } from "../mqttOptions.ts";
import type {
  MqttClientProvider,
  MqttMessage,
} from "../providers/MqttClientProvider.ts";

/**
 * A client the contract drives, with the backend's way of cutting its
 * connection.
 */
export interface MqttContractClient {
  client: MqttClientProvider;
  simulateDisconnect: () => Promise<void>;
}

export interface MqttClientContractFixture {
  /**
   * A started client on the backend under test. Every client of one test
   * talks to the same broker.
   */
  create: (options?: Partial<MqttOptions>) => Promise<MqttContractClient>;
}

/**
 * Collects the messages one callback receives, and waits for them without
 * sleeping: a real broker delivers when it delivers.
 */
export class MqttInbox {
  public readonly messages: MqttMessage[] = [];
  protected waiters: Array<() => void> = [];

  public readonly callback = (message: MqttMessage): void => {
    this.messages.push(message);
    for (const wake of this.waiters) {
      wake();
    }
  };

  public texts(): string[] {
    return this.messages.map((it) => new TextDecoder().decode(it.payload));
  }

  /**
   * Resolve once a message satisfies `predicate`, or fail after 5 seconds.
   */
  public async until(
    predicate: (message: MqttMessage) => boolean,
  ): Promise<MqttMessage> {
    return this.wait(() => this.messages.find(predicate));
  }

  public untilText(text: string): Promise<MqttMessage> {
    return this.until((it) => new TextDecoder().decode(it.payload) === text);
  }

  /**
   * Resolve once `count` messages have arrived.
   */
  public async untilCount(count: number): Promise<void> {
    await this.wait(() =>
      this.messages.length >= count ? this.messages[count - 1] : undefined,
    );
  }

  protected wait(found: () => MqttMessage | undefined): Promise<MqttMessage> {
    const existing = found();
    if (existing) {
      return Promise.resolve(existing);
    }

    return new Promise<MqttMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((it) => it !== wake);
        reject(
          new Error(
            `No matching MQTT message within 5s; received: ${JSON.stringify(this.texts())}`,
          ),
        );
      }, 5_000);
      const wake = () => {
        const message = found();
        if (message) {
          clearTimeout(timer);
          this.waiters = this.waiters.filter((it) => it !== wake);
          resolve(message);
        }
      };
      this.waiters.push(wake);
    });
  }
}

/**
 * One set of observable MQTT semantics, run on the memory broker and on a
 * real one (Mosquitto), like `ActorContract` on every actor backend: the
 * fake cannot drift from reality without this suite going red.
 *
 * Every case uses a topic prefix of its own and awaits SUBACK and PUBACK,
 * never a sleep. "Exactly once" is proven with a sentinel: MQTT keeps the
 * order of one publisher's messages on one topic per subscription, so once
 * the sentinel has arrived, a duplicate of an earlier message would have
 * arrived before it.
 */
export class MqttClientContract {
  public static define(fixture: MqttClientContractFixture): void {
    const prefix = () => `alepha-test/${randomUUID()}`;

    it("publishes and subscribes at QoS 0 and 1", async () => {
      const root = prefix();
      const { client } = await fixture.create();
      const inbox = new MqttInbox();
      await client.subscribe(`${root}/q0`, inbox.callback, { qos: 0 });
      await client.subscribe(`${root}/q1`, inbox.callback, { qos: 1 });

      await client.publish(`${root}/q0`, "zero", { qos: 0 });
      await client.publish(`${root}/q1`, "one", { qos: 1 });

      expect((await inbox.untilText("zero")).topic).toBe(`${root}/q0`);
      const one = await inbox.untilText("one");
      expect(one.topic).toBe(`${root}/q1`);
      expect(one.qos).toBe(1);
      expect(one.retain).toBe(false);
    });

    it("matches + and # wildcards and reports the received topic", async () => {
      const root = prefix();
      const { client } = await fixture.create();
      const single = new MqttInbox();
      const multi = new MqttInbox();
      await client.subscribe(`${root}/+/status`, single.callback, { qos: 1 });
      await client.subscribe(`${root}/#`, multi.callback, { qos: 1 });

      await client.publish(`${root}/a/status`, "a", { qos: 1 });
      await client.publish(`${root}/a/b/status`, "deep", { qos: 1 });
      await client.publish(`${root}/a/status`, "sentinel", { qos: 1 });

      await multi.untilText("sentinel");
      await single.untilText("sentinel");
      expect(multi.texts()).toEqual(["a", "deep", "sentinel"]);
      expect(multi.messages[1].topic).toBe(`${root}/a/b/status`);
      // `deep` is two levels down: `+` does not match it.
      expect(single.texts()).toEqual(["a", "sentinel"]);
      expect(single.messages[0].topic).toBe(`${root}/a/status`);
    });

    it("delivers a retained message on subscribe, and clears it with an empty payload", async () => {
      const root = prefix();
      const { client: publisher } = await fixture.create();
      await publisher.publish(`${root}/state`, "kept", {
        qos: 1,
        retain: true,
      });

      const { client: late } = await fixture.create();
      const inbox = new MqttInbox();
      await late.subscribe(`${root}/state`, inbox.callback, { qos: 1 });
      const retained = await inbox.untilText("kept");
      expect(retained.retain).toBe(true);

      await publisher.publish(`${root}/state`, new Uint8Array(0), {
        qos: 1,
        retain: true,
      });

      const { client: later } = await fixture.create();
      const after = new MqttInbox();
      await later.subscribe(`${root}/state`, after.callback, { qos: 1 });
      await publisher.publish(`${root}/state`, "live", { qos: 1 });
      await after.untilText("live");
      expect(after.texts()).toEqual(["live"]);
    });

    it("publishes the Last Will on a dropped connection, as a string and as bytes set by code", async () => {
      const root = prefix();
      const { client: watcher } = await fixture.create();
      const inbox = new MqttInbox();
      await watcher.subscribe(`${root}/will`, inbox.callback, { qos: 1 });

      const device = await fixture.create({
        will: {
          topic: `${root}/will`,
          payload: "gone",
          qos: 1,
          retain: false,
        },
      });

      // Replaced by code: the open connection keeps the will it connected
      // with, the next one carries this.
      const bytes = new Uint8Array([0, 1, 2, 250, 255]);
      device.client.setWill({ topic: `${root}/will`, payload: bytes, qos: 1 });

      await device.simulateDisconnect();
      await inbox.untilText("gone");

      await device.simulateDisconnect();
      const second = await inbox.until(
        (it) => it.payload.length === bytes.length && it.payload[3] === 250,
      );
      expect([...second.payload]).toEqual([...bytes]);
    });

    it("keeps its subscriptions across a reconnect", async () => {
      const root = prefix();
      const { client: publisher } = await fixture.create();
      const subscriber = await fixture.create();
      const inbox = new MqttInbox();
      await subscriber.client.subscribe(`${root}/+`, inbox.callback, {
        qos: 1,
      });

      await subscriber.simulateDisconnect();
      expect(subscriber.client.isConnected).toBe(true);

      await publisher.publish(`${root}/after`, "after", { qos: 1 });
      expect((await inbox.untilText("after")).topic).toBe(`${root}/after`);
    });

    it("round-trips binary payloads byte for byte", async () => {
      const root = prefix();
      const { client } = await fixture.create();
      const inbox = new MqttInbox();
      await client.subscribe(`${root}/bin`, inbox.callback, { qos: 1 });

      const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
      await client.publish(`${root}/bin`, bytes, { qos: 1 });

      const received = await inbox.until(() => true);
      expect(received.payload).toBeInstanceOf(Uint8Array);
      expect([...received.payload]).toEqual([...bytes]);
    });

    it("hands one message to a shared and a plain subscription of one client exactly once each", async () => {
      const root = prefix();
      const { client } = await fixture.create();
      const { client: publisher } = await fixture.create();
      const shared = new MqttInbox();
      const plain = new MqttInbox();
      await client.subscribe(`$share/g/${root}/+`, shared.callback, {
        qos: 1,
      });
      await client.subscribe(`${root}/+`, plain.callback, { qos: 1 });

      await publisher.publish(`${root}/x`, "once", { qos: 1 });
      await publisher.publish(`${root}/x`, "sentinel", { qos: 1 });

      await shared.untilText("sentinel");
      await plain.untilText("sentinel");
      expect(shared.texts()).toEqual(["once", "sentinel"]);
      expect(plain.texts()).toEqual(["once", "sentinel"]);
      expect(shared.messages[0].topic).toBe(`${root}/x`);
    });

    it("hands each message to one member of a shared group", async () => {
      const root = prefix();
      const { client: a } = await fixture.create();
      const { client: b } = await fixture.create();
      const { client: publisher } = await fixture.create();
      const group = new MqttInbox();
      await a.subscribe(`$share/workers/${root}/job`, group.callback, {
        qos: 1,
      });
      await b.subscribe(`$share/workers/${root}/job`, group.callback, {
        qos: 1,
      });

      const count = 10;
      for (let i = 0; i < count; i++) {
        await publisher.publish(`${root}/job`, `job-${i}`, { qos: 1 });
      }

      // Ten distinct messages among the members, so none was handed to
      // both: a copy to each would make twenty, or a duplicate in place of
      // a missing one.
      await group.untilCount(count);
      expect(group.texts().sort()).toEqual(
        Array.from({ length: count }, (_, i) => `job-${i}`).sort(),
      );
    });
  }
}
