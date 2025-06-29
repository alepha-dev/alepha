import { randomUUID } from "node:crypto";
import { $inject, Alepha, type Service } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
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
	store = store;
}

export const subscriptions: Record<string, SubscribeCallback[]> = {};
export class SharedTopicProvider extends MemoryTopicProvider {
	subscriptions = subscriptions;
}

export const testLockBasic = async (
	provider: Service<LockProvider>,
	topicProvider: Service<TopicProvider>,
) => {
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
			.then((a) => a.get(TestLock));
	};

	const app1 = await createApp();
	const app2 = await createApp();
	const app3 = await createApp();

	await app1.lock.set("stack", "");

	await Promise.all([app1.migrate(), app2.migrate(), app3.migrate()]);

	expect(app1.stack()).toBe("A");
	expect(app2.stack()).toBe("A");
	expect(app3.stack()).toBe("A");
};

export const testLockWait = async (
	provider: Service<LockProvider>,
	topicProvider: Service<TopicProvider>,
) => {
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
			await this.migrateLock();
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
