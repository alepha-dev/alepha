import { randomUUID } from "node:crypto";

import { Alepha } from "alepha";
import { describe, it } from "vitest";

import {
  AlephaRedis,
  RedisProvider,
  RedisSubscriberProvider,
} from "../index.ts";

const alepha = Alepha.create().with(AlephaRedis);
const redis = alepha.inject(RedisProvider);
const sub = alepha.inject(RedisSubscriberProvider);

describe("Redis", () => {
  it("should set and get values", async ({ expect }) => {
    const uuid = randomUUID();
    await redis.set("test", uuid);
    const value = await redis.get("test");
    expect(value?.toString()).toBe(uuid);
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
    const stack: string[] = [];
    await sub.subscribe("test", (message: string) => {
      stack.push(message);
    });
    await redis.publish("test", "hello");
    await expect.poll(() => stack.length).toBe(1);
    expect(stack).toEqual(["hello"]);
  });

  it("should handle buffer values correctly", async ({ expect }) => {
    const uuid = randomUUID().replace(/-/g, "");
    await redis.set("test:string", uuid);
    await redis.set("test:buffer", Buffer.from(uuid, "hex"));

    const buf1 = await redis.get("test:string");
    expect(buf1).toBeInstanceOf(Buffer);
    expect(buf1?.byteLength).toBe(32);
    expect(buf1?.toString("utf-8")).toBe(uuid);

    const buf2 = await redis.get("test:buffer");
    expect(buf2).toBeInstanceOf(Buffer);
    expect(buf2?.byteLength).toBe(16);
    expect(buf2?.toString("hex")).toBe(uuid);
  });

  it("should properly clean up connections on stop", async () => {
    const alepha = Alepha.create().with(AlephaRedis);
    const redis = alepha.inject(RedisProvider);
    const sub = alepha.inject(RedisSubscriberProvider);
    await alepha.start();
    await sub.subscribe("test", (_message: string) => {});
    await redis.publish("test:a", "a");
    await redis.lpush("test:b", "b");
    await alepha.stop();
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
});
