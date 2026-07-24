import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { Alepha } from "alepha";
import { BunRedisProvider } from "../providers/BunRedisProvider.ts";
import { BunRedisSubscriberProvider } from "../providers/BunRedisSubscriberProvider.ts";
import { RedisProvider } from "../providers/RedisProvider.ts";
import { RedisSubscriberProvider } from "../providers/RedisSubscriberProvider.ts";

// -------------------------------------------------------------------------------------------------------------------

describe("BunRedisProvider", () => {
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

  it("should support set with EX option", async () => {
    const key = `test:bun:ex:${randomUUID()}`;

    await redis.set(key, "expires", { EX: 10 });
    const result = await redis.get(key);
    expect(result?.toString()).toBe("expires");

    await redis.del([key]);
  });

  it("should round-trip binary values with SET options intact", async () => {
    const key = `test:bun:binary:${randomUUID()}`;

    // Bytes ≥ 0x80 — the shape of every compressed / Uint8Array / non-ASCII
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

    await redis.set(key, "héllo wörld — émojis: 🚀", { EX: 10 });
    const result = await redis.get(key);
    expect(result?.toString("utf-8")).toBe("héllo wörld — émojis: 🚀");

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
