import { randomUUID } from "node:crypto";
import {
	testCacheBasic,
	testCacheClear,
	testCacheDisabled,
	testCacheInvalidateAll,
	testCacheInvalidateByArgs,
	testCacheInvalidateByKey,
	testCacheKeys,
	testCacheMissingProvider,
	testCacheReturnTypes,
	testCacheStop,
} from "@alepha/cache/test/shared.ts";
import { test } from "vitest";
import { RedisCacheProvider } from "../src/providers/RedisCacheProvider.ts";

const provider = RedisCacheProvider;
const env = () => ({ REDIS_CACHE_PREFIX: randomUUID() });

test("$cache - basic", async () => {
	await testCacheBasic(env(), provider);
});

test("$cache - stop (redis)", async () => {
	await testCacheStop(env(), provider);
});

test("$cache - missing provider (redis)", async () => {
	await testCacheMissingProvider(env(), provider);
});

test("$cache - disabled (redis)", async () => {
	await testCacheDisabled(env(), provider);
});

test("$cache - invalidate by key (redis)", async () => {
	await testCacheInvalidateByKey(env(), provider);
});

test("$cache - invalidate by args (redis)", async () => {
	await testCacheInvalidateByArgs(env(), provider);
});

test("$cache - invalidate all (redis)", async () => {
	await testCacheInvalidateAll(env(), provider);
});

test("$cache - clear (redis)", async () => {
	await testCacheClear(env(), provider);
});

test("$cache - types (redis)", async () => {
	await testCacheReturnTypes(env(), provider);
});

test("$cache - keys (redis)", async () => {
	await testCacheKeys(env(), provider);
});
