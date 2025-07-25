import { randomUUID } from "node:crypto";
import { $inject, Alepha, type Service } from "@alepha/core";
import { DateTimeProvider, type DurationLike } from "@alepha/datetime";
import {
	MemoryTopicProvider,
	type SubscribeCallback,
	type TopicProvider,
} from "@alepha/topic";
import { expect } from "vitest";
import {
	$lock,
	AlephaLock,
	LockProvider,
	LockTopicProvider,
	MemoryLockProvider,
} from "../src";

export const store: Record<string, string> = {};
export class SharedLockProvider extends MemoryLockProvider {
	store: Record<string, string> = store;
}

export const subscriptions: Record<string, SubscribeCallback[]> = {};
export class SharedTopicProvider extends MemoryTopicProvider {
	subscriptions: Record<string, SubscribeCallback[]> = subscriptions;
}

export const testLockBasic = async (
	provider: Service<LockProvider>,
	topicProvider: Service<TopicProvider>,
): Promise<void> => {
	const state: Record<string, string> = {};
	class TestLock {
		lock = $inject(LockProvider);
		dt = $inject(DateTimeProvider);
		stack = () => state.stack;
		migrate = $lock({
			handler: async () => {
				await this.dt.wait([50, "milliseconds"]);
				state.stack = state.stack ? `${state.stack}A` : "A";
			},
		});
	}

	const prefix = randomUUID();

	const createApp = async () => {
		return Alepha.create({
			env: {
				LOCK_PREFIX_KEY: prefix,
			},
		})
			.with({
				provide: LockTopicProvider,
				use: topicProvider,
			})
			.with({
				provide: LockProvider,
				use: provider,
			})
			.with(AlephaLock)
			.with(TestLock)
			.start()
			.then((a) => a.inject(TestLock));
	};

	const app1 = await createApp();
	const app2 = await createApp();
	const app3 = await createApp();

	await app1.lock.set("stack", "");

	await Promise.all([
		app1.migrate.run(),
		app2.migrate.run(),
		app3.migrate.run(),
	]);

	expect(app1.stack()).toBe("A");
	expect(app2.stack()).toBe("A");
	expect(app3.stack()).toBe("A");
};

export const testLockWait = async (
	provider: Service<LockProvider>,
	topicProvider: Service<TopicProvider>,
): Promise<void> => {
	let count = 0;

	class TestLockWait {
		dt = $inject(DateTimeProvider);

		migrateLock = $lock({
			wait: true,
			handler: async () => {
				count++;
				await this.dt.wait([500, "milliseconds"]);
			},
		});

		async migrate() {
			const now = Date.now();
			await this.migrateLock.run();
			return Date.now() - now;
		}
	}

	const createApp = async () => {
		const app = Alepha.create()
			.with({
				provide: LockTopicProvider,
				use: topicProvider,
			})
			.with({
				provide: LockProvider,
				use: provider,
			});
		app.with(TestLockWait);
		return app.start().then(() => app.inject(TestLockWait));
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

export const testLockGracePeriod = async (
	provider: Service<LockProvider>,
	topicProvider: Service<TopicProvider>,
): Promise<void> => {
	const config: {
		gracePeriod?: DurationLike;
	} = {};
	let count = 0;

	const createApp = () => {
		const alepha = Alepha.create()
			.with({
				provide: LockTopicProvider,
				use: topicProvider,
			})
			.with({
				provide: LockProvider,
				use: provider,
			});

		class TestApp {
			fn = $lock({
				gracePeriod: config.gracePeriod,
				handler: async () => {
					count += 1;
				},
			});
		}
		const fn = alepha.inject(TestApp).fn;
		alepha.on("ready", () => fn.run());
		return alepha;
	};

	// no grace period
	// as you run apps one by one, lock is released after each start!
	count = 0;
	expect(count).toBe(0);
	for (const app of [createApp(), createApp(), createApp()]) {
		await app.start();
	}
	expect(count).toBe(3);

	// but with grace period
	// as we wait 1 second before releasing lock, all started apps will see the lock!
	count = 0;
	expect(count).toBe(0);
	config.gracePeriod = [1, "seconds"];
	for (const app of [createApp(), createApp(), createApp()]) {
		await app.start();
	}
	expect(count).toBe(1);
};
