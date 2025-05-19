import { $inject, Alepha } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import type { SubscribeCallback } from "@alepha/topic";
import { MemoryTopicProvider, RedisTopicProvider } from "@alepha/topic";
import { expect, test } from "vitest";
import {
	$lock,
	LockProvider,
	LockTopicProvider,
	MemoryLockProvider,
	RedisLockProvider,
} from "../src";

const testLockBasic = async (provider?: string) => {
	const store: Record<string, string> = {};

	class SharedLockProvider extends MemoryLockProvider {
		store = store;
	}

	class TestLock {
		store = $inject(LockProvider);
		dt = $inject(DateTimeProvider);
		stack = () => store.stack;
		migrate = $lock({
			handler: async () => {
				await this.dt.wait({ milliseconds: 50 });
				store.stack = store.stack ? `${store.stack}A` : "A";
			},
		});
	}

	const createApp = async () => {
		return Alepha.create({
			env: {
				LOCK_PROVIDER: provider === "redis" ? "redis" : "memory",
			},
		})
			.with(TestLock)
			.with({
				provide: LockProvider,
				use: provider === "redis" ? RedisLockProvider : SharedLockProvider,
			})
			.start()
			.then((a) => a.get(TestLock));
	};

	const app1 = await createApp();
	const app2 = await createApp();
	const app3 = await createApp();

	await app1.store.set("stack", "");

	await Promise.all([app1.migrate(), app2.migrate(), app3.migrate()]);

	expect(app1.stack()).toBe("A");
	expect(app2.stack()).toBe("A");
	expect(app3.stack()).toBe("A");
};

test("$lock - basic", async () => {
	await testLockBasic();
});

test("$lock - basic (redis)", async () => {
	await testLockBasic("redis");
});

const testLockWait = async (provider?: string) => {
	const store: Record<string, string> = {};
	const subscriptions: Record<string, SubscribeCallback[]> = {};
	class SharedLockProvider extends MemoryLockProvider {
		store = store;
	}

	class SharedTopicProvider extends MemoryTopicProvider {
		subscriptions = subscriptions;
	}

	let count = 0;

	class TestLockWait {
		dt = $inject(DateTimeProvider);

		migrateLock = $lock({
			wait: true,
			handler: async () => {
				count++;
				await this.dt.wait({ milliseconds: 500 });
			},
		});

		async migrate() {
			const now = Date.now();
			await this.migrateLock();
			return Date.now() - now;
		}
	}

	const createApp = async () => {
		const app = Alepha.create();
		app.with({
			provide: LockTopicProvider,
			use: provider === "redis" ? RedisTopicProvider : SharedTopicProvider,
		});
		app.with({
			provide: LockProvider,
			use: provider === "redis" ? RedisLockProvider : SharedLockProvider,
		});
		app.with(TestLockWait);
		return app.start().then(() => app.get(TestLockWait));
	};

	const app1 = await createApp();
	const app2 = await createApp();
	const app3 = await createApp();

	const result = await Promise.all([
		app1.migrate(),
		app2.migrate(),
		app3.migrate(),
	]);

	expect(result[0]).toBeGreaterThanOrEqual(500);
	expect(result[1]).toBeGreaterThanOrEqual(500);
	expect(result[2]).toBeGreaterThanOrEqual(500);

	expect(count).toBe(1);
};

test("$lock - wait", async () => {
	await testLockWait();
});

test("$lock - wait (redis)", async () => {
	await testLockWait("redis");
});
