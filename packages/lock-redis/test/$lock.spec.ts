import { testLockBasic, testLockWait } from "@alepha/lock/test/shared.ts";
import { RedisTopicProvider } from "@alepha/topic-redis";
import { test } from "vitest";
import { RedisLockProvider } from "../src";

test("$lock - basic (redis)", async () => {
	await testLockBasic(RedisLockProvider, RedisTopicProvider);
});

test("$lock - wait (redis)", async () => {
	await testLockWait(RedisLockProvider, RedisTopicProvider);
});
