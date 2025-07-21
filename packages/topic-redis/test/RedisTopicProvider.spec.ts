import {
	testTopicAsSub,
	testTopicBasic,
	testTopicLateSubscribe,
} from "@alepha/topic/test/shared.ts";
import { describe, test } from "vitest";
import { RedisTopicProvider } from "../src";

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
});
