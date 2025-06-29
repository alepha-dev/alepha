import {
	testQueueBasic,
	testQueueHasConsumer,
	testQueueKillWorkerSleep,
} from "@alepha/queue/test/shared.ts";
import { test } from "vitest";
import { RedisQueueProvider } from "../src";

test("$queue - basic (redis)", async () => {
	await testQueueBasic(RedisQueueProvider);
});

test("$queue - has consumer (redis)", async () => {
	await testQueueHasConsumer(RedisQueueProvider);
});

test("$queue - kill worker sleep (redis)", async () => {
	await testQueueKillWorkerSleep(RedisQueueProvider);
});
