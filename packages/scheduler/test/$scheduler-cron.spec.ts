import { randomUUID } from "node:crypto";
import type { ServiceEntry } from "@alepha/core";
import { $inject, Alepha, t } from "@alepha/core";
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

	// /!\ cron will be triggered 1 or 2 times, depending on the clock and cpu
	// so we expect 1 ou 2 ticks for Lock and count(apps) * (1 or 2) for no-lock
	await new Promise((resolve) => setTimeout(resolve, 1100));

	const sum = () =>
		apps.reduce((acc, app) => acc + app.get(TestSchedulerCron).tick, 0);

	if (lock) {
		expect(sum()).toBeOneOf([1, 2]);
	} else {
		expect(sum()).toBeGreaterThanOrEqual(apps.length);
		expect(sum()).toBeLessThanOrEqual(apps.length * 2);
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
