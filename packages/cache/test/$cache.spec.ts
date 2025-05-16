import { randomUUID } from "node:crypto";
import type { Env } from "@alepha/core";
import { Alepha, NotImplementedError } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { expect, test } from "vitest";
import {
	$cache,
	CacheDescriptorProvider,
	CacheProvider,
	MemoryCacheProvider,
	RedisCacheProvider,
} from "../src";

class TestCache {
	cursor_a = 0;
	cursor_b = 0;

	a = $cache({
		key: (args) => args.name,
		ttl: { seconds: 5 },
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

test("$cache - basic", async () => {
	const app = Alepha.create({ env: { REDIS_CACHE_PREFIX: randomUUID() } });
	const test = app.get(TestCache);
	const time = app.get(DateTimeProvider);
	await app.start();

	expect(await test.a({ name: "A" })).toBe("A:0");
	expect(await test.a({ name: "A" })).toBe("A:0");
	expect(await test.a({ name: "B" })).toBe("B:1");
	expect(await test.a({ name: "B" })).toBe("B:1");

	if (app.get(CacheProvider) instanceof RedisCacheProvider) {
		return; // we can't mock redis time
	}

	await time.add({ seconds: 2 });
	expect(await test.a({ name: "A" })).toBe("A:0");
	expect(await test.a({ name: "A" })).toBe("A:0");
	expect(await test.a({ name: "B" })).toBe("B:1");

	await time.add({ seconds: 4 });
	expect(await test.a({ name: "A" })).toBe("A:2");
	expect(await test.a({ name: "A" })).toBe("A:2");
	expect(await test.a({ name: "B" })).toBe("B:3");
});

const testCacheStop = async (env: Env = {}) => {
	const app = Alepha.create({
		env: { REDIS_CACHE_PREFIX: randomUUID(), ...env },
	});
	const test = app.get(TestCache);
	await app.start();
	await app.stop();

	expect(await test.a({ name: "A" })).toBe("A:0");
	expect(await test.a({ name: "A" })).toBe("A:1");
	expect(await test.a({ name: "A" })).toBe("A:2");
};

test("$cache - stop", async () => {
	await testCacheStop();
});

test("$cache - stop (redis)", async () => {
	await testCacheStop({ STORE_PROVIDER: "redis" });
});

const testCacheMissingProvider = async (env: Env = {}) => {
	const test = new Alepha({
		env: { REDIS_CACHE_PREFIX: randomUUID(), ...env },
	}).get(TestCache);
	expect(await test.a({ name: "A" })).toBe("A:0");
	expect(await test.a({ name: "A" })).toBe("A:1");
};

test("$cache - missing provider", async () => {
	await testCacheMissingProvider();
});

const testCacheDisabled = async (env: Env = {}) => {
	const app = Alepha.create({
		env: {
			REDIS_CACHE_PREFIX: randomUUID(),
			CACHE_ENABLED: false,
			...env,
		},
	});
	const test = app.get(TestCache);
	await app.start();

	expect(await test.a({ name: "A" })).toBe("A:0");
	expect(await test.a({ name: "A" })).toBe("A:1");
	expect(await test.a({ name: "B" })).toBe("B:2");
};

test("$cache - disabled", async () => {
	await testCacheDisabled();
});

test("$cache - disabled (redis)", async () => {
	await testCacheDisabled({ STORE_PROVIDER: "redis" });
});

test("$cache - infinite", async () => {
	const app = Alepha.create({ env: { REDIS_CACHE_PREFIX: randomUUID() } });
	const test = app.get(TestCache);
	const time = app.get(DateTimeProvider);
	await app.start();

	expect(await test.b({ name: "A" })).toBe("A:0");
	expect(await test.b({ name: "A" })).toBe("A:0");
	await time.add({ day: 1 });
	expect(await test.b({ name: "A" })).toBe("A:0");
});

const testCacheInvalidateByKey = async (env: Env = {}) => {
	const app = Alepha.create({
		env: { REDIS_CACHE_PREFIX: randomUUID(), ...env },
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

test("$cache - invalidate by key", async () => {
	await testCacheInvalidateByKey();
});

test("$cache - invalidate by key (redis)", async () => {
	await testCacheInvalidateByKey({ STORE_PROVIDER: "redis" });
});

const testCacheInvalidateByArgs = async (env: Env = {}) => {
	const app = Alepha.create({
		env: { REDIS_CACHE_PREFIX: randomUUID(), ...env },
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

test("$cache - invalidate by args", async () => {
	await testCacheInvalidateByArgs();
});

test("$cache - invalidate by args (redis)", async () => {
	await testCacheInvalidateByArgs({ STORE_PROVIDER: "redis" });
});

const testCacheInvalidateAll = async (env: Env = {}) => {
	const app = Alepha.create({
		env: { REDIS_CACHE_PREFIX: randomUUID(), ...env },
	});
	const test = app.get(TestCache);
	await app.start();

	expect(await test.a({ name: "A" })).toBe("A:0");
	expect(await test.a({ name: "A" })).toBe("A:0");

	await test.a.invalidate();
	expect(await test.a({ name: "A" })).toBe("A:1");
};

test("$cache - invalidate all", async () => {
	await testCacheInvalidateAll();
});

test("$cache - invalidate all (redis)", async () => {
	await testCacheInvalidateAll({ STORE_PROVIDER: "redis" });
});

const testCacheClear = async (env: Env = {}) => {
	const app = Alepha.create({
		env: { REDIS_CACHE_PREFIX: randomUUID(), ...env },
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

test("$cache - clear", async () => {
	await testCacheClear();
});

test("$cache - clear (redis)", async () => {
	await testCacheClear({ STORE_PROVIDER: "redis" });
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
	expect(obj).toEqual('"DONE"');
});

const testCacheReturnTypes = async (env: Env = {}) => {
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
		env: { REDIS_CACHE_PREFIX: randomUUID(), ...env },
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

test("$cache - types", async () => {
	await testCacheReturnTypes();
});

test("$cache - types (redis)", async () => {
	await testCacheReturnTypes({ STORE_PROVIDER: "redis" });
});
