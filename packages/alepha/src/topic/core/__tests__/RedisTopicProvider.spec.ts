import { randomUUID } from "node:crypto";

import { Alepha, z } from "alepha";
import { RedisProvider } from "alepha/redis";
import { $topic, TopicProvider } from "alepha/topic";
import { describe, it, test } from "vitest";

import {
  AlephaTopic,
  MemoryTopicProvider,
  RedisTopicProvider,
} from "../index.ts";
import {
  testTopicAsSub,
  testTopicBasic,
  testTopicLateSubscribe,
  testTopicParams,
  testTopicRetain,
} from "./shared.ts";

// The shared test env sets no REDIS_URL, so nothing else turns Redis on; this
// file runs against the compose `redis` service (16379, CI's port too). A
// test file runs in its own process, so this reaches no other file.
process.env.REDIS_URL ??= "redis://localhost:16379";

describe("$topic - redis", () => {
  const provider = RedisTopicProvider;

  test("should subscribe and publish", async () => {
    await testTopicBasic(provider);
  });

  test("should subscribe with handler", async () => {
    await testTopicAsSub(provider);
  });

  test("should subscribe after start with provider", async () => {
    await testTopicLateSubscribe(provider);
  });

  it("should deliver retained message to new subscriber", async () => {
    await testTopicRetain(RedisTopicProvider);
  });

  it("should deliver messages to parameterized topics", async () => {
    await testTopicParams(provider);
  });
});

describe("$topic - redis, one namespace per alepha.name", () => {
  const topicName = `ns-${randomUUID()}`;

  class Topics {
    t = $topic({
      name: topicName,
      schema: { payload: z.object({ value: z.text() }) },
      retain: true,
    });
  }

  const start = async (name: string) => {
    const app = Alepha.create({ env: { APP_NAME: name } })
      .with({ provide: TopicProvider, use: RedisTopicProvider })
      .with(Topics);
    await app.start();
    return app;
  };

  const listen = async (app: Alepha) => {
    const received: string[] = [];
    await app.inject(Topics).t.subscribe(async (m) => {
      received.push(m.payload.value);
    });
    return received;
  };

  it("should key channels and retained values under <name>:topic:", ({
    expect,
  }) => {
    const app = Alepha.create({ env: { APP_NAME: "shop" } });

    expect(app.inject(RedisTopicProvider).prefix("websocket:broadcast")).toBe(
      "shop:topic:websocket:broadcast",
    );
  });

  it("should not deliver messages or retained values across names, and should within one", async ({
    expect,
  }) => {
    const a = `a-${randomUUID()}`;
    const publisher = await start(a);
    const sibling = await start(a);
    const other = await start(`b-${randomUUID()}`);

    const siblingReceived = await listen(sibling);
    const otherReceived = await listen(other);

    await publisher.inject(Topics).t.publish({ value: "live" });
    await expect.poll(() => siblingReceived).toEqual(["live"]);

    // A late subscriber of the same name gets the retained value; one of
    // another name does not.
    const lateSibling = await listen(await start(a));
    const lateOther = await listen(await start(`b-${randomUUID()}`));
    await expect.poll(() => lateSibling).toEqual(["live"]);

    expect(otherReceived).toEqual([]);
    expect(lateOther).toEqual([]);
  });
});

describe("AlephaTopic: REDIS_URL picks the provider", () => {
  const topicName = `select-${randomUUID()}`;

  class Topics {
    t = $topic({
      name: topicName,
      schema: { payload: z.object({ value: z.text() }) },
    });
  }

  it("lets two containers sharing REDIS_URL exchange a message", async ({
    expect,
  }) => {
    const name = `select-${randomUUID()}`;
    const boot = async () => {
      const app = Alepha.create({
        env: { REDIS_URL: process.env.REDIS_URL, APP_NAME: name },
      })
        .with(AlephaTopic)
        .with(Topics);
      await app.start();
      return app;
    };
    const publisher = await boot();
    const receiver = await boot();
    const received: string[] = [];
    await receiver.inject(Topics).t.subscribe(async (m) => {
      received.push(m.payload.value);
    });

    expect(publisher.inject(TopicProvider)).toBeInstanceOf(RedisTopicProvider);
    await publisher.inject(Topics).t.publish({ value: "across" });
    await expect.poll(() => received).toEqual(["across"]);

    await Promise.all([publisher.stop(), receiver.stop()]);
  });

  it("is Memory without REDIS_URL, and registers no Redis client", async ({
    expect,
  }) => {
    const app = Alepha.create({ env: { REDIS_URL: undefined } })
      .with(AlephaTopic)
      .with(Topics);
    await app.start();

    expect(app.inject(TopicProvider)).toBeInstanceOf(MemoryTopicProvider);
    expect(app.has(RedisProvider)).toBe(false);

    await app.stop();
  });

  it("keeps an app's explicit substitution over REDIS_URL", ({ expect }) => {
    const app = Alepha.create({ env: { REDIS_URL: process.env.REDIS_URL } })
      .with({ provide: TopicProvider, use: MemoryTopicProvider })
      .with(AlephaTopic);

    expect(app.inject(TopicProvider)).toBeInstanceOf(MemoryTopicProvider);
  });
});
