import { randomUUID } from "node:crypto";
import { Alepha, type Env, type Service } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { expect } from "vitest";
import {
	$cache,
	CacheDescriptorProvider,
	CacheProvider,
	MemoryCacheProvider,
} from "../src";

export class TestCache {
	cursor_a = 0;
	cursor_b = 0;

	a = $cache({
		key: (args) => args.name,
		ttl: [5, "seconds"],
		handler: async (user: { name: string }) => {
			return `${user.name}:${this.cursor_a++}`;
		},
	});

	b = $cache({
		provider: "memory",
		key: (args) => args.name,
		ttl: 0,
		handler: async (user: { name: string }) => {
			return `${user.name}:${this.cursor_b++}`;
		},
	});
}

export const testCacheBasic = async (
	env: Env = {},
	cacheProvider: Service<CacheProvider> = MemoryCacheProvider,
): Promise<void> => {
	const app = Alepha.create({
		env,
	}).with({
		provide: CacheProvider,
		use: cacheProvider,
	});
	const test = app.get(TestCache);
	const time = app.get(DateTimeProvider);
	await app.start();

	expect(await test.a({ name: "A" })).toBe("A:0");
	expect(await test.a({ name: "A" })).toBe("A:0");
	expect(await test.a({ name: "B" })).toBe("B:1");
	expect(await test.a({ name: "B" })).toBe("B:1");

	if (!(app.get(CacheProvider) instanceof MemoryCacheProvider)) {
		return; // we can mock only MemoryCacheProvider
	}

	await time.travel([2, "seconds"]);
	expect(await test.a({ name: "A" })).toBe("A:0");
	expect(await test.a({ name: "A" })).toBe("A:0");
	expect(await test.a({ name: "B" })).toBe("B:1");

	await time.travel([4, "seconds"]);
	expect(await test.a({ name: "A" })).toBe("A:2");
	expect(await test.a({ name: "A" })).toBe("A:2");
	expect(await test.a({ name: "B" })).toBe("B:3");
};

export const testCacheStop = async (
	env: Env = {},
	cacheProvider: Service<CacheProvider> = MemoryCacheProvider,
): Promise<void> => {
	const app = Alepha.create({
		env,
	}).with({
		provide: CacheProvider,
		use: cacheProvider,
	});

	const test = app.get(TestCache);
	await app.start();
	await app.stop();

	expect(await test.a({ name: "A" })).toBe("A:0");
	expect(await test.a({ name: "A" })).toBe("A:1");
	expect(await test.a({ name: "A" })).toBe("A:2");
};

export const testCacheMissingProvider = async (
	env: Env = {},
	cacheProvider: Service<CacheProvider> = MemoryCacheProvider,
): Promise<void> => {
	const app = Alepha.create({
		env,
	}).with({
		provide: CacheProvider,
		use: cacheProvider,
	});

	const test = app.get(TestCache);

	expect(await test.a({ name: "A" })).toBe("A:0");
	expect(await test.a({ name: "A" })).toBe("A:1");
};

export const testCacheDisabled = async (
	env: Env = {},
	cacheProvider: Service<CacheProvider> = MemoryCacheProvider,
): Promise<void> => {
	const app = Alepha.create({
		env: {
			REDIS_CACHE_PREFIX: randomUUID(),
			CACHE_ENABLED: false,
			...env,
		},
	}).with({
		provide: CacheProvider,
		use: cacheProvider,
	});

	const test = app.get(TestCache);
	await app.start();

	expect(await test.a({ name: "A" })).toBe("A:0");
	expect(await test.a({ name: "A" })).toBe("A:1");
	expect(await test.a({ name: "B" })).toBe("B:2");
};

export const testCacheInvalidateByKey = async (
	env: Env = {},
	cacheProvider: Service<CacheProvider> = MemoryCacheProvider,
): Promise<void> => {
	const app = Alepha.create({
		env,
	}).with({
		provide: CacheProvider,
		use: cacheProvider,
	});

	const test = app.get(TestCache);
	await app.start();

	expect(await test.a({ name: "A" })).toBe("A:0");
	expect(await test.a({ name: "A" })).toBe("A:0");
	expect(await test.a({ name: "B" })).toBe("B:1");

	await test.a.invalidate("A");
	expect(await test.a({ name: "B" })).toBe("B:1");
	expect(await test.a({ name: "A" })).toBe("A:2");
};

export const testCacheInvalidateByArgs = async (
	env: Env = {},
	cacheProvider: Service<CacheProvider> = MemoryCacheProvider,
): Promise<void> => {
	const app = Alepha.create({
		env,
	}).with({
		provide: CacheProvider,
		use: cacheProvider,
	});

	const test = app.get(TestCache);
	await app.start();

	expect(await test.a({ name: "A" })).toBe("A:0");
	expect(await test.a({ name: "A" })).toBe("A:0");
	expect(await test.a({ name: "B" })).toBe("B:1");

	await test.a.invalidate(test.a.key({ name: "A" }));
	expect(await test.a({ name: "B" })).toBe("B:1");
	expect(await test.a({ name: "A" })).toBe("A:2");
};

export const testCacheInvalidateAll = async (
	env: Env = {},
	cacheProvider: Service<CacheProvider> = MemoryCacheProvider,
): Promise<void> => {
	const app = Alepha.create({
		env,
	}).with({
		provide: CacheProvider,
		use: cacheProvider,
	});

	const test = app.get(TestCache);
	await app.start();

	expect(await test.a({ name: "A" })).toBe("A:0");
	expect(await test.a({ name: "A" })).toBe("A:0");

	await test.a.invalidate();
	expect(await test.a({ name: "A" })).toBe("A:1");
};

export const testCacheClear = async (
	env: Env = {},
	cacheProvider: Service<CacheProvider> = MemoryCacheProvider,
): Promise<void> => {
	const app = Alepha.create({
		env,
	}).with({
		provide: CacheProvider,
		use: cacheProvider,
	});

	const test = app.get(TestCache);
	const provider = app.get(CacheDescriptorProvider);
	await app.start();

	expect(await test.a({ name: "A" })).toBe("A:0");
	expect(await test.a({ name: "A" })).toBe("A:0");
	expect(await test.b({ name: "A" })).toBe("A:0");
	expect(await test.b({ name: "A" })).toBe("A:0");

	await provider.clear();

	expect(await test.a({ name: "A" })).toBe("A:1");
	expect(await test.b({ name: "A" })).toBe("A:1");
};

export const testCacheReturnTypes = async (
	env: Env = {},
	cacheProvider: Service<CacheProvider> = MemoryCacheProvider,
): Promise<void> => {
	class Types {
		json = $cache({
			handler: () => ({ a: 1 }),
		});
		int = $cache({
			handler: () => 1,
		});
		bool = $cache({
			handler: () => true,
		});
		string = $cache({
			handler: () => '{ "a": 1 }',
		});
	}

	const app = Alepha.create({
		env,
	}).with({
		provide: CacheProvider,
		use: cacheProvider,
	});

	const test = app.get(Types);

	expect(await test.json()).toEqual({ a: 1 });
	expect(await test.json()).toEqual({ a: 1 });
	expect(await test.json()).toEqual({ a: 1 });
	expect(await test.int()).toBe(1);
	expect(await test.int()).toBe(1);
	expect(await test.int()).toBe(1);
	expect(await test.bool()).toBe(true);
	expect(await test.bool()).toBe(true);
	expect(await test.bool()).toBe(true);
	expect(await test.string()).toBe('{ "a": 1 }');
	expect(await test.string()).toBe('{ "a": 1 }');
};
