import { randomUUID } from "node:crypto";
import { Alepha } from "@alepha/core";
import { test } from "vitest";
import { RedisProvider, RedisSubscriberProvider } from "../src";

const alepha = Alepha.create();
const redis = alepha.get(RedisProvider);
const sub = alepha.get(RedisSubscriberProvider);

test("Redis - basic", async ({ expect }) => {
	const uuid = randomUUID();
	await redis.publisher.set("test", uuid);
	const value = await redis.publisher.get("test");
	expect(value).toBe(uuid);
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
