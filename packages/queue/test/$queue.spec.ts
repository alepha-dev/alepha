import { test } from "vitest";
import { MemoryQueueProvider } from "../src";
import {
	SharedQueueProvider,
	testQueueBasic,
	testQueueHasConsumer,
	testQueueKillWorkerSleep,
} from "./shared.ts";

test("$queue - basic", async () => {
	await testQueueBasic(SharedQueueProvider);
});

test("$queue - has consumer", async () => {
	await testQueueHasConsumer(MemoryQueueProvider);
});

test("$queue - kill worker sleep", async () => {
	await testQueueKillWorkerSleep(MemoryQueueProvider);
});
