import { testTopicAsSub, testTopicBasic } from "@alepha/topic/test/shared.ts";
import { test } from "vitest";
import { RedisTopicProvider } from "../src";

test("$topic - basic (redis)", async () => {
	await testTopicBasic(RedisTopicProvider);
});

test("$topic - topic as sub (redis)", async () => {
	await testTopicAsSub(RedisTopicProvider);
});
