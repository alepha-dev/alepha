import { randomUUID } from "node:crypto";
import { Alepha } from "@alepha/core";
import { test } from "vitest";
import { RedisProvider, RedisSubscriberProvider } from "../src";

const alepha = Alepha.create();
const redis = alepha.get(RedisProvider);
const sub = alepha.get(RedisSubscriberProvider);

test("Redis - basic", async ({ expect }) => {
	const uuid = randomUUID();
	await redis.set("test", uuid);
	const value = await redis.get("test");
	expect(value?.toString()).toBe(uuid);
});

test("Redis - pub/sub", async ({ expect }) => {
	const stack: string[] = [];
	await sub.subscriber.subscribe("test", (message) => {
		stack.push(message);
	});
	await redis.publisher.publish("test", "hello");
	await expect.poll(() => stack.length).toBe(1);
	expect(stack).toEqual(["hello"]);
});

test("Redis - buffer", async ({ expect }) => {
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

test("Redis - stop", async () => {
	const alepha = Alepha.create();
	const redis = alepha.get(RedisProvider);
	const sub = alepha.get(RedisSubscriberProvider);
	await alepha.start();
	sub.subscriber.subscribe("test", (message) => {});
	redis.publisher.publish("test:a", "a");
	redis.publisher.LPUSH("test:b", "b");
	await alepha.stop();
});
