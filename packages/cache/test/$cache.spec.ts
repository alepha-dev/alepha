import { randomUUID } from "node:crypto";
import { Alepha, NotImplementedError } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { expect, test } from "vitest";
import { $cache, MemoryCacheProvider } from "../src";
import {
	TestCache,
	testCacheBasic,
	testCacheClear,
	testCacheDisabled,
	testCacheInvalidateAll,
	testCacheInvalidateByArgs,
	testCacheInvalidateByKey,
	testCacheMissingProvider,
	testCacheReturnTypes,
	testCacheStop,
} from "./shared.ts";

test("$cache - basic", async () => {
	await testCacheBasic();
});

test("$cache - stop", async () => {
	await testCacheStop();
});

test("$cache - missing provider", async () => {
	await testCacheMissingProvider();
});

test("$cache - disabled", async () => {
	await testCacheDisabled();
});

test("$cache - invalidate by key", async () => {
	await testCacheInvalidateByKey();
});

test("$cache - invalidate by args", async () => {
	await testCacheInvalidateByArgs();
});

test("$cache - invalidate all", async () => {
	await testCacheInvalidateAll();
});

test("$cache - clear", async () => {
	await testCacheClear();
});

test("$cache - types", async () => {
	await testCacheReturnTypes();
});

test("$cache - infinite", async () => {
	const app = Alepha.create({ env: { REDIS_CACHE_PREFIX: randomUUID() } });
	const test = app.get(TestCache);
	const time = app.get(DateTimeProvider);
	await app.start();

	expect(await test.b({ name: "A" })).toBe("A:0");
	expect(await test.b({ name: "A" })).toBe("A:0");
	await time.travel([1, "day"]);
	expect(await test.b({ name: "A" })).toBe("A:0");
});

test("$cache - not implemented", async () => {
	const alepha = Alepha.create();
	const test = alepha.get(TestCache);

	expect(() => test.a.key({ name: "A" })).toThrow(NotImplementedError);
	await expect(() => test.a.invalidate()).rejects.toThrow(NotImplementedError);
});

test("$cache - unique key", async () => {
	let count = 0;
	class A {
		task = $cache({
			handler: () => {
				count++;
				return "DONE";
			},
		});
	}
	const app = Alepha.create();
	const test = app.get(A);
	await app.start();

	expect(await test.task()).toBe("DONE");
	expect(await test.task()).toBe("DONE");
	expect(await test.task()).toBe("DONE");
	expect(count).toBe(1);

	await test.task.invalidate();
	expect(await test.task()).toBe("DONE");
	expect(await test.task()).toBe("DONE");
	expect(count).toBe(2);

	// [] means no args, it's JSON.stringify([])
	const obj = await app.get(MemoryCacheProvider).get("A:task", "[]");
	expect(obj?.subarray(1)?.toString()).toEqual('"DONE"');
});
