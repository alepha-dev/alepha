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
  testTopicSameCallbackTwice,
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

  it("should remove one subscription of a callback subscribed twice", async () => {
    await testTopicSameCallbackTwice(provider);
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

describe("$topic - redis, request/response across instances", () => {
  const topicName = `rpc-${randomUUID()}`;

  class Rpc {
    double = $topic({
      name: topicName,
      provider: RedisTopicProvider,
      schema: {
        payload: z.object({ value: z.number() }),
        response: z.object({ doubled: z.number() }),
      },
    });
  }

  class Responder {
    double = $topic({
      name: topicName,
      provider: RedisTopicProvider,
      schema: {
        payload: z.object({ value: z.number() }),
        response: z.object({ doubled: z.number() }),
      },
      handler: async ({ payload }) => ({ doubled: payload.value * 2 }),
    });
  }

  it("answers a request from another instance on its reply channel", async ({
    expect,
  }) => {
    const responder = Alepha.create().with(AlephaTopic).with(Responder);
    const requester = Alepha.create().with(AlephaTopic).with(Rpc);
    await responder.start();
    await requester.start();

    const result = await requester
      .inject(Rpc)
      .double.request({ value: 21 }, { timeout: [5, "seconds"] });

    expect(result).toEqual({ doubled: 42 });
  });
});

describe("$topic - redis, a pattern that receives more than its template", () => {
  // The Redis wildcard `*` crosses `/`, so the pattern of
  // `<root>/{id}/status` also receives `<root>/s1/d1/status`.
  it("should not hand a handler a topic its template does not match", async ({
    expect,
  }) => {
    const root = `devices-${randomUUID()}`;
    const received: Array<{ id: string; value: string }> = [];

    class Devices {
      status = $topic({
        name: `${root}/{id}/status`,
        schema: {
          params: z.object({ id: z.text() }),
          payload: z.object({ value: z.text() }),
        },
        handler: async (message) => {
          received.push({
            id: message.params.id,
            value: message.payload.value,
          });
        },
      });

      nested = $topic({
        name: `${root}/{site}/{id}/status`,
        schema: {
          params: z.object({ site: z.text(), id: z.text() }),
          payload: z.object({ value: z.text() }),
        },
      });
    }

    const app = Alepha.create()
      .with({ provide: TopicProvider, use: RedisTopicProvider })
      .with(Devices);
    await app.start();
    const devices = app.inject(Devices);

    await devices.nested.publish({
      params: { site: "s1", id: "d1" },
      payload: { value: "for-nested" },
    });
    await devices.status.publish({
      params: { id: "d2" },
      payload: { value: "for-status" },
    });

    // Redis delivers in publish order on one connection: once the second
    // message is in, the first has been handled or dropped.
    await expect.poll(() => received.length).toBeGreaterThan(0);
    expect(received).toEqual([{ id: "d2", value: "for-status" }]);

    await app.stop();
  });

  it("should not hand wait() a topic its template does not match", async ({
    expect,
  }) => {
    const root = `devices-${randomUUID()}`;
    const payload = z.object({ value: z.text() });
    const params = z.object({ id: z.text() });

    const app = Alepha.create().with({
      provide: TopicProvider,
      use: RedisTopicProvider,
    });
    const topics = app.inject(RedisTopicProvider);
    await app.start();

    const seen: unknown[] = [];
    const waiting = topics.waitForMessage<{
      payload: typeof payload;
      params: typeof params;
    }>(`${root}/{id}/status`, payload, {
      timeout: [5, "seconds"],
      filter: (message) => {
        seen.push(message.params);
        return true;
      },
    });

    // The wait's PSUBSCRIBE is already on the subscriber connection, which
    // answers in order: once this later SUBSCRIBE is acknowledged, the wait
    // is listening.
    await topics.subscribe(`${root}-opened`, () => {});

    await topics.publishMessage(`${root}/s1/d1/status`, payload, {
      value: "for-nested",
    });
    await topics.publishMessage(`${root}/d2/status`, payload, {
      value: "for-status",
    });

    const message = await waiting;
    expect(seen).toEqual([{ id: "d2" }]);
    expect(message.params).toEqual({ id: "d2" });
    expect(message.payload).toEqual({ value: "for-status" });

    await app.stop();
  });
});

describe("RedisTopicProvider, one listener per subscription", () => {
  const boot = async () => {
    const app = Alepha.create().with({
      provide: TopicProvider,
      use: RedisTopicProvider,
    });
    const topics = app.inject(RedisTopicProvider);
    await app.start();
    return { app, topics };
  };

  it("should keep the other listeners of a topic when an UnSubscribeFn is called twice", async ({
    expect,
  }) => {
    const { app, topics } = await boot();
    const name = `twice-${randomUUID()}`;
    const first: string[] = [];
    const second: string[] = [];

    const unsubscribeFirst = await topics.subscribe(name, (message) => {
      first.push(message);
    });
    await topics.subscribe(name, (message) => {
      second.push(message);
    });

    await unsubscribeFirst();
    await unsubscribeFirst();

    await topics.publish(name, "after");
    await expect.poll(() => second).toEqual(["after"]);
    expect(first).toEqual([]);

    await app.stop();
  });

  it("should let an UnSubscribeFn that failed be called again", async ({
    expect,
  }) => {
    const { app, topics } = await boot();
    const name = `retry-${randomUUID()}`;
    const received: string[] = [];
    const sentinel: string[] = [];

    const unsubscribe = await topics.subscribe(name, (message) => {
      received.push(message);
    });

    // The subscriber is closed: nothing can be removed.
    await app.stop();
    await expect(unsubscribe()).rejects.toThrow();

    await app.start();
    await unsubscribe();
    await topics.subscribe(name, (message) => {
      sentinel.push(message);
    });

    await topics.publish(name, "after");
    await expect.poll(() => sentinel).toEqual(["after"]);
    expect(received).toEqual([]);

    await app.stop();
  });

  it("should unsubscribe one callback from one of the two topics it listens to", async ({
    expect,
  }) => {
    const { app, topics } = await boot();
    const a = `same-a-${randomUUID()}`;
    const b = `same-b-${randomUUID()}`;
    const received: string[] = [];
    const callback = (message: string, topic?: string) => {
      received.push(`${topic}:${message}`);
    };
    const other: string[] = [];

    const unsubscribeA = await topics.subscribe(a, callback);
    const unsubscribeB = await topics.subscribe(b, callback);
    await topics.subscribe(b, (message) => {
      other.push(message);
    });

    await unsubscribeA();
    await topics.publish(a, "1");
    await topics.publish(b, "2");
    await expect.poll(() => other).toEqual(["2"]);
    expect(received).toEqual([`${b}:2`]);

    await unsubscribeB();
    await topics.publish(b, "3");
    await expect.poll(() => other).toEqual(["2", "3"]);
    expect(received).toEqual([`${b}:2`]);

    await app.stop();
  });
});
