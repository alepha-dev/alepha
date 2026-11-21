import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { describe, it } from "vitest";

import {
  AlephaRedis,
  RedisProvider,
  RedisSubscriberProvider,
} from "../index.ts";

// The shared test env sets no REDIS_URL, so nothing else turns Redis on; this
// file runs against the compose `redis` service (16379, CI's port too). A
// test file runs in its own process, so this reaches no other file.
process.env.REDIS_URL ??= "redis://localhost:16379";

const alepha = Alepha.create().with(AlephaRedis);
const redis = alepha.inject(RedisProvider);
const sub = alepha.inject(RedisSubscriberProvider);

describe("Redis", () => {
  it("should set and get values", async ({ expect }) => {
    const key = `test:${randomUUID()}`;
    const uuid = randomUUID();
    await redis.set(key, uuid);
    const value = await redis.get(key);
    expect(value?.toString()).toBe(uuid);

    await redis.del([key]);
  });

  it("should run a Lua script atomically", async ({ expect }) => {
    const key = `test:eval:${randomUUID()}`;
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

  it("should support pub/sub messaging", async ({ expect }) => {
    const channel = `test:pubsub:${randomUUID()}`;
    const stack: string[] = [];
    await sub.subscribe(channel, (message: string) => {
      stack.push(message);
    });
    await redis.publish(channel, "hello");
    await expect.poll(() => stack.length).toBe(1);
    expect(stack).toEqual(["hello"]);

    await sub.unsubscribe(channel);
  });

  it("should remove one callback and keep the channel's other callbacks", async ({
    expect,
  }) => {
    const channel = `test:unsub-one:${randomUUID()}`;
    const first: string[] = [];
    const second: string[] = [];
    const firstCallback = (message: string) => {
      first.push(message);
    };

    await sub.subscribe(channel, firstCallback);
    await sub.subscribe(channel, (message: string) => {
      second.push(message);
    });

    await redis.publish(channel, "both");
    await expect.poll(() => second).toEqual(["both"]);
    expect(first).toEqual(["both"]);

    await sub.unsubscribe(channel, firstCallback);
    // A second removal of the same callback removes nothing else.
    await sub.unsubscribe(channel, firstCallback);

    await redis.publish(channel, "second-only");
    await expect.poll(() => second).toEqual(["both", "second-only"]);
    expect(first).toEqual(["both"]);

    await sub.unsubscribe(channel);
    // Nothing is left on the channel: a further removal does nothing.
    await sub.unsubscribe(channel);
  });

  it("should handle buffer values correctly", async ({ expect }) => {
    const uuid = randomUUID().replace(/-/g, "");
    const stringKey = `test:string:${randomUUID()}`;
    const bufferKey = `test:buffer:${randomUUID()}`;
    await redis.set(stringKey, uuid);
    await redis.set(bufferKey, Buffer.from(uuid, "hex"));

    const buf1 = await redis.get(stringKey);
    expect(buf1).toBeInstanceOf(Buffer);
    expect(buf1?.byteLength).toBe(32);
    expect(buf1?.toString("utf-8")).toBe(uuid);

    const buf2 = await redis.get(bufferKey);
    expect(buf2).toBeInstanceOf(Buffer);
    expect(buf2?.byteLength).toBe(16);
    expect(buf2?.toString("hex")).toBe(uuid);

    await redis.del([stringKey, bufferKey]);
  });

  it("should properly clean up connections on stop", async ({ expect }) => {
    const alepha = Alepha.create().with(AlephaRedis);
    const redis = alepha.inject(RedisProvider);
    const sub = alepha.inject(RedisSubscriberProvider);
    const id = randomUUID();
    await alepha.start();
    await sub.subscribe(`test:stop:${id}`, (_message: string) => {});
    await redis.publish(`test:stop:a:${id}`, "a");
    await redis.lpush(`test:stop:b:${id}`, "b");
    expect(await redis.rpop(`test:stop:b:${id}`)).toBe("b");
    await alepha.stop();

    expect(redis.isReady).toBe(false);
    expect(sub.isReady).toBe(false);
  });

  it("should support sorted-set operations (zadd/zrangebyscore/zrem)", async ({
    expect,
  }) => {
    const key = `test:zset:${randomUUID()}`;

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
  });

  it("should increment values atomically", async ({ expect }) => {
    const key = `test:incr:${randomUUID()}`;

    const val1 = await redis.incr(key, 1);
    expect(val1).toBe(1);

    const val2 = await redis.incr(key, 5);
    expect(val2).toBe(6);

    const val3 = await redis.incr(key, -2);
    expect(val3).toBe(4);
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

    it("should arm the expiry when the counter is created", async ({
      expect,
    }) => {
      const key = `test:incr:${randomUUID()}`;

      expect(await redis.incr(key, 1, 60_000)).toBe(1);

      const left = await pttl(key);
      expect(left).toBeGreaterThan(50_000);
      expect(left).toBeLessThanOrEqual(60_000);

      await redis.del([key]);
    });

    it("should not extend the window when the counter comes back to its first value", async ({
      expect,
    }) => {
      const key = `test:incr:${randomUUID()}`;

      expect(await redis.incr(key, 1, 60_000)).toBe(1);
      await shorten(key, 5_000);

      expect(await redis.incr(key, -1, 60_000)).toBe(0);
      expect(await redis.incr(key, 1, 60_000)).toBe(1);

      expect(await pttl(key)).toBeLessThanOrEqual(5_000);

      await redis.del([key]);
    });

    it("should arm the expiry of a counter that exists without one", async ({
      expect,
    }) => {
      const key = `test:incr:${randomUUID()}`;

      expect(await redis.incr(key, 1)).toBe(1);
      expect(await pttl(key)).toBe(-1);

      expect(await redis.incr(key, 1, 60_000)).toBe(2);

      const left = await pttl(key);
      expect(left).toBeGreaterThan(50_000);
      expect(left).toBeLessThanOrEqual(60_000);

      await redis.del([key]);
    });

    it("should not extend the window on an increment of zero", async ({
      expect,
    }) => {
      const key = `test:incr:${randomUUID()}`;

      expect(await redis.incr(key, 0, 60_000)).toBe(0);
      await shorten(key, 5_000);

      expect(await redis.incr(key, 0, 60_000)).toBe(0);

      expect(await pttl(key)).toBeLessThanOrEqual(5_000);

      await redis.del([key]);
    });

    it("should leave a counter incremented without ttl without expiry", async ({
      expect,
    }) => {
      const key = `test:incr:${randomUUID()}`;

      expect(await redis.incr(key, 1)).toBe(1);
      expect(await pttl(key)).toBe(-1);

      await redis.del([key]);
    });
  });
});
