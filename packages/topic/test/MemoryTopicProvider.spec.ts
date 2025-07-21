import { describe, test } from "vitest";
import {
	SharedTopicProvider,
	testTopicAsSub,
	testTopicBasic,
	testTopicLateSubscribe,
} from "./shared";

describe("$topic - memory", () => {
	const provider = SharedTopicProvider;

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
