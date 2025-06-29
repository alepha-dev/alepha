import { MemoryTopicProvider } from "@alepha/topic";
import { test } from "vitest";
import {
	SharedLockProvider,
	SharedTopicProvider,
	testLockBasic,
	testLockWait,
} from "./shared.ts";

test("$lock - basic", async () => {
	await testLockBasic(SharedLockProvider, MemoryTopicProvider);
});

test("$lock - wait", async () => {
	await testLockWait(SharedLockProvider, SharedTopicProvider);
});
