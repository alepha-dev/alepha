import { test } from "vitest";
import { SharedTopicProvider, testTopicAsSub, testTopicBasic } from "./shared";

test("$topic - basic", async () => {
	await testTopicBasic(SharedTopicProvider);
});

test("$topic - topic as sub", async () => {
	await testTopicAsSub(SharedTopicProvider);
});
