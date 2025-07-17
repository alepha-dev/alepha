import { randomUUID } from "node:crypto";
import { $env, Alepha, type ServiceEntry, t } from "@alepha/core";
import { DateTimeProvider } from "@alepha/datetime";
import { LockProvider, MemoryLockProvider } from "@alepha/lock";
import { RedisLockProvider } from "@alepha/lock-redis";
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
	env = $env(env);
	tick = 0;
	t = $scheduler({
		cron: "0 * * * *", // Every hour at minute 0
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
		createApp(TestSchedulerCron, lock, provider, prefix),
	];

	const sum = () =>
		apps.reduce((acc, app) => acc + app.get(TestSchedulerCron).tick, 0);

	await Promise.all(apps.map((app) => app.start()));

	// 🕒 simulate time travel to trigger the cron job 🕒
	await Promise.all(
		apps.map((app) => app.get(DateTimeProvider).travel(1, "hour")),
	);

	// note: for now $timeout API is synchronous, so we must use a polling mechanism
	// as it's not guaranteed that the job will run immediately :-(
	// we will remove .poll() when $timeout API will be asynchronous

	if (lock) {
		await expect.poll(() => sum()).toBe(1); // only one app should run the job due to the lock
	} else {
		await expect.poll(() => sum()).toBe(apps.length);
	}

	await Promise.all(apps.map((app) => app.stop()));
};

test("$scheduler - cron", async () => {
	await testSchedulerCron(true);
});

test("$scheduler - cron no-lock", async () => {
	await testSchedulerCron(false);
});

test("$scheduler - cron (redis)", async () => {
	await testSchedulerCron(true, "redis");
});

test("$scheduler - cron no-lock (redis)", async () => {
	await testSchedulerCron(false, "redis");
});
