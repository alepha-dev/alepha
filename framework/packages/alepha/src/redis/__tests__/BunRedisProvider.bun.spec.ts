import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";

import { Alepha, AlephaError } from "alepha";

import { BunRedisProvider } from "../providers/BunRedisProvider.ts";
import { BunRedisSubscriberProvider } from "../providers/BunRedisSubscriberProvider.ts";
import { RedisProvider } from "../providers/RedisProvider.ts";
import { RedisSubscriberProvider } from "../providers/RedisSubscriberProvider.ts";

/**
 * Resolves once `condition` holds, and throws after two seconds: `bun:test`
 * has no `expect.poll`.
 */
const until = async (condition: () => boolean): Promise<void> => {
  for (let i = 0; i < 400; i++) {
    if (condition()) {
      return;
    }
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new AlephaError("Condition not met within 2 seconds");
};

/**
 * The message a promise rejects with, or undefined if it resolves.
 */
const rejection = (promise: Promise<unknown>): Promise<string | undefined> =>
  promise.then(
    () => undefined,
    (error: unknown) => (error instanceof Error ? error.message : "rejected"),
  );

// -------------------------------------------------------------------------------------------------------------------

describe("BunRedisProvider", () => {
  let alepha: Alepha;
  let redis: RedisProvider;

  beforeAll(async () => {
    alepha = Alepha.create({
      env: { REDIS_URL: "redis://localhost:16379" },
    })
      .with({ provide: RedisProvider, use: BunRedisProvider })
      .with({
        provide: RedisSubscriberProvider,
        use: BunRedisSubscriberProvider,
      });

    redis = alepha.inject(RedisProvider);
    alepha.inject(RedisSubscriberProvider);

    await alepha.start();
  });

  afterAll(async () => {
    await alepha?.stop().catch(() => {});
  });

  it("should report isReady after connect", () => {
    expect(redis.isReady).toBe(true);
  });

  it("should set and get values", async () => {
    const key = `test:bun:${randomUUID()}`;
    const value = randomUUID();

    await redis.set(key, value);
    const result = await redis.get(key);

    expect(result?.toString()).toBe(value);

    // cleanup
    await redis.del([key]);
  });

  it("should return undefined for missing keys", async () => {
    const result = await redis.get(`test:bun:nonexistent:${randomUUID()}`);
    expect(result).toBeUndefined();
  });

  it("should check key existence with has()", async () => {
    const key = `test:bun:has:${randomUUID()}`;

    expect(await redis.has(key)).toBe(false);

    await redis.set(key, "value");
    expect(await redis.has(key)).toBe(true);

    await redis.del([key]);
  });

  it("should delete keys", async () => {
    const key = `test:bun:del:${randomUUID()}`;

    await redis.set(key, "value");
    expect(await redis.has(key)).toBe(true);

    await redis.del([key]);
    expect(await redis.has(key)).toBe(false);
  });

  it("should handle empty del gracefully", async () => {
    await redis.del([]);
  });

  it("should list keys by pattern", async () => {
    const prefix = `test:bun:keys:${randomUUID()}`;
    await redis.set(`${prefix}:a`, "1");
    await redis.set(`${prefix}:b`, "2");

    const keys = await redis.keys(`${prefix}:*`);
    expect(keys).toHaveLength(2);
    expect(keys.sort()).toEqual([`${prefix}:a`, `${prefix}:b`]);

    await redis.del(keys);
  });

  it("should increment values atomically", async () => {
    const key = `test:bun:incr:${randomUUID()}`;

    const val1 = await redis.incr(key, 1);
    expect(val1).toBe(1);

    const val2 = await redis.incr(key, 5);
    expect(val2).toBe(6);

    const val3 = await redis.incr(key, -2);
    expect(val3).toBe(4);

    await redis.del([key]);
  });

  it("should run a Lua script atomically", async () => {
    const key = `test:bun:eval:${randomUUID()}`;
    await redis.set(key, "mine");

    const script = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

    expect(Number(await redis.eval(script, [key], ["theirs"]))).toBe(0);
    expect((await redis.get(key))?.toString()).toBe("mine");

    expect(Number(await redis.eval(script, [key], ["mine"]))).toBe(1);
    expect(await redis.get(key)).toBeUndefined();
  });

  describe("incr with a ttl (fixed window)", () => {
    const pttl = async (key: string) =>
      Number(await redis.eval(`return redis.call("PTTL", KEYS[1])`, [key], []));
    // Stands for time passing: what is left of the window is now `ms`.
    const shorten = async (key: string, ms: number) =>
      redis.eval(
        `return redis.call("PEXPIRE", KEYS[1], ARGV[1])`,
        [key],
        [String(ms)],
      );

    it("should arm the expiry when the counter is created", async () => {
      const key = `test:bun:incr:${randomUUID()}`;

      expect(await redis.incr(key, 1, 60_000)).toBe(1);

      const left = await pttl(key);
      expect(left).toBeGreaterThan(50_000);
      expect(left).toBeLessThanOrEqual(60_000);

      await redis.del([key]);
    });

    it("should not extend the window when the counter comes back to its first value", async () => {
      const key = `test:bun:incr:${randomUUID()}`;

      expect(await redis.incr(key, 1, 60_000)).toBe(1);
      await shorten(key, 5_000);

      expect(await redis.incr(key, -1, 60_000)).toBe(0);
      expect(await redis.incr(key, 1, 60_000)).toBe(1);

      expect(await pttl(key)).toBeLessThanOrEqual(5_000);

      await redis.del([key]);
    });

    it("should arm the expiry of a counter that exists without one", async () => {
      const key = `test:bun:incr:${randomUUID()}`;

      expect(await redis.incr(key, 1)).toBe(1);
      expect(await pttl(key)).toBe(-1);

      expect(await redis.incr(key, 1, 60_000)).toBe(2);

      const left = await pttl(key);
      expect(left).toBeGreaterThan(50_000);
      expect(left).toBeLessThanOrEqual(60_000);

      await redis.del([key]);
    });

    it("should not extend the window on an increment of zero", async () => {
      const key = `test:bun:incr:${randomUUID()}`;

      expect(await redis.incr(key, 0, 60_000)).toBe(0);
      await shorten(key, 5_000);

      expect(await redis.incr(key, 0, 60_000)).toBe(0);

      expect(await pttl(key)).toBeLessThanOrEqual(5_000);

      await redis.del([key]);
    });
  });

  it("should support queue operations (lpush/rpop)", async () => {
    const key = `test:bun:queue:${randomUUID()}`;

    await redis.lpush(key, "first");
    await redis.lpush(key, "second");
    await redis.lpush(key, "third");

    // rpop returns FIFO order (oldest first)
    expect(await redis.rpop(key)).toBe("first");
    expect(await redis.rpop(key)).toBe("second");
    expect(await redis.rpop(key)).toBe("third");
    expect(await redis.rpop(key)).toBeUndefined();
  });

  it("should support sorted-set operations (zadd/zrangebyscore/zrem)", async () => {
    const key = `test:bun:zset:${randomUUID()}`;

    await redis.zadd(key, 100, "later");
    await redis.zadd(key, 10, "sooner");
    await redis.zadd(key, 50, "middle");

    // Lowest score first, and the range is inclusive at both ends.
    expect(await redis.zrangebyscore(key, 0, 50, 10)).toEqual([
      "sooner",
      "middle",
    ]);
    // The limit bounds the read.
    expect(await redis.zrangebyscore(key, 0, 1000, 1)).toEqual(["sooner"]);
    // An empty range is empty, not an error.
    expect(await redis.zrangebyscore(key, 0, 1, 10)).toEqual([]);

    // ZREM reports whether THIS call removed it, which is what makes it
    // usable as a claim between two racing pollers.
    expect(await redis.zrem(key, "sooner")).toBe(1);
    expect(await redis.zrem(key, "sooner")).toBe(0);
    expect(await redis.zrangebyscore(key, 0, 1000, 10)).toEqual([
      "middle",
      "later",
    ]);

    await redis.del([key]);
  });

  it("should support set with EX option", async () => {
    const key = `test:bun:ex:${randomUUID()}`;

    await redis.set(key, "expires", { EX: 10 });
    const result = await redis.get(key);
    expect(result?.toString()).toBe("expires");

    await redis.del([key]);
  });

  it("should round-trip binary values with SET options intact", async () => {
    const key = `test:bun:binary:${randomUUID()}`;

    // Bytes ≥ 0x80: the shape of every compressed / Uint8Array / non-ASCII
    // cache value. RedisCacheProvider always passes a PX expiration, so this
    // exact combination is the cache hot path on Bun.
    const binary = Buffer.from([0x00, 0x7f, 0x80, 0xc3, 0xff, 0xf0]);

    await redis.set(key, binary, {
      expiration: { type: "PX", value: 60_000 },
    });

    const result = await redis.get(key);
    expect(result?.length).toBe(binary.length);
    expect(Buffer.compare(result!, binary)).toBe(0);

    await redis.del([key]);
  });

  it("should round-trip non-ASCII text with EX option intact", async () => {
    const key = `test:bun:utf8:${randomUUID()}`;

    await redis.set(key, "héllo wörld, émojis: 🚀", { EX: 10 });
    const result = await redis.get(key);
    expect(result?.toString("utf-8")).toBe("héllo wörld, émojis: 🚀");

    await redis.del([key]);
  });
});

// -------------------------------------------------------------------------------------------------------------------

describe("BunRedisSubscriberProvider", () => {
  let alepha: Alepha;
  let redis: RedisProvider;
  let sub: RedisSubscriberProvider;

  beforeAll(async () => {
    alepha = Alepha.create({
      env: { REDIS_URL: "redis://localhost:16379" },
    })
      .with({ provide: RedisProvider, use: BunRedisProvider })
      .with({
        provide: RedisSubscriberProvider,
        use: BunRedisSubscriberProvider,
      });

    redis = alepha.inject(RedisProvider);
    sub = alepha.inject(RedisSubscriberProvider);

    await alepha.start();
  });

  afterAll(async () => {
    await alepha?.stop().catch(() => {});
  });

  it("should report isReady after connect", () => {
    expect(sub.isReady).toBe(true);
  });

  it("should support pub/sub messaging", async () => {
    const channel = `test:bun:pubsub:${randomUUID()}`;
    const received: string[] = [];

    await sub.subscribe(channel, (message: string) => {
      received.push(message);
    });

    // Small delay for subscription to register
    await new Promise((r) => setTimeout(r, 50));

    await redis.publish(channel, "hello");
    await redis.publish(channel, "world");

    // Wait for messages to arrive
    await new Promise((r) => setTimeout(r, 200));

    expect(received).toEqual(["hello", "world"]);

    await sub.unsubscribe(channel);
  });

  it("should unsubscribe from channels", async () => {
    const channel = `test:bun:unsub:${randomUUID()}`;
    const received: string[] = [];

    await sub.subscribe(channel, (message: string) => {
      received.push(message);
    });

    await new Promise((r) => setTimeout(r, 50));

    await redis.publish(channel, "before");
    await new Promise((r) => setTimeout(r, 100));

    await sub.unsubscribe(channel);
    await new Promise((r) => setTimeout(r, 50));

    await redis.publish(channel, "after");
    await new Promise((r) => setTimeout(r, 100));

    expect(received).toEqual(["before"]);
  });

  it("should remove one callback and keep the channel's other callbacks", async () => {
    const channel = `test:bun:unsub-one:${randomUUID()}`;
    const sentinelChannel = `test:bun:unsub-one:sentinel:${randomUUID()}`;
    const first: string[] = [];
    const second: string[] = [];
    const sentinel: string[] = [];
    const firstCallback = (message: string) => {
      first.push(message);
    };

    await sub.subscribe(channel, firstCallback);
    await sub.subscribe(channel, (message: string) => {
      second.push(message);
    });
    await sub.subscribe(sentinelChannel, (message: string) => {
      sentinel.push(message);
    });

    await redis.publish(channel, "both");
    await until(() => second.length === 1);
    expect(first).toEqual(["both"]);

    await sub.unsubscribe(channel, firstCallback);
    // A second removal of the same callback removes nothing else.
    await sub.unsubscribe(channel, firstCallback);

    await redis.publish(channel, "second-only");
    await until(() => second.length === 2);
    expect(first).toEqual(["both"]);
    expect(second).toEqual(["both", "second-only"]);

    await sub.unsubscribe(channel);
    // Nothing is left on the channel: a further removal does nothing.
    await sub.unsubscribe(channel);

    // One connection delivers in publish order: once the sentinel is in, a
    // message still delivered on the channel would be in too.
    await redis.publish(channel, "nobody");
    await redis.publish(sentinelChannel, "done");
    await until(() => sentinel.length === 1);
    expect(second).toEqual(["both", "second-only"]);

    await sub.unsubscribe(sentinelChannel);
  });

  describe("a subscribe or unsubscribe that fails", () => {
    /**
     * Fails every SUBSCRIBE and UNSUBSCRIBE while `broken`, as a client
     * that lost its connection does.
     */
    class FailingSubscriberProvider extends BunRedisSubscriberProvider {
      public broken = false;

      public override get subscriber(): Bun.RedisClient {
        const client = super.subscriber;
        if (!this.broken) {
          return client;
        }

        const fail = async () => {
          throw new AlephaError("connection lost");
        };
        return { subscribe: fail, unsubscribe: fail } as any;
      }
    }

    let app: Alepha;
    let failing: FailingSubscriberProvider;
    let publisher: RedisProvider;

    beforeAll(async () => {
      app = Alepha.create({
        env: { REDIS_URL: "redis://localhost:16379" },
      })
        .with({ provide: RedisProvider, use: BunRedisProvider })
        .with({
          provide: RedisSubscriberProvider,
          use: FailingSubscriberProvider,
        });

      publisher = app.inject(RedisProvider);
      failing = app.inject(FailingSubscriberProvider);

      await app.start();
    });

    afterAll(async () => {
      await app?.stop().catch(() => {});
    });

    it("should subscribe a callback whose first subscribe failed", async () => {
      const channel = `test:bun:retry-sub:${randomUUID()}`;
      const received: string[] = [];
      const callback = (message: string) => {
        received.push(message);
      };

      failing.broken = true;
      expect(await rejection(failing.subscribe(channel, callback))).toBe(
        "connection lost",
      );

      failing.broken = false;
      await failing.subscribe(channel, callback);

      await publisher.publish(channel, "hello");
      await until(() => received.length === 1);
      expect(received).toEqual(["hello"]);

      await failing.unsubscribe(channel);
    });

    it("should remove a callback whose first removal failed", async () => {
      const channel = `test:bun:retry-unsub:${randomUUID()}`;
      const received: string[] = [];
      const other: string[] = [];
      const callback = (message: string) => {
        received.push(message);
      };

      await failing.subscribe(channel, callback);
      await failing.subscribe(channel, (message: string) => {
        other.push(message);
      });

      failing.broken = true;
      expect(await rejection(failing.unsubscribe(channel, callback))).toBe(
        "connection lost",
      );

      failing.broken = false;
      await failing.unsubscribe(channel, callback);

      await publisher.publish(channel, "after");
      await until(() => other.length === 1);
      expect(received).toEqual([]);

      failing.broken = true;
      expect(await rejection(failing.unsubscribe(channel))).toBe(
        "connection lost",
      );

      failing.broken = false;
      await failing.unsubscribe(channel);

      // The channel is gone: this publish reaches nobody, and the one on a
      // fresh subscription comes after it.
      await publisher.publish(channel, "nobody");
      const fresh: string[] = [];
      await failing.subscribe(channel, (message: string) => {
        fresh.push(message);
      });
      await publisher.publish(channel, "fresh");
      await until(() => fresh.length === 1);
      expect(other).toEqual(["after"]);
      expect(fresh).toEqual(["fresh"]);

      await failing.unsubscribe(channel);
    });
  });

  it("should clean up connections on stop", async () => {
    const fresh = Alepha.create({
      env: { REDIS_URL: "redis://localhost:16379" },
    })
      .with({ provide: RedisProvider, use: BunRedisProvider })
      .with({
        provide: RedisSubscriberProvider,
        use: BunRedisSubscriberProvider,
      });

    const freshRedis = fresh.inject(RedisProvider);
    const freshSub = fresh.inject(RedisSubscriberProvider);

    await fresh.start();
    expect(freshRedis.isReady).toBe(true);
    expect(freshSub.isReady).toBe(true);

    await fresh.stop();
  });
});
