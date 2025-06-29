import { randomUUID } from "node:crypto";
import type { ServiceEntry } from "@alepha/core";
import { $inject, Alepha, t } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import {
	LockProvider,
	MemoryLockProvider,
	RedisLockProvider,
} from "@alepha/lock";
import { expect, test } from "vitest";
import { $scheduler } from "../src";

const store: Record<string, string> = {};

class SharedLockProvider extends MemoryLockProvider {
	store = store;
}

const env = t.object({
	LOCK: t.boolean(),
});

class TestSchedulerCron {
	env = $inject(env);
	tick = 0;
	t = $scheduler({
		cron: "* * * * * *",
		lock: this.env.LOCK,
		handler: async () => {
			this.tick += 1;
		},
	});
}

const createApp = <T extends object>(
	testClass: ServiceEntry<T>,
	LOCK: boolean,
	provider?: "redis",
	prefix?: string,
): Alepha => {
	return Alepha.create({ env: { LOCK, CACHE_PREFIX: prefix } })
		.with({
			provide: LockProvider,
			use: provider === "redis" ? RedisLockProvider : SharedLockProvider,
		})
		.with(DateTimeProvider)
		.with(testClass);
};

const testSchedulerCron = async (lock: boolean, provider?: "redis") => {
	const prefix = randomUUID();
	const apps = [
		createApp(TestSchedulerCron, lock, provider, prefix),
		createApp(TestSchedulerCron, lock, provider, prefix),
		createApp(TestSchedulerCron, lock, provider, prefix),
	];

	await Promise.all(apps.map((app) => app.start()));

	const sum = () =>
		apps.reduce((acc, app) => acc + app.get(TestSchedulerCron).tick, 0);

	if (lock) {
		await expect
			.poll(() => expect(sum()).toEqual(2), {
				timeout: 2000,
				interval: 50,
			})
			.toBeTruthy();
	} else {
		await expect
			.poll(() => expect(sum()).toEqual(2 * apps.length), {
				timeout: 2000,
				interval: 50,
			})
			.toBeTruthy();
	}

	await Promise.all(apps.map((app) => app.stop()));
};

const timeout = 5000;

test("$scheduler - cron", { timeout }, async () => {
	await testSchedulerCron(true);
});

test("$scheduler - cron no-lock", { timeout, retry: 3 }, async () => {
	await testSchedulerCron(false);
});

test("$scheduler - cron (redis)", { timeout }, async () => {
	await testSchedulerCron(true, "redis");
});

test("$scheduler - cron no-lock (redis)", { timeout, retry: 3 }, async () => {
	await testSchedulerCron(false, "redis");
});
