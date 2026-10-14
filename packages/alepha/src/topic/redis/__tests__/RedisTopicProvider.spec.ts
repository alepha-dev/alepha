import { randomUUID } from "node:crypto";

import { Alepha, z } from "alepha";
import { $topic, TopicProvider } from "alepha/topic";
import { describe, it, test } from "vitest";

import {
  testTopicAsSub,
  testTopicBasic,
  testTopicLateSubscribe,
  testTopicParams,
  testTopicRetain,
} from "../../core/__tests__/shared.ts";
import { RedisTopicProvider } from "../index.ts";

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
